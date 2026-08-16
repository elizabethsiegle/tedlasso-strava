import { describe, expect, it } from "vitest";
import type { Facts } from "../../src/domain/activity";
import { selectMood } from "../../src/domain/mood";

function facts(overrides: Partial<Facts> = {}): Facts {
  return {
    totalActivities: 10,
    last: {
      name: "Evening Run", sportType: "Run", distanceM: 8000,
      movingTimeS: 2400, elevationM: 60, startedAt: 0,
    },
    daysSinceLast: 4,
    countLast7: 2,
    countLast14: 4,
    countLast28: 8,
    baselineWeekly: 2,
    streakDays: 0,
    relEffortLast: 0.5,
    isLongest90: false,
    isFastest90: false,
    previousGapDays: 3,
    ...overrides,
  };
}

const MID = { consistency: 45, charge: 45 };

describe("override rules, in order", () => {
  it("1. no activities wins over everything", () => {
    const f = facts({ totalActivities: 0, last: null, daysSinceLast: null, isLongest90: true, streakDays: 9 });
    expect(selectMood(f, { consistency: 0, charge: 0 }).moodId).toBe("preseason");
  });

  it("2. ten or more days dormant", () => {
    expect(selectMood(facts({ daysSinceLast: 10 }), MID).moodId).toBe("whered-you-go");
  });

  it("2. exactly 10.0 days is dormant; 9.9 is not", () => {
    expect(selectMood(facts({ daysSinceLast: 10.0 }), MID).moodId).toBe("whered-you-go");
    expect(selectMood(facts({ daysSinceLast: 9.9 }), MID).moodId).not.toBe("whered-you-go");
  });

  it("3. a fresh 90-day best beats a streak", () => {
    const f = facts({ isLongest90: true, daysSinceLast: 1, streakDays: 9 });
    expect(selectMood(f, MID).moodId).toBe("believe");
  });

  it("3. fastest also qualifies", () => {
    expect(selectMood(facts({ isFastest90: true, daysSinceLast: 2 }), MID).moodId).toBe("believe");
  });

  it("3. a stale best does not qualify", () => {
    expect(selectMood(facts({ isLongest90: true, daysSinceLast: 5 }), MID).moodId).not.toBe("believe");
  });

  it("3. says 'today' when the best happened at zero days out", () => {
    const f = facts({ isLongest90: true, daysSinceLast: 0 });
    expect(selectMood(f, MID).reasons.join(" ")).toContain("today");
  });

  it("4. a five-day streak", () => {
    expect(selectMood(facts({ streakDays: 5, daysSinceLast: 0 }), MID).moodId).toBe("roy-kent");
  });

  it("5. back within two days after a week off", () => {
    const f = facts({ daysSinceLast: 1, previousGapDays: 8, streakDays: 1 });
    expect(selectMood(f, MID).moodId).toBe("comeback-szn");
  });

  it("5. does not fire when the gap was short", () => {
    const f = facts({ daysSinceLast: 1, previousGapDays: 2, streakDays: 1 });
    expect(selectMood(f, MID).moodId).not.toBe("comeback-szn");
  });

  it("5. does not fire with no previous activity to measure a gap against", () => {
    const f = facts({ daysSinceLast: 1, previousGapDays: null });
    expect(selectMood(f, MID).moodId).not.toBe("comeback-szn");
  });
});

describe("the score grid", () => {
  const plain = facts({ daysSinceLast: 4, streakDays: 0, previousGapDays: 2 });

  it("middle band on both axes is checked first", () => {
    expect(selectMood(plain, { consistency: 45, charge: 45 }).moodId).toBe("biscuits");
    expect(selectMood(plain, { consistency: 36, charge: 59 }).moodId).toBe("biscuits");
  });

  it("high and high", () => {
    expect(selectMood(plain, { consistency: 80, charge: 80 }).moodId).toBe("football-is-life");
  });

  it("high consistency, low charge", () => {
    expect(selectMood(plain, { consistency: 80, charge: 20 }).moodId).toBe("gaffer-mode");
  });

  it("low consistency, high charge", () => {
    expect(selectMood(plain, { consistency: 20, charge: 80 }).moodId).toBe("hopeful");
  });

  it("low and low", () => {
    expect(selectMood(plain, { consistency: 20, charge: 20 }).moodId).toBe("biscuits");
  });

  it("treats 60 as high on both axes", () => {
    expect(selectMood(plain, { consistency: 60, charge: 60 }).moodId).toBe("football-is-life");
  });

  it("a mid consistency with a low charge is not the middle-band mood", () => {
    expect(selectMood(plain, { consistency: 45, charge: 10 }).moodId).toBe("biscuits");
  });
});

describe("reasons", () => {
  it("always returns at least one reason", () => {
    expect(selectMood(facts(), MID).reasons.length).toBeGreaterThan(0);
  });

  it("never uses record language", () => {
    const f = facts({ isLongest90: true, daysSinceLast: 1 });
    const joined = selectMood(f, MID).reasons.join(" ").toLowerCase();
    expect(joined).not.toContain("personal record");
    expect(joined).not.toMatch(/\bpr\b/);
  });

  it("mentions the 90-day window when a best triggered the mood", () => {
    const f = facts({ isLongest90: true, daysSinceLast: 1 });
    expect(selectMood(f, MID).reasons.join(" ")).toContain("90 days");
  });

  it("reports the layoff length when dormant", () => {
    expect(selectMood(facts({ daysSinceLast: 12.4 }), MID).reasons.join(" ")).toContain("12 days");
  });

  it("compares this week against the athlete's own baseline", () => {
    const f = facts({ countLast7: 4, baselineWeekly: 2.5 });
    expect(selectMood(f, MID).reasons.join(" ")).toContain("2.5");
  });

  it("uses singular phrasing for exactly one workout this week", () => {
    const f = facts({ countLast7: 1 });
    const joined = selectMood(f, MID).reasons.join(" ");
    expect(joined).toContain("1 workout");
    expect(joined).not.toContain("workouts");
  });

  it("mentions an active streak below the roy-kent threshold", () => {
    const f = facts({ streakDays: 3 });
    expect(selectMood(f, MID).reasons.join(" ")).toContain("3 days in a row");
  });

  it("still gives a reason when there is nothing to report this week", () => {
    const f = facts({ countLast7: 0, streakDays: 0, daysSinceLast: 4, previousGapDays: 2 });
    expect(selectMood(f, MID).reasons.length).toBeGreaterThan(0);
  });
});
