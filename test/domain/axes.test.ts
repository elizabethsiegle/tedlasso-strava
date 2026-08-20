import { describe, expect, it } from "vitest";
import type { Facts } from "../../src/domain/activity";
import { clamp, scoreCharge, scoreConsistency } from "../../src/domain/axes";

function facts(overrides: Partial<Facts> = {}): Facts {
  const built: Facts = {
    totalActivities: 10,
    last: {
      name: "Run", sportType: "Run", distanceM: 5000,
      movingTimeS: 1800, elevationM: 0, startedAt: 0,
    },
    daysSinceLast: 1,
    countLast7: 3,
    countLast14: 6,
    countLast28: 12,
    baselineWeekly: 3,
    streakDays: 0,
    relEffortLast: 0.5,
    isLongest90: false,
    isFastest90: false,
    previousGapDays: 2,
    calendarDaysSinceLast: 1,
    ...overrides,
  };
  // The two day counts must not contradict each other: unless a test pins the
  // calendar one deliberately, derive it from whatever elapsed value it used.
  if (overrides.calendarDaysSinceLast === undefined) {
    built.calendarDaysSinceLast =
      built.daysSinceLast === null ? null : Math.floor(built.daysSinceLast);
  }
  return built;
}

describe("clamp", () => {
  it("bounds on both sides and passes through in range", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.4, 0, 1)).toBeCloseTo(0.4, 6);
  });
});

describe("scoreConsistency", () => {
  it("is 0 with no activities", () => {
    expect(scoreConsistency(facts({ totalActivities: 0, daysSinceLast: null }))).toBe(0);
  });

  it("is 100 at maximum volume, maximum 4-week floor, and a full streak", () => {
    const f = facts({ countLast7: 10, baselineWeekly: 2, countLast28: 20, streakDays: 7, daysSinceLast: 0 });
    expect(scoreConsistency(f)).toBe(100);
  });

  it("caps the volume term at 150% of baseline", () => {
    const a = scoreConsistency(facts({ countLast7: 3, baselineWeekly: 2, streakDays: 0 }));
    const b = scoreConsistency(facts({ countLast7: 30, baselineWeekly: 2, streakDays: 0 }));
    expect(a).toBe(b);
  });

  it("holds recency at full strength through day 3", () => {
    const a = scoreConsistency(facts({ daysSinceLast: 0 }));
    const b = scoreConsistency(facts({ daysSinceLast: 3 }));
    expect(a).toBe(b);
  });

  it("decays after day 3 and floors at day 14", () => {
    const day3 = scoreConsistency(facts({ daysSinceLast: 3 }));
    const day8 = scoreConsistency(facts({ daysSinceLast: 8 }));
    const day14 = scoreConsistency(facts({ daysSinceLast: 14 }));
    const day40 = scoreConsistency(facts({ daysSinceLast: 40 }));
    expect(day8).toBeLessThan(day3);
    expect(day14).toBeLessThan(day8);
    expect(day40).toBe(day14); // the 0.15 floor
    expect(day14).toBeGreaterThan(0);
  });

  it("treats a baseline below 1 as 1 so a returning athlete is not inflated", () => {
    const f = facts({ countLast7: 1, baselineWeekly: 0.2, countLast28: 1, streakDays: 0 });
    expect(scoreConsistency(f)).toBeLessThan(50);
  });
});

describe("scoreCharge", () => {
  it("is 0 with no activities", () => {
    expect(scoreCharge(facts({ totalActivities: 0, daysSinceLast: null, relEffortLast: 0 }))).toBe(0);
  });

  it("matches the spec's worked examples", () => {
    expect(scoreCharge(facts({ relEffortLast: 1, daysSinceLast: 1 }))).toBe(79);
    expect(scoreCharge(facts({ relEffortLast: 1, daysSinceLast: 9 }))).toBe(13);
  });

  it("halves every three days", () => {
    const fresh = scoreCharge(facts({ relEffortLast: 1, daysSinceLast: 0 }));
    const later = scoreCharge(facts({ relEffortLast: 1, daysSinceLast: 3 }));
    expect(fresh).toBe(100);
    expect(later).toBe(50);
  });

  it("scales with effort", () => {
    expect(scoreCharge(facts({ relEffortLast: 0, daysSinceLast: 0 }))).toBe(0);
    expect(scoreCharge(facts({ relEffortLast: 0.5, daysSinceLast: 0 }))).toBe(50);
  });
});
