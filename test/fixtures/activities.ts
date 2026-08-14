import type { Activity } from "../../src/domain/activity";

let nextId = 1;

export function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: nextId++,
    name: "Morning Run",
    sportType: "Run",
    distanceM: 5000,
    movingTimeS: 1800,
    elevationM: 40,
    averageSpeed: 5000 / 1800,
    sufferScore: null,
    startedAt: Date.parse("2026-08-14T15:00:00Z"),
    summaryPolyline: null,
    locationLabel: null,
    ...overrides,
  };
}

/** Activities at the given whole-day offsets before `nowMs`, most recent first. */
export function daysAgo(nowMs: number, offsets: number[], overrides: Partial<Activity> = {}): Activity[] {
  return offsets.map((d) =>
    makeActivity({ startedAt: nowMs - d * 86_400_000, ...overrides }),
  );
}
