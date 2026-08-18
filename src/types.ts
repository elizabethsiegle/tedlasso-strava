import type { MediaKind } from "./data/moods";
import type { LastActivity, RecentActivity } from "./domain/activity";
import type { RouteRender } from "./domain/route";

export interface PublicFacts {
  last: LastActivity | null;
  daysSinceLast: number | null;
  countLast7: number;
  baselineWeekly: number;
  streakDays: number;
  totalActivities: number;
  // Absent from snapshots written before the results table shipped. Rendering
  // must tolerate that rather than assume the array is there.
  recent?: RecentActivity[];
}

export interface Snapshot {
  version: 1;
  refreshedAt: number;
  mood: { id: string; name: string; accent: string };
  quote: { text: string; character: string };
  // `verifiedOn` rides along from the catalogue entry (src/data/moods.ts) so
  // the footer can flag a stale link without re-looking up the catalogue at
  // render time. The field name predates non-GIF media and is kept as-is:
  // renaming it would orphan every snapshot already in KV for no reader-visible
  // gain. `kind` is optional for the same reason — a snapshot written before it
  // existed is treated as a gif.
  gif: { url: string; alt: string; verifiedOn: string; kind?: MediaKind } | null;
  scores: { consistency: number; charge: number };
  reasons: string[];
  facts: PublicFacts;
  route: RouteRender | null;
}

export interface Health {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  needsReauth: boolean;
}

export const EMPTY_HEALTH: Health = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  needsReauth: false,
};
