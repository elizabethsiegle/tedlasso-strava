import { describe, expect, it } from "vitest";
import { deriveFacts } from "../../src/domain/facts";
import { daysAgo, makeActivity } from "../fixtures/activities";

const LA = "America/Los_Angeles";
const NOW = Date.parse("2026-08-14T19:00:00Z"); // Friday noon PDT

describe("deriveFacts with no activities", () => {
  const f = deriveFacts([], NOW, LA);

  it("reports zero totals and null last", () => {
    expect(f.totalActivities).toBe(0);
    expect(f.last).toBeNull();
    expect(f.daysSinceLast).toBeNull();
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
