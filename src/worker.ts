import { handleCallback, handleLogin, hasSetupKey, type AuthDeps } from "./app/auth";
import { runRefresh } from "./app/refresh";
import { TUNING } from "./domain/tuning";
import { KvStore } from "./infrastructure/store/kv";
import { StravaClient } from "./infrastructure/strava/client";

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

function buildDeps(env: Env): AuthDeps {
  const trim = Number(env.PRIVACY_TRIM_M);
  return {
    store: new KvStore(env.STORE),
    strava: new StravaClient(env.STRAVA_CLIENT_ID, env.STRAVA_CLIENT_SECRET),
    tz: env.TIMEZONE || "UTC",
    privacyTrimM: Number.isFinite(trim) ? trim : TUNING.DEFAULT_PRIVACY_TRIM_M,
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

async function handleManualRefresh(request: Request, env: Env, nowMs: number): Promise<Response> {
  const deps = buildDeps(env);

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  }
  if (!hasSetupKey(request, deps.setupKey)) return new Response("Not found", { status: 404 });

  const lastAt = await deps.store.getLastManualRefreshAt();
  if (lastAt !== null && nowMs - lastAt < TUNING.MANUAL_REFRESH_COOLDOWN_MS) {
    const waitS = Math.ceil((TUNING.MANUAL_REFRESH_COOLDOWN_MS - (nowMs - lastAt)) / 1000);
    return new Response(JSON.stringify({ ok: false, reason: "cooldown", retryAfterSeconds: waitS }), {
      status: 429,
      headers: { "content-type": "application/json; charset=utf-8", "retry-after": String(waitS) },
    });
  }

  // Recorded before running, so a slow or failing refresh still throttles the next call.
  await deps.store.putLastManualRefreshAt(nowMs);

  const result = await runRefresh(deps, nowMs);
  return json(result, result.ok ? 200 : 502);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const nowMs = Date.now();

    if (url.pathname === "/auth/login") return handleLogin(request, buildDeps(env));
    if (url.pathname === "/auth/callback") return handleCallback(request, buildDeps(env), nowMs);
    if (url.pathname === "/api/refresh") return handleManualRefresh(request, env, nowMs);

    if (url.pathname === "/") {
      // Task 15 replaces this with renderPage().
      const snapshot = await new KvStore(env.STORE).getSnapshot();
      return new Response(snapshot ? snapshot.mood.name : "Preseason", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runRefresh(buildDeps(env), Date.now());
  },
};
