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

export interface Facts {
  totalActivities: number;
  last: LastActivity | null;
  /** Elapsed days, fractional. The mood engine's thresholds are durations. */
  daysSinceLast: number | null;
  /**
   * Whole calendar days in the athlete's timezone. Only for prose that says
   * "today"/"yesterday"; never for a threshold, or "dormant for 10 days" would
   * start meaning something different.
   */
  calendarDaysSinceLast: number | null;
  countLast7: number;
  countLast14: number;
  countLast28: number;
  baselineWeekly: number;
  streakDays: number;
  relEffortLast: number;
  isLongest90: boolean;
  isFastest90: boolean;
  previousGapDays: number | null;
}
