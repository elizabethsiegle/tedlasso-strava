import { describe, expect, it } from "vitest";
import { addDaysMs, calendarDaysBetween, dayKey, daysBetween, startOfDayMs } from "../../src/domain/time";

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

describe("calendarDaysBetween", () => {
  it("counts local midnights crossed, not elapsed hours", () => {
    // 21:44 PDT to 11:32 PDT the next morning: 13.8 hours, one calendar day.
    const ride = Date.parse("2026-08-20T04:44:00Z");
    const read = Date.parse("2026-08-20T18:32:00Z");
    expect(calendarDaysBetween(ride, read, LA)).toBe(1);
    // The same pair as elapsed time, which is what the bug reported.
    expect(daysBetween(ride, read)).toBeLessThan(1);
  });

  it("is zero for two instants on the same local day, however far apart", () => {
    // 00:30 PDT to 23:30 PDT on 2026-08-20: 23 hours, still today.
    expect(
      calendarDaysBetween(Date.parse("2026-08-20T07:30:00Z"), Date.parse("2026-08-21T06:30:00Z"), LA),
    ).toBe(0);
  });

  it("disagrees with UTC exactly where a night session crosses the UTC date", () => {
    const ride = Date.parse("2026-08-20T06:30:00Z"); // 23:30 PDT on the 19th
    const read = Date.parse("2026-08-20T07:30:00Z"); // 00:30 PDT on the 20th
    expect(calendarDaysBetween(ride, read, LA)).toBe(1);
    expect(calendarDaysBetween(ride, read, "UTC")).toBe(0);
  });

  it("counts the 25-hour fall-back day as one day", () => {
    const before = startOfDayMs(Date.parse("2026-11-01T12:00:00Z"), LA);
    expect(calendarDaysBetween(before, addDaysMs(before, 1, LA), LA)).toBe(1);
  });

  it("counts the 23-hour spring-forward day as one day", () => {
    const before = startOfDayMs(Date.parse("2026-03-08T12:00:00Z"), LA);
    const after = addDaysMs(before, 1, LA);
    expect(after - before).toBe(23 * 60 * 60 * 1000); // the short day
    expect(calendarDaysBetween(before, after, LA)).toBe(1);
  });

  it("is negative for an instant in the future, so callers can clamp to today", () => {
    const now = Date.parse("2026-08-20T18:00:00Z");
    expect(calendarDaysBetween(now + 2 * 86_400_000, now, LA)).toBe(-2);
  });
});
