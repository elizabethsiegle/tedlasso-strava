import type { Facts } from "./activity";
import { TUNING } from "./tuning";

export interface Scores {
  consistency: number;
  charge: number;
}

export interface Selection {
  moodId: string;
  reasons: string[];
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Exported so app/render.ts's receipts table formats the same number the
 * exact same way the reasons text does — the two used to be a byte-identical
 * copy living in each file, which is exactly the kind of drift that lets the
 * same page contradict itself if only one copy is ever touched again.
 */
export function formatCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Facts worth showing regardless of which rule fired. */
function commonReasons(f: Facts): string[] {
  const out: string[] = [];

  if (f.countLast7 > 0) {
    out.push(
      `${f.countLast7} ${plural(f.countLast7, "workout", "workouts")} this week, ` +
        `against your usual ${formatCount(f.baselineWeekly)}`,
    );
  }
  if (f.streakDays >= 2) {
    out.push(`${f.streakDays} days in a row`);
  }
  return out;
}

export function selectMood(f: Facts, scores: Scores): Selection {
  // 1. Nothing to go on.
  if (f.totalActivities === 0) {
    return {
      moodId: "peacetime",
      reasons: ["No activities in the last 90 days — the season hasn't kicked off yet"],
    };
  }

  // deriveFacts guarantees daysSinceLast is non-null whenever totalActivities
  // > 0, but Facts is a plain interface a caller could construct otherwise —
  // fall back to 0 rather than trust that invariant across a file boundary.
  const days = f.daysSinceLast ?? 0;

  // 2. Dormant.
  if (days >= TUNING.DORMANT_DAYS) {
    return {
      moodId: "idleness",
      reasons: [`${Math.floor(days)} days since your last activity`, ...commonReasons(f)],
    };
  }

  // 3. A fresh 90-day best.
  if ((f.isLongest90 || f.isFastest90) && days <= TUNING.RECENT_DAYS) {
    const what = f.isLongest90 ? "longest" : "fastest";
    const sport = f.last?.sportType.toLowerCase() ?? "session";
    const when = days < 1 ? "today" : days < 2 ? "yesterday" : "two days ago";
    return {
      moodId: "virtu",
      reasons: [`Your ${what} ${sport} in 90 days, and it was ${when}`, ...commonReasons(f)],
    };
  }

  // 4. On a run of days.
  if (f.streakDays >= TUNING.STREAK_MOOD_DAYS) {
    return {
      moodId: "the-lion",
      reasons: [`${f.streakDays} days in a row and still going`, ...commonReasons(f).slice(0, 1)],
    };
  }

  // 5. Back after a layoff.
  if (days <= TUNING.RECENT_DAYS && f.previousGapDays !== null && f.previousGapDays >= TUNING.COMEBACK_GAP_DAYS) {
    return {
      moodId: "fortuna",
      reasons: [
        `Back at it after ${Math.floor(f.previousGapDays)} days off`,
        ...commonReasons(f),
      ],
    };
  }

  // Grid fallback. The middle band is checked first, before the four
  // quadrants — a score of exactly GRID_HIGH counts as high on that axis, not
  // as part of the band.
  const { consistency, charge } = scores;
  const inBand = (n: number): boolean => n > TUNING.GRID_LOW && n < TUNING.GRID_HIGH;
  const reasons = commonReasons(f);
  if (reasons.length === 0) reasons.push(`${Math.floor(days)} days since your last activity`);

  if (inBand(consistency) && inBand(charge)) return { moodId: "good-counsel", reasons };
  if (consistency >= TUNING.GRID_HIGH && charge >= TUNING.GRID_HIGH) {
    return { moodId: "arms-of-your-own", reasons };
  }
  if (consistency >= TUNING.GRID_HIGH) return { moodId: "fortified-city", reasons };
  if (charge >= TUNING.GRID_HIGH) return { moodId: "the-impetuous", reasons };
  return { moodId: "benefit-of-time", reasons };
}
