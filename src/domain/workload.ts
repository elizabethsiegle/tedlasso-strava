import type { Activity } from "./activity";
import { median } from "./facts";
import { addDaysMs, startOfDayMs } from "./time";
import { TUNING } from "./tuning";

/**
 * Weekly training volume, for the strip chart printed under the route.
 *
 * The buckets are rolling 7-day windows anchored to the athlete's today, which
 * is the same convention `computeBaseline` uses in facts.ts. That is deliberate:
 * "this week" has to mean the same thing in the chart as it does in the receipts
 * row directly above it, or the page argues with itself.
 */
export interface WorkloadWeek {
  /** Inclusive start of the window (start of day, athlete timezone), epoch ms. */
  startMs: number;
  count: number;
  movingTimeS: number;
  distanceM: number;
}

export interface Workload {
  /** Oldest first, so the chart reads left to right the way a calendar does. */
  weeks: WorkloadWeek[];
  /**
   * Median weekly moving time across the window, in seconds.
   *
   * Zero weeks are counted, not dropped. A rest week is data; excluding it
   * would inflate the "usual" line into a number the athlete never actually
   * held, and the whole point of the line is that it is honest about the middle.
   */
  medianMovingTimeS: number;
}

/**
 * Null rather than an empty shell when there is nothing to draw, so the renderer
 * has one condition to check instead of three. An athlete with no activities in
 * the window already gets the "quiet on the pitch" notice up the page; a flat
 * chart of twelve zero-height bars underneath it would just be noise.
 */
export function buildWorkload(activities: Activity[], nowMs: number, tz: string): Workload | null {
  if (activities.length === 0) return null;

  // Exclusive upper bound: the start of tomorrow, so today's own sessions land
  // in the newest bucket instead of falling off the end of the chart.
  const tomorrowStart = addDaysMs(startOfDayMs(nowMs, tz), 1, tz);

  const weeks: WorkloadWeek[] = [];
  for (let k = TUNING.WORKLOAD_WEEKS - 1; k >= 0; k--) {
    const end = addDaysMs(tomorrowStart, -7 * k, tz);
    const start = addDaysMs(end, -7, tz);
    const inWeek = activities.filter((a) => a.startedAt >= start && a.startedAt < end);
    weeks.push({
      startMs: start,
      count: inWeek.length,
      movingTimeS: inWeek.reduce((total, a) => total + a.movingTimeS, 0),
      distanceM: inWeek.reduce((total, a) => total + a.distanceM, 0),
    });
  }

  // Every activity we hold can still sit outside the charted window (the fetch
  // window is 90 days, the chart is 84), which would otherwise print an
  // all-zero chart while the page above it reports activities.
  if (weeks.every((w) => w.count === 0)) return null;

  return { weeks, medianMovingTimeS: median(weeks.map((w) => w.movingTimeS)) };
}
