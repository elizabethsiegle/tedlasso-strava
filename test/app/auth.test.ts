import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleCallback, handleLogin, timingSafeEqual } from "../../src/app/auth";
import { KvStore } from "../../src/infrastructure/store/kv";
import { StravaClient } from "../../src/infrastructure/strava/client";

const NOW = Date.parse("2026-08-14T19:00:00Z");
const kv = (): KVNamespace => (env as never as { STORE: KVNamespace }).STORE;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function deps(strava?: StravaClient) {
  return {
    store: new KvStore(kv()),
    strava:
      strava ??
      new StravaClient("cid", "sec", async () =>
        json({ access_token: "a", refresh_token: "ref-new", expires_at: 1, athlete: { id: 4242 } }),
      ),
    tz: "America/Los_Angeles",
    privacyTrimM: 250,
    clientId: "cid",
    athleteId: "4242",
    setupKey: "s3cret",
    redirectUri: "https://example.test/auth/callback",
  };
}

describe("timingSafeEqual", () => {
  it("matches identical strings and rejects differences", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("handleLogin", () => {
  it("404s without a key, so the route is not advertised", async () => {
    const res = await handleLogin(new Request("https://x/auth/login"), deps());
    expect(res.status).toBe(404);
  });

  it("404s with a wrong key", async () => {
    const res = await handleLogin(new Request("https://x/auth/login?key=nope"), deps());
    expect(res.status).toBe(404);
  });

  it("redirects to Strava with the right scope and a state", async () => {
    const res = await handleLogin(new Request("https://x/auth/login?key=s3cret"), deps());
    expect(res.status).toBe(302);

    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(location.searchParams.get("scope")).toBe("activity:read_all");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("client_id")).toBe("cid");
    expect(location.searchParams.get("redirect_uri")).toBe("https://example.test/auth/callback");
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  it("stores the state so the callback can consume it", async () => {
    const res = await handleLogin(new Request("https://x/auth/login?key=s3cret"), deps());
    const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
    expect(await new KvStore(kv()).consumeOAuthState(state)).toBe(true);
  });

  it("issues a different state each time", async () => {
    const a = await handleLogin(new Request("https://x/auth/login?key=s3cret"), deps());
    const b = await handleLogin(new Request("https://x/auth/login?key=s3cret"), deps());
    const stateA = new URL(a.headers.get("location")!).searchParams.get("state");
    const stateB = new URL(b.headers.get("location")!).searchParams.get("state");
    expect(stateA).not.toBe(stateB);
  });
});

describe("handleCallback", () => {
  beforeEach(async () => {
    for (const key of ["token/refresh", "snapshot/current", "health"]) await kv().delete(key);
  });

  async function issuedState(): Promise<string> {
    const res = await handleLogin(new Request("https://x/auth/login?key=s3cret"), deps());
    return new URL(res.headers.get("location")!).searchParams.get("state")!;
  }

  it("400s with no code", async () => {
    const state = await issuedState();
    const res = await handleCallback(new Request(`https://x/auth/callback?state=${state}`), deps(), NOW);
    expect(res.status).toBe(400);
  });

  it("400s with an unknown state", async () => {
    const res = await handleCallback(
      new Request("https://x/auth/callback?code=c&state=never-issued"), deps(), NOW,
    );
    expect(res.status).toBe(400);
    expect(await new KvStore(kv()).getRefreshToken()).toBeNull();
  });

  it("400s when the same state is replayed", async () => {
    const state = await issuedState();
    const url = `https://x/auth/callback?code=c&state=${state}`;
    expect((await handleCallback(new Request(url), deps(), NOW)).status).toBe(302);
    expect((await handleCallback(new Request(url), deps(), NOW)).status).toBe(400);
  });

  it("400s when the state has expired", async () => {
    // KV expiry cannot be fast-forwarded in tests, so delete the key directly.
    // Expiry and deletion are indistinguishable to consumeOAuthState by design:
    // both leave no value, which is exactly the condition under test.
    const state = await issuedState();
    await kv().delete(`oauth/state/${state}`);
    const res = await handleCallback(
      new Request(`https://x/auth/callback?code=c&state=${state}`), deps(), NOW,
    );
    expect(res.status).toBe(400);
    expect(await new KvStore(kv()).getRefreshToken()).toBeNull();
  });

  it("403s and writes nothing when the athlete id does not match", async () => {
    const state = await issuedState();
    const stranger = new StravaClient("cid", "sec", async () =>
      json({ access_token: "a", refresh_token: "stranger", expires_at: 1, athlete: { id: 9999 } }),
    );
    const res = await handleCallback(
      new Request(`https://x/auth/callback?code=c&state=${state}`), deps(stranger), NOW,
    );
    expect(res.status).toBe(403);
    expect(await new KvStore(kv()).getRefreshToken()).toBeNull();
  });

  it("403s when Strava returns no athlete at all", async () => {
    const state = await issuedState();
    const anon = new StravaClient("cid", "sec", async () =>
      json({ access_token: "a", refresh_token: "r", expires_at: 1 }),
    );
    const res = await handleCallback(
      new Request(`https://x/auth/callback?code=c&state=${state}`), deps(anon), NOW,
    );
    expect(res.status).toBe(403);
  });

  it("stores the token and redirects home on success", async () => {
    const state = await issuedState();
    const res = await handleCallback(
      new Request(`https://x/auth/callback?code=c&state=${state}`), deps(), NOW,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(await new KvStore(kv()).getRefreshToken()).toBe("ref-new");
  });

  it("clears needsReauth on success", async () => {
    const store = new KvStore(kv());
    await store.putHealth({ lastAttemptAt: 1, lastSuccessAt: null, lastError: "x", needsReauth: true });
    const state = await issuedState();
    await handleCallback(new Request(`https://x/auth/callback?code=c&state=${state}`), deps(), NOW);
    expect((await store.getHealth()).needsReauth).toBe(false);
  });
});
