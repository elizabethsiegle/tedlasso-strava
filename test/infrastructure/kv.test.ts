import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { KvStore } from "../../src/infrastructure/store/kv";
import type { Snapshot } from "../../src/types";

const store = (): KvStore => new KvStore((env as never as { STORE: KVNamespace }).STORE);

function snapshot(): Snapshot {
  return {
    version: 1,
    refreshedAt: 1_755_200_000_000,
    mood: { id: "believe", name: "Believe", accent: "#F2C14E" },
    quote: { text: "Believe.", character: "AFC Richmond locker room" },
    gif: null,
    scores: { consistency: 70, charge: 60 },
    reasons: ["3 workouts this week, against your usual 2"],
    facts: {
      last: null, daysSinceLast: 1, countLast7: 3,
      baselineWeekly: 2, streakDays: 1, totalActivities: 12,
    },
    route: null,
  };
}

describe("KvStore", () => {
  let s: KvStore;
  beforeEach(async () => {
    s = store();
    const kv = (env as never as { STORE: KVNamespace }).STORE;
    for (const key of ["token/refresh", "snapshot/current", "health", "refresh/lastAt"]) {
      await kv.delete(key);
    }
  });

  it("round-trips the refresh token", async () => {
    expect(await s.getRefreshToken()).toBeNull();
    await s.putRefreshToken("tok-1");
    expect(await s.getRefreshToken()).toBe("tok-1");
  });

  it("round-trips a snapshot", async () => {
    expect(await s.getSnapshot()).toBeNull();
    await s.putSnapshot(snapshot());
    expect(await s.getSnapshot()).toEqual(snapshot());
  });

  it("returns an empty health record before any attempt", async () => {
    const h = await s.getHealth();
    expect(h.needsReauth).toBe(false);
    expect(h.lastSuccessAt).toBeNull();
  });

  it("round-trips health", async () => {
    await s.putHealth({ lastAttemptAt: 5, lastSuccessAt: 4, lastError: "boom", needsReauth: true });
    expect((await s.getHealth()).needsReauth).toBe(true);
    expect((await s.getHealth()).lastError).toBe("boom");
  });

  it("returns a fresh health object each call, not a shared reference", async () => {
    const first = await s.getHealth();
    first.needsReauth = true;
    expect((await s.getHealth()).needsReauth).toBe(false);
  });

  it("round-trips the manual refresh timestamp", async () => {
    expect(await s.getLastManualRefreshAt()).toBeNull();
    await s.putLastManualRefreshAt(1234);
    expect(await s.getLastManualRefreshAt()).toBe(1234);
  });

  it("tolerates a non-numeric manual refresh timestamp rather than leaking NaN", async () => {
    await (env as never as { STORE: KVNamespace }).STORE.put("refresh/lastAt", "garbage");
    expect(await s.getLastManualRefreshAt()).toBeNull();
  });

  it("consumes an oauth state exactly once", async () => {
    await s.putOAuthState("nonce-1");
    expect(await s.consumeOAuthState("nonce-1")).toBe(true);
    expect(await s.consumeOAuthState("nonce-1")).toBe(false);
  });

  it("rejects an unknown oauth state", async () => {
    expect(await s.consumeOAuthState("never-issued")).toBe(false);
  });

  it("tolerates corrupt snapshot json rather than throwing", async () => {
    await (env as never as { STORE: KVNamespace }).STORE.put("snapshot/current", "{not json");
    expect(await s.getSnapshot()).toBeNull();
  });
});
