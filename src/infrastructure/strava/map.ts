import type { Activity } from "../../domain/activity";

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function locationLabel(raw: Record<string, unknown>): string | null {
  const city = str(raw.location_city);
  const state = str(raw.location_state);
  if (city && state) return `${city}, ${state}`;
  return city ?? state ?? null;
}

/** Returns null for records the domain cannot use, rather than throwing. */
export function mapActivity(raw: unknown): Activity | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const startedAt = typeof r.start_date === "string" ? Date.parse(r.start_date) : NaN;
  if (!Number.isFinite(startedAt)) return null;

  const map = (typeof r.map === "object" && r.map !== null ? r.map : {}) as Record<string, unknown>;

  return {
    id: num(r.id),
    name: str(r.name) ?? "Untitled activity",
    sportType: str(r.sport_type) ?? str(r.type) ?? "Workout",
    distanceM: num(r.distance),
    movingTimeS: num(r.moving_time),
    elevationM: num(r.total_elevation_gain),
    averageSpeed: num(r.average_speed),
    sufferScore: typeof r.suffer_score === "number" ? r.suffer_score : null,
    startedAt,
    summaryPolyline: str(map.summary_polyline),
    locationLabel: locationLabel(r),
  };
}
