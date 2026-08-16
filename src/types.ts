import type { LastActivity } from "./domain/activity";
import type { RouteRender } from "./domain/route";

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
  gif: { url: string; alt: string } | null;
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
