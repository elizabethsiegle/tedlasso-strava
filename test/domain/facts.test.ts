import { describe, expect, it } from "vitest";
import { deriveFacts, median } from "../../src/domain/facts";
import { TUNING } from "../../src/domain/tuning";
import { daysAgo, makeActivity } from "../fixtures/activities";

const LA = "America/Los_Angeles";
const NOW = Date.parse("2026-08-14T19:00:00Z"); // Friday noon PDT

describe("median", () => {
  it("returns 0 for an empty array", () => {
    expect(median([])).toBe(0);
  });

  it("returns the middle value for an odd-length, unsorted array", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for an even-length, unsorted array", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("does not mutate its input", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("deriveFacts with no activities", () => {
  const f = deriveFacts([], NOW, LA);

  it("reports zero totals and null last", () => {
    expect(f.totalActivities).toBe(0);
    expect(f.last).toBeNull();
    expect(f.daysSinceLast).toBeNull();
    expect(f.calendarDaysSinceLast).toBeNull();
    expect(f.previousGapDays).toBeNull();
  });

  it("reports zero counts, baseline, and streak", () => {
    expect(f.countLast7).toBe(0);
    expect(f.countLast28).toBe(0);
    expect(f.baselineWeekly).toBe(0);
    expect(f.streakDays).toBe(0);
  });
});

describe("counts", () => {
  it("bucket activities by age", () => {
    const f = deriveFacts(daysAgo(NOW, [0, 2, 6, 9, 20, 40]), NOW, LA);
    expect(f.totalActivities).toBe(6);
    expect(f.countLast7).toBe(3);   // 0, 2, 6
    expect(f.countLast14).toBe(4);  // + 9
    expect(f.countLast28).toBe(5);  // + 20
  });

  it("excludes activities outside the 90-day window", () => {
    const f = deriveFacts(daysAgo(NOW, [1, 200]), NOW, LA);
    expect(f.totalActivities).toBe(1);
  });
});

describe("last activity and gaps", () => {
  it("picks the most recent regardless of input order", () => {
    const acts = [
      makeActivity({ name: "Older", startedAt: NOW - 5 * 86_400_000 }),
      makeActivity({ name: "Newest", startedAt: NOW - 1 * 86_400_000 }),
      makeActivity({ name: "Middle", startedAt: NOW - 3 * 86_400_000 }),
    ];
    const f = deriveFacts(acts, NOW, LA);
    expect(f.last?.name).toBe("Newest");
    expect(f.daysSinceLast).toBeCloseTo(1, 6);
    expect(f.previousGapDays).toBeCloseTo(2, 6); // newest minus middle
  });

  /**
   * The two day counts answer different questions and must not be conflated:
   * thresholds like DORMANT_DAYS are durations, while "today"/"yesterday" is a
   * calendar comparison in the athlete's own timezone.
   */
  it("reports calendar days alongside elapsed days", () => {
    // 21:44 PDT the previous evening, derived at noon PDT the next day.
    const nightRide = Date.parse("2026-08-14T04:44:00Z");
    const f = deriveFacts([makeActivity({ startedAt: nightRide })], NOW, LA);
    expect(f.daysSinceLast).toBeLessThan(1);
    expect(f.calendarDaysSinceLast).toBe(1);
  });

  it("counts calendar days in the configured timezone, not UTC", () => {
    const nightRide = Date.parse("2026-08-14T04:44:00Z");
    expect(deriveFacts([makeActivity({ startedAt: nightRide })], NOW, LA).calendarDaysSinceLast).toBe(1);
    // The same instant is the same UTC date as NOW, so a UTC-derived answer
    // would be 0 and the page would say "today".
    expect(deriveFacts([makeActivity({ startedAt: nightRide })], NOW, "UTC").calendarDaysSinceLast).toBe(0);
  });

  it("returns a null gap when there is only one activity", () => {
    const f = deriveFacts(daysAgo(NOW, [1]), NOW, LA);
    expect(f.previousGapDays).toBeNull();
  });
});

describe("streakDays", () => {
  it("counts consecutive days ending today", () => {
    const f = deriveFacts(daysAgo(NOW, [0, 1, 2, 3]), NOW, LA);
    expect(f.streakDays).toBe(4);
  });

  it("still counts when the streak ended yesterday", () => {
    const f = deriveFacts(daysAgo(NOW, [1, 2, 3]), NOW, LA);
    expect(f.streakDays).toBe(3);
  });

  it("is zero when neither today nor yesterday has an activity", () => {
    const f = deriveFacts(daysAgo(NOW, [2, 3, 4]), NOW, LA);
    expect(f.streakDays).toBe(0);
  });

  it("counts two activities on the same day once", () => {
    const acts = [
      makeActivity({ startedAt: NOW - 3_600_000 }),
      makeActivity({ startedAt: NOW - 7_200_000 }),
      makeActivity({ startedAt: NOW - 86_400_000 }),
    ];
    expect(deriveFacts(acts, NOW, LA).streakDays).toBe(2);
  });

  it("survives a DST transition inside the streak", () => {
    // 2026-11-01 is the fall-back day in Los Angeles.
    const now = Date.parse("2026-11-02T20:00:00Z");
    const acts = [
      makeActivity({ startedAt: Date.parse("2026-11-02T18:00:00Z") }), // Nov 2 local
      makeActivity({ startedAt: Date.parse("2026-11-01T18:00:00Z") }), // Nov 1 local
      makeActivity({ startedAt: Date.parse("2026-10-31T18:00:00Z") }), // Oct 31 local
    ];
    expect(deriveFacts(acts, now, LA).streakDays).toBe(3);
  });
});

describe("baselineWeekly", () => {
  it("falls back to countLast28/4 with under four weeks of history", () => {
    const f = deriveFacts(daysAgo(NOW, [1, 3, 8, 15, 20]), NOW, LA);
    expect(f.baselineWeekly).toBeCloseTo(5 / 4, 6);
  });

  it("takes the median of the twelve preceding full weeks", () => {
    // Two activities in each of the twelve baseline weeks, none in the last 7 days.
    const offsets: number[] = [];
    for (let week = 0; week < 12; week++) {
      const base = 7 + week * 7;
      offsets.push(base + 1, base + 3);
    }
    const f = deriveFacts(daysAgo(NOW, offsets), NOW, LA);
    expect(f.baselineWeekly).toBe(2);
  });

  it("ignores the current partial week when computing the median", () => {
    const offsets: number[] = [0, 1, 2, 3, 4, 5]; // a big current week
    for (let week = 0; week < 12; week++) offsets.push(7 + week * 7 + 1);
    const f = deriveFacts(daysAgo(NOW, offsets), NOW, LA);
    expect(f.baselineWeekly).toBe(1); // the burst in the current week does not inflate it
  });
});

describe("deriveFacts recent (results table rows)", () => {
  it("caps the rows at TUNING.RESULTS_ROWS, newest first", () => {
    const activities = daysAgo(NOW, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const f = deriveFacts(activities, NOW, LA);

    expect(f.recent).toHaveLength(TUNING.RESULTS_ROWS);
    const days = f.recent.map((r) => r.day);
    expect([...days].sort().reverse()).toEqual(days);
  });

  it("resolves `day` in the athlete's timezone, not UTC", () => {
    // 2026-08-15T02:00:00Z is 7pm PDT on the 14th. A UTC-derived date would
    // file this workout under the 15th and shift the whole table by a day.
    const evening = makeActivity({ startedAt: Date.parse("2026-08-15T02:00:00Z") });
    const f = deriveFacts([evening], Date.parse("2026-08-15T03:00:00Z"), LA);

    expect(f.recent[0]?.day).toBe("2026-08-14");
  });

  it("carries the Strava id but never the activity name", () => {
    const a = makeActivity({ id: 4242, name: "Morning Ride in Noe Valley" });
    const f = deriveFacts([a], NOW, LA);

    expect(f.recent[0]?.id).toBe(4242);
    expect(JSON.stringify(f.recent)).not.toContain("Noe Valley");
  });

  it("is empty when there are no activities", () => {
    expect(deriveFacts([], NOW, LA).recent).toEqual([]);
  });
});
