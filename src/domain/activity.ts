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
}
