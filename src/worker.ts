import { handleCallback, handleLogin, hasSetupKey, type AuthDeps } from "./app/auth";
import { renderPage } from "./app/render";
import { runRefresh } from "./app/refresh";
import { getMood, type Mood } from "./data/moods";
import { pickQuote } from "./domain/quote";
import { TUNING } from "./domain/tuning";
import { KvStore } from "./infrastructure/store/kv";
import { StravaClient } from "./infrastructure/strava/client";
import type { Snapshot } from "./types";

function requireMood(id: string): Mood {
  const mood = getMood(id);
  if (!mood) throw new Error(`mood catalogue is missing '${id}'`);
  return mood;
}

// The catalogue is the single source for "preseason"'s id/name/accent — never
// hardcoded again here (see also app/render.ts's PRESEASON_MOOD, which reads
// from the same catalogue entry).
const PRESEASON_MOOD = requireMood("preseason");

/** The state shown when previewing a mood with no live snapshot yet. */
const EMPTY_PREVIEW_SNAPSHOT: Snapshot = {
  version: 1,
  refreshedAt: 0,
  mood: { id: PRESEASON_MOOD.id, name: PRESEASON_MOOD.name, accent: PRESEASON_MOOD.accent },
  quote: { text: "", character: "" },
  gif: null,
  scores: { consistency: 0, charge: 0 },
  reasons: [],
  facts: {
    last: null, daysSinceLast: null, countLast7: 0,
    baselineWeekly: 0, streakDays: 0, totalActivities: 0,
  },
  route: null,
};

export interface Env {
  STORE: KVNamespace;
  TIMEZONE: string;
  PRIVACY_TRIM_M: string;
  REDIRECT_URI: string;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_ATHLETE_ID: string;
  SETUP_KEY: string;
}

/**
 * Distinguishes a deliberate privacy-trim opt-out from a plumbing mistake,
 * using the RAW string rather than the coerced number. `Number("")`,
 * `Number(" ")`, and `Number("\n")` are all `0`, which is indistinguishable
 * from the documented opt-out once coerced — so the raw string is checked
 * first. Only a trimmed value of exactly "0" is the opt-out; empty,
 * whitespace-only, or non-numeric values are misconfigurations and fall back
 * to the safe default rather than silently publishing an untrimmed route.
 * A negative number (e.g. "-1") is passed through unchanged so buildRoute's
 * own guard can throw on it — that is a genuinely invalid number, not a
 * missing/blank var, and this function's job is only to catch the latter.
 */
export function resolvePrivacyTrim(raw: string | undefined): number {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "0") return 0;
  if (trimmed === "") return TUNING.DEFAULT_PRIVACY_TRIM_M;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : TUNING.DEFAULT_PRIVACY_TRIM_M;
}

function buildDeps(env: Env): AuthDeps {
  return {
    store: new KvStore(env.STORE),
    strava: new StravaClient(env.STRAVA_CLIENT_ID, env.STRAVA_CLIENT_SECRET),
    tz: env.TIMEZONE || "UTC",
    privacyTrimM: resolvePrivacyTrim(env.PRIVACY_TRIM_M),
    clientId: env.STRAVA_CLIENT_ID,
    athleteId: env.STRAVA_ATHLETE_ID,
    setupKey: env.SETUP_KEY,
    redirectUri: env.REDIRECT_URI,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Distinguishes the fetch() call made by REFRESH_SCRIPT (which asks for JSON)
 * from a native <form> submission (which doesn't). Browsers never send
 * `Accept: application/json` on a plain form POST.
 */
function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

/**
 * The no-JS fallback: rather than dumping the raw JSON body in front of the
 * user with no way back, send them to the page that already knows how to
 * render the current state. 303 (not 302) is what turns this POST into a GET
 * on the follow-up request.
 */
function redirectHome(url: URL): Response {
  const dest = new URL("/", url);
  const key = url.searchParams.get("key");
  if (key !== null) dest.searchParams.set("key", key);
  return new Response(null, { status: 303, headers: { location: dest.toString() } });
}

async function handleManualRefresh(request: Request, env: Env, nowMs: number): Promise<Response> {
  const deps = buildDeps(env);
  const url = new URL(request.url);

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  }
  if (!hasSetupKey(request, deps.setupKey)) return new Response("Not found", { status: 404 });

  const asksForJson = wantsJson(request);

  const lastAt = await deps.store.getLastManualRefreshAt();
  if (lastAt !== null && nowMs - lastAt < TUNING.MANUAL_REFRESH_COOLDOWN_MS) {
    if (!asksForJson) return redirectHome(url);
    const waitS = Math.ceil((TUNING.MANUAL_REFRESH_COOLDOWN_MS - (nowMs - lastAt)) / 1000);
    return new Response(JSON.stringify({ ok: false, reason: "cooldown", retryAfterSeconds: waitS }), {
      status: 429,
      headers: { "content-type": "application/json; charset=utf-8", "retry-after": String(waitS) },
    });
  }

  // Recorded before running, so a slow or failing refresh still throttles the next call.
  await deps.store.putLastManualRefreshAt(nowMs);

  try {
    const result = await runRefresh(deps, nowMs);
    if (!asksForJson) return redirectHome(url);
    return json(result, result.ok ? 200 : 502);
  } catch (error) {
    // runRefresh is written to never throw, but this is the boundary the
    // caller sees: a KV blip here must still surface as the same JSON error
    // shape, never a bare 500.
    if (!asksForJson) return redirectHome(url);
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, reason: "error", message }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const nowMs = Date.now();

    if (url.pathname === "/auth/login") return handleLogin(request, buildDeps(env));
    if (url.pathname === "/auth/callback") return handleCallback(request, buildDeps(env), nowMs);
    if (url.pathname === "/api/refresh") return handleManualRefresh(request, env, nowMs);

    if (url.pathname === "/") {
      const store = new KvStore(env.STORE);
      const [snapshot, health] = await Promise.all([store.getSnapshot(), store.getHealth()]);

      const previewId = url.searchParams.get("preview");
      const previewMood = previewId ? getMood(previewId) : undefined;

      let shown = snapshot;
      let previewNotice: string | null = null;

      if (previewMood) {
        const { quote, gif } = pickQuote(previewMood, nowMs);
        const base = snapshot ?? EMPTY_PREVIEW_SNAPSHOT;
        shown = {
          ...base,
          mood: { id: previewMood.id, name: previewMood.name, accent: previewMood.accent },
          quote,
          gif: gif ? { url: gif.url, alt: gif.alt, verifiedOn: gif.verifiedOn } : null,
        };
        previewNotice = `Preview — not your live mood.`;
      }

      return new Response(
        renderPage({
          snapshot: shown,
          health,
          nowMs,
          showRefreshButton: hasSetupKey(request, env.SETUP_KEY),
          previewNotice,
          setupKey: env.SETUP_KEY,
        }),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Backstop: runRefresh is written to never throw, but a cron handler that
    // does throw fails invisibly (no one is watching), and buildDeps could
    // throw in the future. Never let this rethrow.
    try {
      await runRefresh(buildDeps(env), Date.now());
    } catch {
      // deliberately ignored — see comment above
    }
  },
};
