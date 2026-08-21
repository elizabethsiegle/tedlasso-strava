import { handleCallback, handleLogin, hasSetupKey, type AuthDeps } from "./app/auth";
import { renderCatalogue, type CatalogueVoice } from "./app/catalogue";
import { renderPage, type PageVoice } from "./app/render";
import { runRefresh } from "./app/refresh";
import { handleTile } from "./app/tiles";
import { MACHIAVELLI_MOODS, getMachiavelliMood } from "./data/machiavelli";
import { MOODS, getMood, type Mood } from "./data/moods";
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

/**
 * A voice is a catalogue plus the URLs that belong to it. Both voices read the
 * SAME snapshot: the mood is chosen from Strava data by the engine, and each
 * catalogue only supplies the words for the id it picked. Nothing about a voice
 * is persisted, so switching costs a page view rather than a refresh.
 */
interface Voice {
  path: string;
  lookup: (id: string) => Mood | undefined;
  /**
   * Whether the stored quote has to be re-picked for this voice. `refresh.ts`
   * writes the default catalogue's pick into the snapshot, so that voice is
   * already correct and every other one has to restate it.
   */
  restate: boolean;
  page: PageVoice;
  catalogue: CatalogueVoice;
}

/** The opening entry, used before any snapshot exists. */
function fallbacks(moods: Mood[]): Pick<PageVoice, "fallbackMood" | "fallbackQuote"> {
  const mood = moods.find((m) => m.id === "preseason");
  if (!mood) throw new Error("a catalogue is missing the 'preseason' entry");
  return {
    fallbackMood: { id: mood.id, name: mood.name, accent: mood.accent },
    fallbackQuote: mood.quotes[0]!,
  };
}

const TED_LASSO: Voice = {
  path: "/",
  lookup: getMood,
  restate: false,
  page: {
    other: { href: "/machiavelli", label: "Read it as Machiavelli" },
    catalogueHref: "/catalogue",
    ...fallbacks(MOODS),
  },
  catalogue: { moods: MOODS, title: "Catalogue", sourcePath: "src/data/moods.ts", boardHref: "/" },
};

const MACHIAVELLI: Voice = {
  path: "/machiavelli",
  lookup: getMachiavelliMood,
  restate: true,
  page: {
    other: { href: "/", label: "Read it as Ted Lasso" },
    catalogueHref: "/catalogue/machiavelli",
    ...fallbacks(MACHIAVELLI_MOODS),
  },
  catalogue: {
    moods: MACHIAVELLI_MOODS,
    title: "Catalogue: Machiavelli",
    sourcePath: "src/data/machiavelli.ts",
    boardHref: "/machiavelli",
  },
};

const VOICES: Voice[] = [TED_LASSO, MACHIAVELLI];

/**
 * Say the stored mood in this voice. Seeded with the snapshot's refresh time
 * rather than `nowMs`, so the pairing holds still until the next refresh exactly
 * as the persisted one does, instead of reshuffling on every reload.
 *
 * An id this catalogue has no entry for is left alone rather than blanked: a
 * missing translation should read as the other voice, not as an empty page.
 */
function inVoice(snapshot: Snapshot, voice: Voice): Snapshot {
  const mood = voice.lookup(snapshot.mood.id);
  if (!mood) return snapshot;
  const { quote, media } = pickQuote(mood, snapshot.refreshedAt);
  return {
    ...snapshot,
    mood: { id: mood.id, name: mood.name, accent: mood.accent },
    quote,
    gif: media ? { url: media.url, alt: media.alt, verifiedOn: media.verifiedOn, kind: media.kind } : null,
  };
}

export interface Env {
  STORE: KVNamespace;
  TIMEZONE: string;
  PRIVACY_TRIM_M: string;
  REDIRECT_URI: string;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_ATHLETE_ID: string;
  SETUP_KEY: string;
  /** "off" hides the basemap under the route. Anything else (or unset) shows it. */
  BASEMAP?: string;
}

