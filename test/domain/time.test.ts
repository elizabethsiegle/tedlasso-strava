import { describe, expect, it } from "vitest";
import { addDaysMs, dayKey, daysBetween, startOfDayMs } from "../../src/domain/time";

const LA = "America/Los_Angeles";

describe("dayKey", () => {
  it("uses the given timezone, not UTC", () => {
    // 2026-03-10T03:00:00Z is still 2026-03-09 in Los Angeles.
    expect(dayKey(Date.parse("2026-03-10T03:00:00Z"), LA)).toBe("2026-03-09");
    expect(dayKey(Date.parse("2026-03-10T03:00:00Z"), "UTC")).toBe("2026-03-10");
  });

  it("zero-pads months and days", () => {
    expect(dayKey(Date.parse("2026-01-05T20:00:00Z"), LA)).toBe("2026-01-05");
  });
});

describe("startOfDayMs", () => {
  it("returns local midnight", () => {
    const noon = Date.parse("2026-08-14T19:00:00Z"); // 12:00 PDT
    expect(dayKey(startOfDayMs(noon, LA), LA)).toBe("2026-08-14");
    expect(new Date(startOfDayMs(noon, LA)).toISOString()).toBe("2026-08-14T07:00:00.000Z");
  });

  it("is idempotent", () => {
    const t = Date.parse("2026-08-14T19:00:00Z");
    expect(startOfDayMs(startOfDayMs(t, LA), LA)).toBe(startOfDayMs(t, LA));
  });
});

describe("addDaysMs across DST", () => {
  // US DST 2026: begins Sunday March 8, ends Sunday November 1. The transition
  // happens at 02:00 local, AFTER midnight — so the short and long days are
  // Mar 8→9 and Nov 1→2, not the days before them.
  it("crossing spring-forward keeps midnight at midnight over a 23-hour day", () => {
    const before = startOfDayMs(Date.parse("2026-03-08T20:00:00Z"), LA);
    const after = addDaysMs(before, 1, LA);
    expect(dayKey(before, LA)).toBe("2026-03-08");
    expect(dayKey(after, LA)).toBe("2026-03-09");
    expect(after - before).toBe(23 * 60 * 60 * 1000); // the short day
  });

  it("crossing fall-back keeps midnight at midnight over a 25-hour day", () => {
    const before = startOfDayMs(Date.parse("2026-11-01T20:00:00Z"), LA);
    const after = addDaysMs(before, 1, LA);
    expect(dayKey(before, LA)).toBe("2026-11-01");
    expect(dayKey(after, LA)).toBe("2026-11-02");
    expect(after - before).toBe(25 * 60 * 60 * 1000); // the long day
  });

  it("keeps an ordinary day at 24 hours", () => {
    const before = startOfDayMs(Date.parse("2026-08-14T19:00:00Z"), LA);
    expect(addDaysMs(before, 1, LA) - before).toBe(24 * 60 * 60 * 1000);
  });

  it("subtracts as well as adds", () => {
    const t = startOfDayMs(Date.parse("2026-08-14T19:00:00Z"), LA);
    expect(dayKey(addDaysMs(t, -3, LA), LA)).toBe("2026-08-11");
  });
});

describe("daysBetween", () => {
  it("returns fractional days", () => {
    const a = Date.parse("2026-08-14T00:00:00Z");
    const b = Date.parse("2026-08-15T12:00:00Z");
    expect(daysBetween(a, b)).toBeCloseTo(1.5, 6);
  });

  it("is negative when the second argument is earlier", () => {
    const a = Date.parse("2026-08-15T00:00:00Z");
    const b = Date.parse("2026-08-14T00:00:00Z");
    expect(daysBetween(a, b)).toBeCloseTo(-1, 6);
  });
});
