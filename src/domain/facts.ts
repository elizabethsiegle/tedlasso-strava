import type { Activity, Facts, LastActivity } from "./activity";
import { addDaysMs, dayKey, daysBetween, startOfDayMs } from "./time";
import { DAY_MS, TUNING } from "./tuning";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function toLastActivity(a: Activity): LastActivity {
  return {
    name: a.name,
    sportType: a.sportType,
    distanceM: a.distanceM,
    movingTimeS: a.movingTimeS,
    elevationM: a.elevationM,
    startedAt: a.startedAt,
  };
}

function computeStreak(activities: Activity[], nowMs: number, tz: string): number {
  if (activities.length === 0) return 0;
  const days = new Set(activities.map((a) => dayKey(a.startedAt, tz)));
  const todayStart = startOfDayMs(nowMs, tz);

  let cursor = todayStart;
  if (!days.has(dayKey(cursor, tz))) {
    cursor = addDaysMs(cursor, -1, tz);
    if (!days.has(dayKey(cursor, tz))) return 0;
  }

  let streak = 0;
  while (days.has(dayKey(cursor, tz))) {
    streak++;
    cursor = addDaysMs(cursor, -1, tz);
  }
  return streak;
}

function computeBaseline(activities: Activity[], nowMs: number, tz: string, countLast28: number): number {
  if (activities.length === 0) return 0;

  const todayStart = startOfDayMs(nowMs, tz);
  const oldest = activities[activities.length - 1] as Activity;
  const historyDays = daysBetween(oldest.startedAt, nowMs);
  if (historyDays < TUNING.MIN_WEEKS_FOR_BASELINE * 7) {
    return countLast28 / 4;
  }

  const baselineEnd = addDaysMs(todayStart, -6, tz);
  const counts: number[] = [];
  for (let k = 0; k < TUNING.BASELINE_WEEKS; k++) {
    const end = addDaysMs(baselineEnd, -7 * k, tz);
    const start = addDaysMs(baselineEnd, -7 * (k + 1), tz);
    counts.push(activities.filter((a) => a.startedAt >= start && a.startedAt < end).length);
  }
  return median(counts);
}

export function deriveFacts(activities: Activity[], nowMs: number, tz: string): Facts {
  const windowStart = nowMs - TUNING.WINDOW_DAYS * DAY_MS;
  const inWindow = activities
    .filter((a) => a.startedAt >= windowStart && a.startedAt <= nowMs)
    .sort((a, b) => b.startedAt - a.startedAt);

  const last = inWindow[0];
  const previous = inWindow[1];
  const countWithin = (days: number): number =>
    inWindow.filter((a) => daysBetween(a.startedAt, nowMs) <= days).length;

  const countLast28 = countWithin(28);

  return {
    totalActivities: inWindow.length,
    last: last ? toLastActivity(last) : null,
    daysSinceLast: last ? daysBetween(last.startedAt, nowMs) : null,
    countLast7: countWithin(7),
    countLast14: countWithin(14),
    countLast28,
    baselineWeekly: computeBaseline(inWindow, nowMs, tz, countLast28),
    streakDays: computeStreak(inWindow, nowMs, tz),
    previousGapDays: last && previous ? daysBetween(previous.startedAt, last.startedAt) : null,
    // Task 4 replaces these three.
    relEffortLast: TUNING.NEUTRAL_EFFORT,
    isLongest90: false,
    isFastest90: false,
  };
}
