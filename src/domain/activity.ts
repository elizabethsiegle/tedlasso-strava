export interface Activity {
  id: number;
  name: string;
  sportType: string;
  distanceM: number;
  movingTimeS: number;
  elevationM: number;
  averageSpeed: number;          // metres per second
  sufferScore: number | null;
  startedAt: number;             // epoch ms
  summaryPolyline: string | null;
  locationLabel: string | null;
}

export interface LastActivity {
  name: string;
  sportType: string;
  distanceM: number;
  movingTimeS: number;
  elevationM: number;
  startedAt: number;
}

/**
 * One row of the published results table. Deliberately narrower than
 * `Activity`: no name — a title like "Morning Ride in Noe Valley" leaks the
 * place the route trimming exists to hide — and no polyline or speed. `day` is
 * the athlete's local calendar date, resolved here in the write path where the
 * timezone is known, so rendering never does timezone math and an evening
 * workout can't surface under tomorrow's date.
 */
export interface RecentActivity {
  id: number;
  sportType: string;
  distanceM: number;
  movingTimeS: number;
  day: string; // YYYY-MM-DD, athlete-local
}

export interface Facts {
  totalActivities: number;
  last: LastActivity | null;
  daysSinceLast: number | null;
  countLast7: number;
  countLast14: number;
  countLast28: number;
  baselineWeekly: number;
  streakDays: number;
  relEffortLast: number;
  isLongest90: boolean;
  isFastest90: boolean;
  previousGapDays: number | null;
  recent: RecentActivity[];
}
