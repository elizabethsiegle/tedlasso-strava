import type { Facts } from "./activity";
import { TUNING } from "./tuning";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function scoreConsistency(f: Facts): number {
  if (f.totalActivities === 0 || f.daysSinceLast === null) return 0;

  const volumeRatio = f.countLast7 / Math.max(f.baselineWeekly, 1);
  const vol = Math.min(volumeRatio, TUNING.VOLUME_RATIO_CAP) / TUNING.VOLUME_RATIO_CAP;
  const floor28 = Math.min(f.countLast28 / TUNING.FLOOR28_TARGET, 1);
  const streakPart = Math.min(f.streakDays / TUNING.STREAK_TARGET, 1);

  const raw =
    TUNING.W_VOLUME * vol + TUNING.W_FLOOR28 * floor28 + TUNING.W_STREAK * streakPart;

  const recency = clamp(
    1 - (f.daysSinceLast - TUNING.RECENCY_GRACE_DAYS) / TUNING.RECENCY_SPAN_DAYS,
    TUNING.RECENCY_FLOOR,
    1,
  );

  return Math.round(100 * raw * recency);
}

export function scoreCharge(f: Facts): number {
  if (f.totalActivities === 0 || f.daysSinceLast === null) return 0;
  const decay = 0.5 ** (f.daysSinceLast / TUNING.CHARGE_HALF_LIFE_DAYS);
  return Math.round(100 * f.relEffortLast * decay);
}
