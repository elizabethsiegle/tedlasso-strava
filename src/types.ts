import type { LastActivity } from "./domain/activity";
import type { RouteRender } from "./domain/route";
import type { Workload } from "./domain/workload";

export interface PublicFacts {
  last: LastActivity | null;
  daysSinceLast: number | null;
  countLast7: number;
  baselineWeekly: number;
  streakDays: number;
  totalActivities: number;
}

export interface Snapshot {
  version: 1;
  refreshedAt: number;
  mood: { id: string; name: string; accent: string };
  quote: { text: string; character: string };
  // `verifiedOn` rides along from the catalogue entry (src/data/moods.ts) so
  // the footer can flag a stale GIF link without re-looking up the catalogue
  // at render time.
  gif: { url: string; alt: string; verifiedOn: string } | null;
  scores: { consistency: number; charge: number };
  reasons: string[];
  facts: PublicFacts;
  route: RouteRender | null;
  // Optional, not just nullable: snapshots written before the chart existed
  // have no `workload` key at all, and the renderer has to survive reading
  // one of those straight out of KV.
  workload?: Workload | null;
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