/**
 * Distinguishes a deliberate privacy-trim opt-out from a plumbing mistake,
 * using the RAW string rather than the coerced number. `Number("")`,
 * `Number(" ")`, and `Number("\n")` are all `0`, which is indistinguishable
 * from the documented opt-out once coerced — so the raw string is checked
 * first, against the exact pattern `/^0$/`. Only a trimmed value of exactly
 * "0" is the opt-out.
 *
 * Every other spelling that a numeric coercion would also read as zero —
 * "0.0", "00", "-0", "+0", "0x0" — is treated as a misconfiguration, not an
 * opt-out, even though `Number()` happily parses each of them to a finite
 * zero. A config template or copy-paste is exactly the kind of thing that
 * produces "0.0" instead of "0", and silently trimming nothing publishes the
 * athlete's exact home coordinates — so anything that merely *looks* like
 * zero falls back to the safe default rather than being trusted as intent.
 * Only the documented literal earns the opt-out.
 *
 * A genuinely negative, non-zero number (e.g. "-1") is passed through
 * unchanged so buildRoute's own guard can throw on it — that is an
 * unambiguous mistake, and the loud failure is deliberate: the refresh
 * should fail visibly rather than publish. This function's job is only to
 * catch missing/blank/zero-like values, not to absorb negatives into the
 * default.
 */
export function resolvePrivacyTrim(raw: string | undefined): number {
  const trimmed = (raw ?? "").trim();
  if (/^0$/.test(trimmed)) return 0;
  const n = Number(trimmed);
  if (Number.isFinite(n) && n < 0) return n;
  return Number.isFinite(n) && n > 0 ? n : TUNING.DEFAULT_PRIVACY_TRIM_M;
}

/**
 * The basemap is opt-out, not opt-in: it is on unless someone deliberately
 * turns it off. Read at render time rather than baked into the snapshot, so
 * flipping it takes effect on the next page view instead of the next fetch.
 */
export function resolveBasemap(raw: string | undefined): boolean {
  return (raw ?? "").trim().toLowerCase() !== "off";
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const nowMs = Date.now();

    // Checked before the cheap equality routes below because tiles are the
    // only path with a variable shape, and there are a dozen of them per view.
    if (url.pathname.startsWith("/tiles/")) return handleTile(request, ctx);

    if (url.pathname === "/auth/login") return handleLogin(request, buildDeps(env));
    if (url.pathname === "/auth/callback") return handleCallback(request, buildDeps(env), nowMs);
    if (url.pathname === "/api/refresh") return handleManualRefresh(request, env, nowMs);

    // Derived entirely from bundled data — no KV read, no Strava call — so the
    // catalogue stays readable even when there is no snapshot yet.
    const catalogueVoice = VOICES.find((v) => v.page.catalogueHref === url.pathname);
    if (catalogueVoice) {
      return new Response(renderCatalogue(nowMs, catalogueVoice.catalogue), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    const voice = VOICES.find((v) => v.path === url.pathname);
    if (voice) {
      const store = new KvStore(env.STORE);
      const [snapshot, health] = await Promise.all([store.getSnapshot(), store.getHealth()]);

      const previewId = url.searchParams.get("preview");
      const previewMood = previewId ? voice.lookup(previewId) : undefined;

      let shown = snapshot && voice.restate ? inVoice(snapshot, voice) : snapshot;
      let previewNotice: string | null = null;

      if (previewMood) {
        const { quote, media } = pickQuote(previewMood, nowMs);
        const base = snapshot ?? EMPTY_PREVIEW_SNAPSHOT;
        shown = {
          ...base,
          mood: { id: previewMood.id, name: previewMood.name, accent: previewMood.accent },
          quote,
          gif: media ? { url: media.url, alt: media.alt, verifiedOn: media.verifiedOn, kind: media.kind } : null,
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
          showBasemap: resolveBasemap(env.BASEMAP),
          tz: env.TIMEZONE || "UTC",
          voice: voice.page,
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
