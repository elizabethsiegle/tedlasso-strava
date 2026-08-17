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

/**
 * A KV binding whose `get` rejects for one specific key and otherwise behaves
 * like an empty store. Used to force a genuine KV outage at a precise point
 * (e.g. only `runRefresh`'s internal `getHealth`), without also breaking the
 * cooldown lookup that runs earlier in the same request.
 */
function kvThatFailsOn(failingKey: string): KVNamespace {
  return {
    get: async (key: string) => {
      if (key === failingKey) throw new Error("KV unavailable");
      return null;
    },
    put: async () => {},
    delete: async () => {},
  } as unknown as KVNamespace;
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
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("404s without the key", async () => {
    const req = new Request("https://x/api/refresh", { method: "POST" });
    expect((await worker.fetch(req, testEnv(), ctx())).status).toBe(404);
  });

  it("404s with a wrong key", async () => {
    const req = new Request("https://x/api/refresh?key=wrong", { method: "POST" });
    expect((await worker.fetch(req, testEnv(), ctx())).status).toBe(404);
  });

  it("429s when called again inside the cooldown, with a retry-after that matches the JSON body and rounds up", async () => {
    // ~14.5s into a 60s cooldown leaves ~45.5s remaining — a fractional value
    // that only comes out to a whole number if the code rounds UP (ceil), not
    // down (floor). A margin of 500ms either side of the second boundary is
    // far more slack than this synchronous KV round-trip needs.
    await new KvStore(kv()).putLastManualRefreshAt(Date.now() - 14_500);
    const req = new Request("https://x/api/refresh?key=s3cret", {
      method: "POST",
      headers: { accept: "application/json" },
    });
    const res = await worker.fetch(req, testEnv(), ctx());
    expect(res.status).toBe(429);

    const header = res.headers.get("retry-after");
    expect(header).toBeTruthy();

    const body = (await res.json()) as { ok: boolean; reason: string; retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBe(Number(header));
    expect(Number.isInteger(body.retryAfterSeconds)).toBe(true);
    expect(body.retryAfterSeconds).toBe(46);
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
    const req = new Request("https://x/api/refresh?key=s3cret", {
      method: "POST",
      headers: { accept: "application/json" },
    });
    const res = await worker.fetch(req, testEnv(), ctx());
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ ok: false, reason: "no-token" });
  });

  it("returns a JSON error body rather than a 500 when the store rejects mid-refresh", async () => {
    const req = new Request("https://x/api/refresh?key=s3cret", {
      method: "POST",
      headers: { accept: "application/json" },
    });
    const res = await worker.fetch(req, testEnv({ STORE: kvThatFailsOn("health") }), ctx());
    expect(res.status).not.toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("redirects a no-JS form submission back to the page, preserving the key, instead of dumping raw JSON", async () => {
    const req = new Request("https://x/api/refresh?key=s3cret", { method: "POST" });
    const res = await worker.fetch(req, testEnv(), ctx());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://x/?key=s3cret");
  });

  it("redirects rather than serving JSON on the cooldown path too, for a no-JS submission", async () => {
    await new KvStore(kv()).putLastManualRefreshAt(Date.now() - 14_500);
    const req = new Request("https://x/api/refresh?key=s3cret", { method: "POST" });
    const res = await worker.fetch(req, testEnv(), ctx());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://x/?key=s3cret");
  });

  it("redirects rather than serving JSON when the store rejects mid-refresh, for a no-JS submission", async () => {
    const req = new Request("https://x/api/refresh?key=s3cret", { method: "POST" });
    const res = await worker.fetch(req, testEnv({ STORE: kvThatFailsOn("health") }), ctx());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://x/?key=s3cret");
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

  it("resolves rather than rejects when the store rejects mid-refresh (KV outage)", async () => {
    const controller = { cron: "0 */4 * * *", scheduledTime: Date.now(), noRetry: () => {} };
    await expect(
      worker.scheduled(
        controller as unknown as ScheduledController,
        testEnv({ STORE: kvThatFailsOn("health") }),
        ctx(),
      ),
    ).resolves.toBeUndefined();
  });
});
