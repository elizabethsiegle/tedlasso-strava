import { describe, expect, it } from "vitest";
import { DAY_MS, TUNING } from "../../src/domain/tuning";
import { buildWorkload } from "../../src/domain/workload";
import { makeActivity } from "../fixtures/activities";

const TZ = "America/Los_Angeles";
/** Noon Pacific, mid-August: comfortably inside PDT, so no DST edge in play. */
const NOW = Date.parse("2026-08-20T19:00:00Z");

/** The newest bucket opens at local midnight, seven days back. */
const NEWEST_START = Date.parse("2026-08-14T07:00:00Z");
const OLDEST_START = Date.parse("2026-05-29T07:00:00Z");

describe("buildWorkload", () => {
  it("is null when there is nothing to chart", () => {
    expect(buildWorkload([], NOW, TZ)).toBeNull();
  });

  it("lays out one bucket per charted week, oldest first", () => {
    const w = buildWorkload([makeActivity({ startedAt: NOW - 3_600_000 })], NOW, TZ);
    expect(w?.weeks).toHaveLength(TUNING.WORKLOAD_WEEKS);
    expect(w?.weeks[0]?.startMs).toBe(OLDEST_START);
    expect(w?.weeks[TUNING.WORKLOAD_WEEKS - 1]?.startMs).toBe(NEWEST_START);
  });

  it("spaces the buckets exactly a week apart", () => {
    const w = buildWorkload([makeActivity({ startedAt: NOW })], NOW, TZ);
    const starts = (w?.weeks ?? []).map((week) => week.startMs);
    for (let i = 1; i < starts.length; i++) {
      expect((starts[i] as number) - (starts[i - 1] as number)).toBe(7 * DAY_MS);
    }
  });

  it("counts today's session in the newest bucket", () => {
    const w = buildWorkload([makeActivity({ startedAt: NOW })], NOW, TZ);
    expect(w?.weeks[TUNING.WORKLOAD_WEEKS - 1]?.count).toBe(1);
  });

  it("buckets by the athlete's calendar, not UTC's", () => {
    // 23:00 Pacific on the 13th is already the 14th in UTC. Bucketing on the UTC
    // date would pull it into the newest week; the athlete rode it the week before.
    const lateNight = Date.parse("2026-08-14T06:00:00Z");
    const w = buildWorkload([makeActivity({ startedAt: lateNight })], NOW, TZ);
    expect(w?.weeks[TUNING.WORKLOAD_WEEKS - 1]?.count).toBe(0);
    expect(w?.weeks[TUNING.WORKLOAD_WEEKS - 2]?.count).toBe(1);
  });

  it("includes a session landing exactly on a bucket's opening instant", () => {
    const w = buildWorkload([makeActivity({ startedAt: NEWEST_START })], NOW, TZ);
    expect(w?.weeks[TUNING.WORKLOAD_WEEKS - 1]?.count).toBe(1);
  });

  it("totals time and distance within a bucket", () => {
    const w = buildWorkload(
      [
        makeActivity({ startedAt: NOW - DAY_MS, movingTimeS: 1800, distanceM: 5000 }),
        makeActivity({ startedAt: NOW - 2 * DAY_MS, movingTimeS: 3600, distanceM: 12_000 }),
      ],
      NOW,
      TZ,
    );
    const newest = w?.weeks[TUNING.WORKLOAD_WEEKS - 1];
    expect(newest?.count).toBe(2);
    expect(newest?.movingTimeS).toBe(5400);
    expect(newest?.distanceM).toBe(17_000);
  });

  it("counts rest weeks in the median instead of dropping them", () => {
    // Two hard weeks and ten empty ones: the honest middle is zero, not 90 minutes.
    const w = buildWorkload(
      [
        makeActivity({ startedAt: NOW - DAY_MS, movingTimeS: 5400 }),
        makeActivity({ startedAt: NOW - 8 * DAY_MS, movingTimeS: 3600 }),
      ],
      NOW,
      TZ,
    );
    expect(w?.medianMovingTimeS).toBe(0);
  });

  it("takes the median across every charted week when training is steady", () => {
    const activities = Array.from({ length: TUNING.WORKLOAD_WEEKS }, (_, k) =>
      makeActivity({ startedAt: NOW - (k * 7 + 1) * DAY_MS, movingTimeS: 3600 }),
    );
    const w = buildWorkload(activities, NOW, TZ);
    expect(w?.weeks.every((week) => week.count === 1)).toBe(true);
    expect(w?.medianMovingTimeS).toBe(3600);
  });

  it("is null when every activity we hold predates the charted window", () => {
    // The fetch window is 90 days and the chart is 84, so this gap is reachable
    // with real data: activities exist, but none of them are on the chart.
    const w = buildWorkload([makeActivity({ startedAt: NOW - 89 * DAY_MS })], NOW, TZ);
    expect(w).toBeNull();
  });
});
