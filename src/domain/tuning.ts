export const TUNING = {
  // Fetch window
  WINDOW_DAYS: 90,
  MAX_PAGES: 2,
  PER_PAGE: 200,

  // Baseline
  BASELINE_WEEKS: 12,
  MIN_WEEKS_FOR_BASELINE: 4,

  // relEffortLast
  MIN_EFFORT_SAMPLES: 5,
  NEUTRAL_EFFORT: 0.5,

  // Record detection
  MIN_RECORD_SAMPLES: 3,
  FASTEST_DISTANCE_GUARD: 0.8,

  // Consistency
  VOLUME_RATIO_CAP: 1.5,
  FLOOR28_TARGET: 12,
  STREAK_TARGET: 5,
  W_VOLUME: 0.55,
  W_FLOOR28: 0.30,
  W_STREAK: 0.15,
  RECENCY_GRACE_DAYS: 3,
  RECENCY_SPAN_DAYS: 11,
  RECENCY_FLOOR: 0.15,

  // Charge
  CHARGE_HALF_LIFE_DAYS: 3,

  // Mood selection
  DORMANT_DAYS: 10,
  RECENT_DAYS: 2,
  STREAK_MOOD_DAYS: 5,
  COMEBACK_GAP_DAYS: 7,
  GRID_HIGH: 60,
  GRID_LOW: 35,

  // Route
  DEFAULT_PRIVACY_TRIM_M: 250,
  MAX_ROUTE_POINTS: 300,
  ROUTE_VIEWBOX: 1000,
  ROUTE_PADDING: 40,

  // Basemap. The frame is a fixed reference pixel box (the tile layer and the
  // overlay path are both laid out in it, then scaled fluidly by CSS), so its
  // proportions are a design decision: a shallow landscape crop, closer to a
  // programme's pitch diagram than a square.
  BASEMAP_WIDTH: 1000,
  BASEMAP_HEIGHT: 560,
  BASEMAP_PADDING: 56,
  // Floor: below z3 the tiles are continents and the route is a dot. Ceiling:
  // z16 is street-level, past which the trimmed route stops fitting anyway.
  BASEMAP_MIN_ZOOM: 3,
  BASEMAP_MAX_ZOOM: 16,
  BASEMAP_TILE_MAX_AGE_S: 2_592_000,

  // Workload chart. Deliberately its own constant rather than a reuse of
  // BASELINE_WEEKS: the mood engine's baseline window is a tuning knob for the
  // engine, and retuning it should not silently redraw the chart. 12 weeks is
  // 84 days, comfortably inside the 90-day fetch window.
  WORKLOAD_WEEKS: 12,

  // Presentation
  // Rows in the published results table. Every row is one more activity id on
  // a public page, so this stays small: enough to show the week the mood copy
  // is claiming, not a browsable training log.
  RESULTS_ROWS: 8,
  STALE_SNAPSHOT_HOURS: 12,
  STALE_VERIFIED_DAYS: 180,
  MANUAL_REFRESH_COOLDOWN_MS: 60_000,
  OAUTH_STATE_TTL_S: 600,
  REFRESH_ANIMATION_MS: 1200,
  // Matches the `triggers.crons` schedule in wrangler.jsonc (`0 */4 * * *`).
  // Used by the footer's "next scheduled run" display.
  CRON_INTERVAL_MS: 4 * 60 * 60 * 1000,
} as const;

export const DAY_MS = 86_400_000;
