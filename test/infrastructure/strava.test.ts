import { describe, expect, it } from "vitest";
import { mapActivity } from "../../src/infrastructure/strava/map";
import {
  StravaAuthError,
  StravaClient,
  StravaRateLimitError,
} from "../../src/infrastructure/strava/client";
import { TUNING } from "../../src/domain/tuning";

const RAW = {
  id: 42,
  name: "Morning Ride",
  sport_type: "Ride",
  distance: 24_300.5,
  moving_time: 3600,
  total_elevation_gain: 210,
  average_speed: 6.75,
  suffer_score: 88,
  start_date: "2026-08-13T15:04:05Z",
  map: { summary_polyline: "abc", id: "m1", resource_state: 2 },
  location_city: "San Francisco",
  location_state: "CA",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("mapActivity", () => {
  it("maps every field the domain needs", () => {
    const a = mapActivity(RAW)!;
    expect(a.id).toBe(42);
    expect(a.sportType).toBe("Ride");
    expect(a.distanceM).toBe(24_300.5);
    expect(a.movingTimeS).toBe(3600);
    expect(a.elevationM).toBe(210);
    expect(a.averageSpeed).toBe(6.75);
    expect(a.sufferScore).toBe(88);
    expect(a.startedAt).toBe(Date.parse("2026-08-13T15:04:05Z"));
    expect(a.summaryPolyline).toBe("abc");
    expect(a.locationLabel).toBe("San Francisco, CA");
  });

  it("treats a missing suffer_score as null rather than zero", () => {
    const { suffer_score, ...rest } = RAW;
    expect(mapActivity(rest)!.sufferScore).toBeNull();
  });

  it("preserves a genuine suffer_score of 0 rather than reclassifying it as missing", () => {
    // A real, measured zero-effort session must survive the mapping distinctly from an
    // absent field. `undefined` alone cannot discriminate a correct `typeof` check from a
    // sloppy `r.suffer_score || null`, since both treat `undefined` as falsy/missing.
    expect(mapActivity({ ...RAW, suffer_score: 0 })!.sufferScore).toBe(0);
  });

  it("returns null for a non-string start_date", () => {
    expect(mapActivity({ ...RAW, start_date: 1_755_100_000_000 })).toBeNull();
  });

  it("tolerates a non-object map value", () => {
    expect(mapActivity({ ...RAW, map: "not-an-object" })!.summaryPolyline).toBeNull();
  });

  it("treats a null polyline as null", () => {
    expect(mapActivity({ ...RAW, map: { summary_polyline: null } })!.summaryPolyline).toBeNull();
  });

  it("tolerates a missing map object entirely", () => {
    const { map, ...rest } = RAW;
    expect(mapActivity(rest)!.summaryPolyline).toBeNull();
  });

  it("omits the location label when Strava sends nulls", () => {
    expect(mapActivity({ ...RAW, location_city: null, location_state: null })!.locationLabel).toBeNull();
  });

  it("uses the city alone when the state is missing", () => {
    expect(mapActivity({ ...RAW, location_state: null })!.locationLabel).toBe("San Francisco");
  });

  it("returns null for a record missing a start date", () => {
    const { start_date, ...rest } = RAW;
    expect(mapActivity(rest)).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(mapActivity("nope")).toBeNull();
    expect(mapActivity(null)).toBeNull();
  });
});

describe("StravaClient.refresh", () => {
  it("posts the refresh grant and returns the rotated token", async () => {
    // `Request | undefined` plus an explicit cast at the assertion site: TypeScript's
    // control-flow narrowing collapses a `| null` local assigned inside an async
    // closure to `never`, which makes `seen!.method` a type error.
    let seen: Request | undefined;
    const client = new StravaClient("cid", "secret", async (input, init) => {
      seen = new Request(input as string, init);
      return jsonResponse({
        access_token: "acc-2", refresh_token: "ref-2", expires_at: 1_755_300_000,
      });
    });

    const result = await client.refresh("ref-1");
    expect(result.accessToken).toBe("acc-2");
    expect(result.refreshToken).toBe("ref-2");
    expect(result.expiresAt).toBe(1_755_300_000);

    const sent = seen as Request;
    const body = await sent.text();
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe("https://www.strava.com/oauth/token");
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=ref-1");
    expect(body).toContain("client_id=cid");
  });

  it("throws StravaAuthError on a 400", async () => {
    const client = new StravaClient("cid", "secret", async () => jsonResponse({ message: "Bad" }, 400));
    await expect(client.refresh("dead")).rejects.toBeInstanceOf(StravaAuthError);
  });

  it("throws StravaAuthError on a 401", async () => {
    const client = new StravaClient("cid", "secret", async () => jsonResponse({}, 401));
    await expect(client.refresh("dead")).rejects.toBeInstanceOf(StravaAuthError);
  });

  it("throws StravaRateLimitError on a 429", async () => {
    const client = new StravaClient("cid", "secret", async () => jsonResponse({}, 429));
    await expect(client.refresh("t")).rejects.toBeInstanceOf(StravaRateLimitError);
  });
});

describe("StravaClient.exchangeCode", () => {
  it("returns the athlete id so the caller can verify ownership", async () => {
    const client = new StravaClient("cid", "secret", async () =>
      jsonResponse({
        access_token: "a", refresh_token: "r", expires_at: 1,
        athlete: { id: 99_887_766 },
      }),
    );
    expect((await client.exchangeCode("code-1", "https://x/cb")).athleteId).toBe(99_887_766);
  });

  it("returns a null athlete id when Strava omits the athlete", async () => {
    const client = new StravaClient("cid", "secret", async () =>
      jsonResponse({ access_token: "a", refresh_token: "r", expires_at: 1 }),
    );
    expect((await client.exchangeCode("c", "https://x/cb")).athleteId).toBeNull();
  });
});

describe("StravaClient.listActivities", () => {
  it("sends the bearer token and an epoch-seconds after parameter", async () => {
    let url = "";
    let auth = "";
    const client = new StravaClient("cid", "secret", async (input, init) => {
      const req = new Request(input as string, init);
      url = req.url;
      auth = req.headers.get("authorization") ?? "";
      return jsonResponse([]);
    });

    await client.listActivities("acc", 1_747_000_000);
    expect(auth).toBe("Bearer acc");
    expect(url).toContain("after=1747000000");
    expect(url).toContain(`per_page=${TUNING.PER_PAGE}`);
    expect(url).not.toContain("1747000000000"); // must not be milliseconds
  });

  it("stops paging when a page comes back short", async () => {
    let calls = 0;
    const client = new StravaClient("cid", "secret", async () => {
      calls++;
      return jsonResponse([RAW]);
    });
    await client.listActivities("acc", 1);
    expect(calls).toBe(1);
  });

  it("fetches a second page when the first is full, and stops at the cap", async () => {
    let calls = 0;
    const full = Array.from({ length: TUNING.PER_PAGE }, (_, i) => ({ ...RAW, id: i }));
    const client = new StravaClient("cid", "secret", async () => {
      calls++;
      return jsonResponse(full);
    });
    const activities = await client.listActivities("acc", 1);
    expect(calls).toBe(TUNING.MAX_PAGES);
    expect(activities).toHaveLength(TUNING.MAX_PAGES * TUNING.PER_PAGE);
  });

  it("skips unmappable records instead of failing the whole fetch", async () => {
    const client = new StravaClient("cid", "secret", async () =>
      jsonResponse([RAW, { id: 7 }, RAW]),
    );
    expect(await client.listActivities("acc", 1)).toHaveLength(2);
  });

  it("throws StravaRateLimitError on a 429", async () => {
    const client = new StravaClient("cid", "secret", async () => jsonResponse({}, 429));
    await expect(client.listActivities("acc", 1)).rejects.toBeInstanceOf(StravaRateLimitError);
  });

  it("throws StravaAuthError on a 401", async () => {
    const client = new StravaClient("cid", "secret", async () => jsonResponse({}, 401));
    await expect(client.listActivities("acc", 1)).rejects.toBeInstanceOf(StravaAuthError);
  });
});
