import { DAY_MS } from "./tuning";

/**
 * Offset in ms between the given timezone's wall clock and UTC at that instant.
 * Uses Intl rather than a fixed table so DST is handled by the runtime.
 * `new Date(epochMs)` here reads an argument, not the system clock.
 */
function tzOffsetMs(epochMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(epochMs));
  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    /* istanbul ignore next -- Intl.DateTimeFormat returns all six requested part
       types for any valid IANA zone; an invalid zone throws at construction, so
       this guard is unreachable without mocking Intl internals. */
    if (!found) throw new Error(`missing ${type} for timezone ${tz}`);
    return Number(found.value);
  };
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - epochMs;
}

export function dayKey(epochMs: number, tz: string): string {
  const local = new Date(epochMs + tzOffsetMs(epochMs, tz));
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfDayMs(epochMs: number, tz: string): number {
  const offset = tzOffsetMs(epochMs, tz);
  const local = epochMs + offset;
  const localMidnight = local - (local % DAY_MS + DAY_MS) % DAY_MS;
  // Re-resolve the offset at the candidate instant: the offset at local noon and
  // at local midnight can differ on a DST transition day.
  const candidate = localMidnight - offset;
  const corrected = localMidnight - tzOffsetMs(candidate, tz);
  return corrected;
}

export function addDaysMs(epochMs: number, days: number, tz: string): number {
  const naive = epochMs + days * DAY_MS;
  // Preserve wall-clock time by correcting for any offset change across the span.
  return naive + (tzOffsetMs(epochMs, tz) - tzOffsetMs(naive, tz));
}

export function daysBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / DAY_MS;
}

/**
 * Whole calendar days between two instants, counted in `tz`, not elapsed time.
 *
 * "Today" and "yesterday" are calendar words: a 21:44 ride is yesterday by
 * lunchtime even though only 13 hours have passed, and `daysBetween` would
 * still call that 0.57 days. The timezone is load-bearing rather than
 * decorative: a night ride in Pacific time has already rolled over into the
 * next UTC day, so counting in UTC gets the same answer wrong.
 *
 * Rounds the gap between the two local midnights, so a DST transition day
 * (23 or 25 hours long) still counts as one day.
 */
export function calendarDaysBetween(fromMs: number, toMs: number, tz: string): number {
  return Math.round((startOfDayMs(toMs, tz) - startOfDayMs(fromMs, tz)) / DAY_MS);
}
