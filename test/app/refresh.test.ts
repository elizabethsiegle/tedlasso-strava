import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { runRefresh } from "../../src/app/refresh";
import { getMood } from "../../src/data/moods";
import { KvStore } from "../../src/infrastructure/store/kv";
import { StravaClient } from "../../src/infrastructure/strava/client";
import type { Snapshot } from "../../src/types";

const NOW = Date.parse("2026-08-14T19:00:00Z");
const kv = (): KVNamespace => (env as never as { STORE: KVNamespace }).STORE;

const ACTIVITY = {
  id: 1, name: "Morning Run", sport_type: "Run", distance: 8000,
  moving_time: 2400, total_elevation_gain: 50, average_speed: 3.3,
  suffer_score: 60, start_date: "2026-08-14T14:00:00Z",
  map: { summary_polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
  location_city: "San Francisco", location_state: "CA",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A client whose token endpoint succeeds and whose activity endpoint returns `activities`. */
function happyClient(activities: unknown[] = [ACTIVITY], onToken?: () => void): StravaClient {
  return new StravaClient("cid", "sec", async (input) => {
    if (input.startsWith("https://www.strava.com/oauth/token")) {
      onToken?.();
      return json({ access_token: "acc-new", refresh_token: "ref-new", expires_at: 1 });
    }
    return json(activities);
  });
}

/**
 * The fixture polyline is Google's 3-point continental test vector — its points
 * are ~200km apart, so a 250m trim leaves fewer than 2 points and `route` comes
 * back null. Tests that assert on the route pass `privacyTrimM: 0`; the trim
 * itself is covered exhaustively in Task 8.
 */
function deps(strava: StravaClient, privacyTrimM = 250) {
  return { store: new KvStore(kv()), strava, tz: "America/Los_Angeles", privacyTrimM };
}

/**
 * A KV binding whose `get` rejects for a given key (default: every key) and
 * whose `put`/`delete` succeed silently. Used to force a genuine KV outage
 * rather than the "no token stored" happy-ish path, which every other test
 * here already covers.
 */
function rejectingKv(failOn: (key: string) => boolean = () => true): KVNamespace {
  return {
    get: async (key: string) => {
      if (failOn(key)) throw new Error("KV unavailable");
      return null;
    },
    put: async () => {},
    delete: async () => {},
  } as unknown as KVNamespace;
}

async function seedSnapshot(): Promise<Snapshot> {
  const existing: Snapshot = {
    version: 1, refreshedAt: 1, mood: { id: "biscuits", name: "Biscuits", accent: "#D98B5F" },
    quote: { text: "Biscuits with the boss.", character: "Ted Lasso" }, gif: null,
    scores: { consistency: 1, charge: 1 }, reasons: ["seeded"],
    facts: { last: null, daysSinceLast: null, countLast7: 0, baselineWeekly: 0, streakDays: 0, totalActivities: 0 },
    route: null,
  };
  await new KvStore(kv()).putSnapshot(existing);
  return existing;
}

describe("runRefresh", () => {
  beforeEach(async () => {
    for (const key of ["token/refresh", "snapshot/current", "health", "refresh/lastAt"]) {
      await kv().delete(key);
    }
  });

  it("fails cleanly when no token has been stored yet", async () => {
    const result = await runRefresh(deps(happyClient()), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-token");
    expect(await new KvStore(kv()).getSnapshot()).toBeNull();
  });

  it("writes the rotated refresh token BEFORE fetching activities", async () => {
    const order: string[] = [];
    const store = new KvStore(kv());
    await store.putRefreshToken("ref-old");

    const strava = new StravaClient("cid", "sec", async (input) => {
      if (input.startsWith("https://www.strava.com/oauth/token")) {
        return json({ access_token: "acc", refresh_token: "ref-new", expires_at: 1 });
      }
      order.push(`activities:token=${await store.getRefreshToken()}`);
      return json([ACTIVITY]);
    });

    await runRefresh(deps(strava), NOW);
    expect(order).toEqual(["activities:token=ref-new"]);
  });

  it("writes a snapshot on success", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    const result = await runRefresh(deps(happyClient()), NOW);

    expect(result.ok).toBe(true);
    const stored = await new KvStore(kv()).getSnapshot();
    expect(stored).not.toBeNull();
    expect(stored!.refreshedAt).toBe(NOW);
    expect(stored!.version).toBe(1);
    expect(stored!.facts.totalActivities).toBe(1);
  });

  it("records success in health", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    await runRefresh(deps(happyClient()), NOW);
    const health = await new KvStore(kv()).getHealth();
    expect(health.lastSuccessAt).toBe(NOW);
    expect(health.needsReauth).toBe(false);
    expect(health.lastError).toBeNull();
  });

  it("leaves the previous snapshot byte-identical when the refresh 4xxs", async () => {
    const before = await seedSnapshot();
    await new KvStore(kv()).putRefreshToken("ref-dead");
    const strava = new StravaClient("cid", "sec", async () => json({ message: "Bad" }, 400));

    const result = await runRefresh(deps(strava), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("auth");
    expect(await new KvStore(kv()).getSnapshot()).toEqual(before);
  });

  it("sets needsReauth when the refresh 4xxs", async () => {
    await new KvStore(kv()).putRefreshToken("ref-dead");
    const strava = new StravaClient("cid", "sec", async () => json({}, 401));
    await runRefresh(deps(strava), NOW);
    expect((await new KvStore(kv()).getHealth()).needsReauth).toBe(true);
  });

  it("writes no snapshot and does not set needsReauth when rate limited", async () => {
    const before = await seedSnapshot();
    await new KvStore(kv()).putRefreshToken("ref-old");
    const strava = new StravaClient("cid", "sec", async (input) =>
      input.startsWith("https://www.strava.com/oauth/token")
        ? json({ access_token: "a", refresh_token: "r", expires_at: 1 })
        : json({}, 429),
    );

    const result = await runRefresh(deps(strava), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("rate-limit");
    expect(await new KvStore(kv()).getSnapshot()).toEqual(before);
    expect((await new KvStore(kv()).getHealth()).needsReauth).toBe(false);
  });

  it("keeps a standing needsReauth notice when a later failure is NOT an auth failure", async () => {
    // If the token was already revoked (needsReauth: true) and the next
    // attempt merely rate-limits, the reconnect notice must not disappear —
    // it should only clear on an actual successful refresh.
    const store = new KvStore(kv());
    await store.putHealth({ lastAttemptAt: 1, lastSuccessAt: null, lastError: "old", needsReauth: true });
    await store.putRefreshToken("ref-old");
    const strava = new StravaClient("cid", "sec", async (input) =>
      input.startsWith("https://www.strava.com/oauth/token")
        ? json({ access_token: "a", refresh_token: "r", expires_at: 1 })
        : json({}, 429),
    );

    const result = await runRefresh(deps(strava), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("rate-limit");
    expect((await store.getHealth()).needsReauth).toBe(true);
  });

  it("refuses to persist an empty refresh_token, and treats it as an auth failure instead", async () => {
    const before = await seedSnapshot();
    await new KvStore(kv()).putRefreshToken("ref-good");
    const strava = new StravaClient("cid", "sec", async (input) =>
      input.startsWith("https://www.strava.com/oauth/token")
        ? json({ access_token: "a", refresh_token: "", expires_at: 1 })
        : json([ACTIVITY]),
    );

    const result = await runRefresh(deps(strava), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("auth");

    // The working credential must survive: a falsy refresh_token in an
    // otherwise-200 response must never overwrite it.
    expect(await new KvStore(kv()).getRefreshToken()).toBe("ref-good");
    expect(await new KvStore(kv()).getSnapshot()).toEqual(before);
    expect((await new KvStore(kv()).getHealth()).needsReauth).toBe(true);
  });

  it("clears a previous needsReauth after a good refresh", async () => {
    const store = new KvStore(kv());
    await store.putHealth({ lastAttemptAt: 1, lastSuccessAt: null, lastError: "old", needsReauth: true });
    await store.putRefreshToken("ref-old");
    await runRefresh(deps(happyClient()), NOW);
    expect((await store.getHealth()).needsReauth).toBe(false);
  });

  it("requests activities with an epoch-SECONDS after value 90 days back", async () => {
    let seenUrl = "";
    await new KvStore(kv()).putRefreshToken("ref-old");
    const strava = new StravaClient("cid", "sec", async (input) => {
      if (input.startsWith("https://www.strava.com/oauth/token")) {
        return json({ access_token: "a", refresh_token: "r", expires_at: 1 });
      }
      seenUrl = input;
      return json([]);
    });

    await runRefresh(deps(strava), NOW);
    const expected = Math.floor((NOW - 90 * 86_400_000) / 1000);
    expect(seenUrl).toContain(`after=${expected}`);
  });

  it("produces a snapshot with a route built from the polyline", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    await runRefresh(deps(happyClient(), 0), NOW);
    const snap = await new KvStore(kv()).getSnapshot();
    expect(snap!.route).not.toBeNull();
    expect(snap!.route!.pathD.startsWith("M")).toBe(true);
  });

  it("drops the route entirely when the trim consumes it", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    await runRefresh(deps(happyClient(), 250), NOW);
    expect((await new KvStore(kv()).getSnapshot())!.route).toBeNull();
  });

  it("builds a privacy-trimmed glyph for each results row from the same polyline", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    await runRefresh(deps(happyClient(), 0), NOW);
    const snap = await new KvStore(kv()).getSnapshot();

    const withGlyph = (snap!.facts.recent ?? []).filter((r) => r.glyph);
    expect(withGlyph.length).toBeGreaterThan(0);
    for (const row of withGlyph) {
      expect(row.glyph!.pathD.startsWith("M")).toBe(true);
      expect(row.glyph!.viewBox).toMatch(/^0 0 \d+ \d+$/);
    }
  });

  it("omits the row glyph rather than the row when the trim consumes the route", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    await runRefresh(deps(happyClient(), 250), NOW);
    const snap = await new KvStore(kv()).getSnapshot();

    // Same trim that nulls `route` above: the rows survive, only the traces go.
    expect((snap!.facts.recent ?? []).length).toBeGreaterThan(0);
    expect((snap!.facts.recent ?? []).every((r) => r.glyph === undefined)).toBe(true);
  });

  it("never persists raw coordinates alongside the path", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    // Trim 0 so a route IS built — asserting absence while a route exists is the
    // stronger claim.
    await runRefresh(deps(happyClient(), 0), NOW);
    const raw = (await kv().get("snapshot/current", "text")) ?? "";
    expect(raw).not.toContain("summaryPolyline");
    expect(raw).not.toContain("_p~iF");
    expect(raw).not.toContain('"lat"');
  });

  it("still writes a snapshot when the athlete has no activities", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    const result = await runRefresh(deps(happyClient([])), NOW);
    expect(result.ok).toBe(true);
    const snap = await new KvStore(kv()).getSnapshot();
    expect(snap!.mood.id).toBe("preseason");
    expect(snap!.route).toBeNull();
  });

  it("carries the chosen GIF's verifiedOn from the catalogue into the snapshot", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    // Zero activities deterministically selects "preseason", which the
    // catalogue ships with exactly one GIF -- no seed-dependent branching to
    // account for.
    await runRefresh(deps(happyClient([])), NOW);
    const snap = await new KvStore(kv()).getSnapshot();
    const catalogueGif = getMood("preseason")!.gifs[0]!;
    expect(snap!.gif).not.toBeNull();
    expect(snap!.gif!.verifiedOn).toBe(catalogueGif.verifiedOn);
  });

  it("classifies a non-Strava failure as \"error\" without touching the snapshot or needsReauth", async () => {
    const before = await seedSnapshot();
    await new KvStore(kv()).putRefreshToken("ref-old");
    const strava = new StravaClient("cid", "sec", async (input) => {
      if (input.startsWith("https://www.strava.com/oauth/token")) {
        return json({ access_token: "a", refresh_token: "r", expires_at: 1 });
      }
      throw new Error("network down");
    });

    const result = await runRefresh(deps(strava), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("error");
    expect(await new KvStore(kv()).getSnapshot()).toEqual(before);

    const health = await new KvStore(kv()).getHealth();
    expect(health.needsReauth).toBe(false);
    expect(health.lastError).toBe("network down");
  });

  it("fails loudly instead of publishing a route when privacyTrimM is not finite, and leaves the snapshot alone", async () => {
    const before = await seedSnapshot();
    await new KvStore(kv()).putRefreshToken("ref-old");

    const result = await runRefresh(deps(happyClient(), Number.NaN), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("error");
    expect(await new KvStore(kv()).getSnapshot()).toEqual(before);
  });

  it("builds the route from the genuinely most recent activity out of several, shuffled", async () => {
    const oldest = { ...ACTIVITY, distance: 5000, start_date: "2026-08-01T14:00:00Z" };
    const newest = { ...ACTIVITY, distance: 9999, start_date: "2026-08-12T14:00:00Z" };
    const middle = { ...ACTIVITY, distance: 3000, start_date: "2026-08-05T14:00:00Z" };

    await new KvStore(kv()).putRefreshToken("ref-old");
    // Deliberately not in chronological order, so the comparator has to do the work.
    const result = await runRefresh(deps(happyClient([middle, oldest, newest]), 0), NOW);

    expect(result.ok).toBe(true);
    const snap = await new KvStore(kv()).getSnapshot();
    expect(snap!.route).not.toBeNull();
    expect(snap!.route!.distanceM).toBe(9999);
  });

  it("stringifies a non-Error thrown value instead of losing it to `undefined`", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    const strava = new StravaClient("cid", "sec", async (input) => {
      if (input.startsWith("https://www.strava.com/oauth/token")) {
        return json({ access_token: "a", refresh_token: "r", expires_at: 1 });
      }
      throw "boom";
    });

    const result = await runRefresh(deps(strava), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("error");
    expect((await new KvStore(kv()).getHealth()).lastError).toBe("boom");
  });

  it("returns ok:false instead of throwing when getHealth itself rejects (KV outage)", async () => {
    const brokenStore = new KvStore(rejectingKv());
    const result = await runRefresh(
      { store: brokenStore, strava: happyClient(), tz: "America/Los_Angeles", privacyTrimM: 250 },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
      expect(result.message).toBe("KV unavailable");
    }
  });

  it("does not throw even when the best-effort health write in the catch block also rejects", async () => {
    // Every KV call fails: getHealth fails, and the catch block's own attempt
    // to record that failure via putHealth would also fail if put() were not
    // a no-op here. Simulate that too, to prove the failure-of-the-failure
    // path is truly swallowed rather than merely untested.
    const alwaysBroken: KVNamespace = {
      get: async () => {
        throw new Error("read down");
      },
      put: async () => {
        throw new Error("write down");
      },
      delete: async () => {},
    } as unknown as KVNamespace;

    const result = await runRefresh(
      { store: new KvStore(alwaysBroken), strava: happyClient(), tz: "America/Los_Angeles", privacyTrimM: 250 },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("error");
  });
});
