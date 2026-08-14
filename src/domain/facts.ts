import type { Activity, Facts, LastActivity } from "./activity";
import { addDaysMs, dayKey, daysBetween, startOfDayMs } from "./time";
import { DAY_MS, TUNING } from "./tuning";

export function median(values: number[]): number {
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

function effort(a: Activity): number {
  return a.sufferScore ?? a.movingTimeS / 60;
}

/** Fraction of `others` with strictly lower effort than `target`. */
function percentileRank(target: Activity, others: Activity[]): number {
  const lower = others.filter((o) => effort(o) < effort(target)).length;
  return lower / others.length;
}

function computeRelEffort(last: Activity, others: Activity[]): number {
  const sameSport = others.filter((o) => o.sportType === last.sportType);
  if (sameSport.length >= TUNING.MIN_EFFORT_SAMPLES) return percentileRank(last, sameSport);
  if (others.length >= TUNING.MIN_EFFORT_SAMPLES) return percentileRank(last, others);
  return TUNING.NEUTRAL_EFFORT;
}

function computeIsLongest(last: Activity, others: Activity[]): boolean {
  const sameSport = others.filter((o) => o.sportType === last.sportType);
  if (sameSport.length < TUNING.MIN_RECORD_SAMPLES) return false;
  return sameSport.every((o) => o.distanceM < last.distanceM);
}

function computeIsFastest(last: Activity, others: Activity[]): boolean {
  // Symmetric band. A one-sided lower bound would let a 1km sprint outrun every
  // 10km entry and register as a 90-day best — the case the guard exists to stop.
  // Not "personal record" — activity summaries lack best-effort data, so this is
  // deliberately scoped as "fastest among comparable 90-day distances".
  const lower = TUNING.FASTEST_DISTANCE_GUARD * last.distanceM;
  const upper = last.distanceM / TUNING.FASTEST_DISTANCE_GUARD;
  const comparable = others.filter(
    (o) => o.sportType === last.sportType && o.distanceM >= lower && o.distanceM <= upper,
  );
  if (comparable.length < TUNING.MIN_RECORD_SAMPLES) return false;
  return comparable.every((o) => o.averageSpeed < last.averageSpeed);
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
    // "Longest/fastest in 90 days" — never "personal record"/"PR": activity
    // summaries don't carry best-effort data, so these are scoped to the window.
    relEffortLast: last ? computeRelEffort(last, inWindow.slice(1)) : 0,
    isLongest90: last ? computeIsLongest(last, inWindow.slice(1)) : false,
    isFastest90: last ? computeIsFastest(last, inWindow.slice(1)) : false,
  };
}
