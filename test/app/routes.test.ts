import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/worker";
import { KvStore } from "../../src/infrastructure/store/kv";

const kv = (): KVNamespace => (env as never as { STORE: KVNamespace }).STORE;

function ctx(): ExecutionContext {
  return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

function testEnv(overrides: Record<string, unknown> = {}) {
  return {
    ...(env as object),
    TIMEZONE: "America/Los_Angeles",
    PRIVACY_TRIM_M: "250",
    REDIRECT_URI: "https://example.test/auth/callback",
    STRAVA_CLIENT_ID: "cid",
    STRAVA_CLIENT_SECRET: "sec",
    STRAVA_ATHLETE_ID: "4242",
    SETUP_KEY: "s3cret",
    ...overrides,
  } as never;
}

describe("routing", () => {
  beforeEach(async () => {
    for (const key of ["token/refresh", "snapshot/current", "health", "refresh/lastAt"]) {
      await kv().delete(key);
    }
  });

  it("serves the page at /", async () => {
    const res = await worker.fetch(new Request("https://x/"), testEnv(), ctx());
    expect(res.status).toBe(200);
  });

  it("404s an unknown path", async () => {
    const res = await worker.fetch(new Request("https://x/nope"), testEnv(), ctx());
    expect(res.status).toBe(404);
  });

  it("404s /auth/login without the setup key", async () => {
    const res = await worker.fetch(new Request("https://x/auth/login"), testEnv(), ctx());
    expect(res.status).toBe(404);
  });

  it("redirects /auth/login with the setup key", async () => {
    const res = await worker.fetch(new Request("https://x/auth/login?key=s3cret"), testEnv(), ctx());
    expect(res.status).toBe(302);
  });
});

describe("POST /api/refresh", () => {
  beforeEach(async () => {
    for (const key of ["token/refresh", "snapshot/current", "health", "refresh/lastAt"]) {
      await kv().delete(key);
    }
  });

  it("405s a GET", async () => {
    const res = await worker.fetch(new Request("https://x/api/refresh?key=s3cret"), testEnv(), ctx());
    expect(res.status).toBe(405);
  });

  it("404s without the key", async () => {
    const req = new Request("https://x/api/refresh", { method: "POST" });
    expect((await worker.fetch(req, testEnv(), ctx())).status).toBe(404);
  });

  it("404s with a wrong key", async () => {
    const req = new Request("https://x/api/refresh?key=wrong", { method: "POST" });
    expect((await worker.fetch(req, testEnv(), ctx())).status).toBe(404);
  });

  it("429s when called again inside the cooldown", async () => {
    await new KvStore(kv()).putLastManualRefreshAt(Date.now());
    const req = new Request("https://x/api/refresh?key=s3cret", { method: "POST" });
    const res = await worker.fetch(req, testEnv(), ctx());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("allows a call once the cooldown has elapsed", async () => {
    await new KvStore(kv()).putLastManualRefreshAt(Date.now() - 120_000);
    const req = new Request("https://x/api/refresh?key=s3cret", { method: "POST" });
    const res = await worker.fetch(req, testEnv(), ctx());
    // No token stored, so the refresh fails — but not with a cooldown rejection.
    expect(res.status).not.toBe(429);
  });

  it("records the attempt time so the next call is throttled", async () => {
    const req = new Request("https://x/api/refresh?key=s3cret", { method: "POST" });
    await worker.fetch(req, testEnv(), ctx());
    expect(await new KvStore(kv()).getLastManualRefreshAt()).not.toBeNull();
  });

  it("returns a JSON body describing the failure when not connected", async () => {
    const req = new Request("https://x/api/refresh?key=s3cret", { method: "POST" });
    const res = await worker.fetch(req, testEnv(), ctx());
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ ok: false, reason: "no-token" });
  });
});

describe("scheduled", () => {
  it("runs without throwing when nothing is connected", async () => {
    const controller = { cron: "0 */4 * * *", scheduledTime: Date.now(), noRetry: () => {} };
    await expect(
      worker.scheduled(controller as unknown as ScheduledController, testEnv(), ctx()),
    ).resolves.toBeUndefined();
  });

  it("records a health attempt", async () => {
    await kv().delete("health");
    const controller = { cron: "0 */4 * * *", scheduledTime: Date.now(), noRetry: () => {} };
    await worker.scheduled(controller as unknown as ScheduledController, testEnv(), ctx());
    expect((await new KvStore(kv()).getHealth()).lastAttemptAt).not.toBeNull();
  });
});
