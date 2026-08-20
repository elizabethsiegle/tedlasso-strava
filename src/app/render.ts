import { getMood, type Mood } from "../data/moods";
import { formatCount } from "../domain/mood";
import type { BasemapRender } from "../domain/basemap";
import type { RouteRender } from "../domain/route";
import { addDaysMs, calendarDaysBetween, dayKey } from "../domain/time";
import { DAY_MS, TUNING } from "../domain/tuning";
import type { Workload } from "../domain/workload";
import type { Health, Snapshot } from "../types";
import { REFRESH_SCRIPT } from "./client";
import { STYLES } from "./styles";

/** `YYYY-MM-DD HH:MM UTC` -- plain and unambiguous, no locale guessing. */
function formatUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/**
 * The cron (see wrangler.jsonc, TUNING.CRON_INTERVAL_MS) fires every 4th UTC
 * hour, on the hour. 1970-01-01 is itself a 4-hour boundary, so integer
 * division by the period lines up with UTC hours directly; no calendar math
 * needed.
 */
function nextScheduledRunMs(nowMs: number): number {
  const interval = TUNING.CRON_INTERVAL_MS;
  return (Math.floor(nowMs / interval) + 1) * interval;
}

/** A GIF whose catalogue entry hasn't been re-checked in STALE_VERIFIED_DAYS. */
export function isGifStale(verifiedOn: string, nowMs: number): boolean {
  const verifiedMs = Date.parse(verifiedOn);
  if (!Number.isFinite(verifiedMs)) return false;
  return (nowMs - verifiedMs) / DAY_MS > TUNING.STALE_VERIFIED_DAYS;
}

export interface PageView {
  snapshot: Snapshot | null;
  health: Health;
  nowMs: number;
  showRefreshButton: boolean;
  previewNotice: string | null;
  setupKey?: string;
  /** The athlete's timezone (env.TIMEZONE), for calendar-relative wording. */
  tz?: string;
  /** Defaults to on. `BASEMAP=off` turns the tile layer off without a re-fetch. */
  showBasemap?: boolean;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function km(metres: number): string {
  return (metres / 1000).toFixed(1);
}

/** Decimal hours, for the form guide: comparable across weeks in a way "1h 30m" is not. */
function hoursLabel(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

/**
 * "2 Jun" in the athlete's own calendar, built from `dayKey` and a fixed table
 * rather than `toLocaleDateString`, for the same reason `formatUtc` exists: no locale
 * guessing, and a test can assert the exact string.
 */
function shortDate(epochMs: number, tz: string): string {
  const parts = dayKey(epochMs, tz).split("-");
  const month = MONTHS[Number(parts[1]) - 1] ?? "";
  return `${Number(parts[2])} ${month}`;
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Calendar words from a calendar comparison, in the athlete's timezone.
 *
 * This deliberately does not use `facts.daysSinceLast`: that is elapsed time,
 * so a 21:44 ride read as "today" until 21:44 the following night. It also
 * cannot be done in UTC, because a Pacific night ride is already the next UTC
 * day. Computed at render time from `startedAt`, so it corrects snapshots that
 * were written before this fix without waiting for a refresh.
 */
function agoLabel(startedAtMs: number | null, nowMs: number, tz: string): string {
  if (startedAtMs === null) return "—";
  const days = calendarDaysBetween(startedAtMs, nowMs, tz);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * `2026-08-13` -> `Wed 13 Aug`. The date arrives already resolved to the
 * athlete's local day (see RecentActivity), so it is parsed as UTC purely to
 * split the string — no timezone is applied here.
 */
function resultDate(day: string): string {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms)) return day;
  const d = new Date(ms);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * The results table: the evidence behind the mood copy's claims about streaks
 * and weekly counts. Each row links out to the activity on Strava, which
 * resolves for a visitor only if that activity is public on Strava — the link
 * grants no access the athlete hasn't already granted there.
 */
function results(snapshot: Snapshot): string {
  const recent = snapshot.facts.recent ?? [];
  if (recent.length === 0) return "";

  const rows = recent
    .map((a) => {
      const sport = escapeHtml(a.sportType);
      const when = escapeHtml(resultDate(a.day));
      const href = `https://www.strava.com/activities/${encodeURIComponent(String(a.id))}`;
      // An indoor session has no trace to draw. A dash says so plainly rather
      // than leaving a hole in the column.
      const glyph = a.glyph
        ? `<svg class="results-trace" viewBox="${escapeHtml(a.glyph.viewBox)}" role="presentation" focusable="false"><path d="${escapeHtml(a.glyph.pathD)}" fill="none" stroke="currentColor" stroke-width="90" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        : `<span class="results-indoor" title="No GPS trace">&mdash;</span>`;
      return `<tr>
        <td class="results-day">${when}</td>
        <td>${sport}</td>
        <td class="results-glyph">${glyph}</td>
        <td class="results-num">${km(a.distanceM)} km</td>
        <td class="results-num">${duration(a.movingTimeS)}</td>
        <td class="results-out"><a href="${href}" rel="noopener" aria-label="View this ${sport} on Strava">&#8599;</a></td>
      </tr>`;
    })
    .join("");

  return `<section class="results">
    <h2 class="results-head">Results — last ${recent.length}</h2>
    <table><tbody>${rows}</tbody></table>
  </section>`;
}

function receipts(snapshot: Snapshot, nowMs: number, tz: string): string {
  const f = snapshot.facts;
  const rows: [string, string][] = [
    ["Last out", f.last ? escapeHtml(f.last.name) : "Nothing yet"],
    ["Sport", f.last ? escapeHtml(f.last.sportType) : "—"],
    ["Distance", f.last ? `${km(f.last.distanceM)} km` : "—"],
    ["Time", f.last ? duration(f.last.movingTimeS) : "—"],
    ["When", agoLabel(f.last?.startedAt ?? null, nowMs, tz)],
    ["This week", `${f.countLast7} vs your usual ${formatCount(f.baselineWeekly)}`],
    ["Streak", f.streakDays > 0 ? `${f.streakDays} days` : "—"],
    ["Last 90 days", `${f.totalActivities} activities`],
  ];

  return `<table class="receipts"><tbody>${rows
    .map(([label, value]) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`)
    .join("")}</tbody></table>`;
}

/**
 * The snapshot is JSON out of KV, which is the trust boundary: a hand-edited or
 * truncated value must not be able to break out of an attribute. Numbers get
 * coerced (and NaN becomes 0) rather than interpolated raw.
 */
function n(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function tileLayer(basemap: BasemapRender): string {
  const zoom = Math.trunc(n(basemap.zoom));
  const perAxis = 2 ** zoom;

  return basemap.tiles
    .filter((t) => Math.trunc(n(t.z, -1)) === zoom)
    .map((t) => {
      const x = Math.trunc(n(t.x, -1));
      const y = Math.trunc(n(t.y, -1));
      if (x < 0 || y < 0 || x >= perAxis || y >= perAxis) return "";
      return (
        `<img class="route-tile" src="/tiles/${zoom}/${x}/${y}.png" alt="" ` +
        `style="left:${n(t.left)}%;top:${n(t.top)}%;width:${n(t.width)}%;height:${n(t.height)}%" ` +
        `loading="lazy" decoding="async" draggable="false">`
      );
    })
    .join("");
}

/** SVG coordinates carry two decimals; more is noise in a 1000-unit frame. */
function r(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Printer's registration marks, inset from the plate edge.
 *
 * CLAUDE.md asks for these by name. They are the detail that makes the figure
 * read as printed rather than rendered, and they cost four hairlines.
 */
function registrationMarks(w: number, h: number): string {
  const inset = 13;
  const arm = 26;
  const corners: [number, number, number, number][] = [
    [inset, inset, 1, 1],
    [w - inset, inset, -1, 1],
    [inset, h - inset, 1, -1],
    [w - inset, h - inset, -1, -1],
  ];
  return `<g class="route-reg" aria-hidden="true">${corners
    .map(([x, y, sx, sy]) => `<path d="M${x} ${y + sy * arm}L${x} ${y}L${x + sx * arm} ${y}"/>`)
    .join("")}</g>`;
}

/**
 * A north arrow, because the frame is rotated to nothing and a printed map that
 * carries a scale bar but no orientation is half a map.
 */
function northArrow(w: number): string {
  const x = w - 60;
  const top = 44;
  return (
    `<g class="route-north" aria-hidden="true">` +
    `<path d="M${x} ${top + 34}L${x} ${top + 8}" fill="none" stroke="var(--ink-soft)" stroke-width="2"/>` +
    `<path d="M${x - 7} ${top + 13}L${x} ${top}L${x + 7} ${top + 13}Z" fill="var(--ink-soft)"/>` +
    `<text class="route-north-label" x="${x}" y="${top + 50}" text-anchor="middle">N</text>` +
    `</g>`
  );
}

/**
 * Where the published line starts and stops: a filled stud for the off, an open
 * ring for the finish, both cased in stock so they survive crossing a label.
 *
 * These are the ends of the *trimmed* geometry, so they mark where the drawing
 * begins, not where the athlete's door is. A loop lands both on the same spot
 * and the open ring wins, which is the honest reading of a route that returned
 * to where it started.
 */
function terminals(basemap: BasemapRender): string {
  const { start, end } = basemap;
  if (!start || !end) return "";
  return (
    `<circle cx="${r(n(start.x))}" cy="${r(n(start.y))}" r="9" ` +
    `fill="var(--ink-accent)" stroke="var(--stock)" stroke-width="4"/>` +
    `<circle cx="${r(n(end.x))}" cy="${r(n(end.y))}" r="9" ` +
    `fill="var(--stock)" stroke="var(--ink-accent)" stroke-width="5"/>`
  );
}

/**
 * The route drawn over a real street map, so the shape is somewhere rather than
 * just a shape. The tiles are pushed through the newsprint palette in
 * `styles.ts`: what comes through is the street network and the place names,
 * printed on the same stock as the rest of the sheet.
 *
 * The line is stroked twice, casing under ink, the way a route is overprinted
 * on a paper map: without the stock-coloured casing the accent disappears every
 * time it crosses a label.
 */
function mapFrame(basemap: BasemapRender, label: string): string {
  const w = n(basemap.width, 1000);
  const h = n(basemap.height, 560);
  const tiles = tileLayer(basemap);
  const path = escapeHtml(String(basemap.pathD ?? ""));

  return `<div class="route-map" style="aspect-ratio:${w}/${h}">
      <div class="route-tiles" aria-hidden="true">${tiles}</div>
      <svg class="route-line" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img"
           aria-label="${escapeHtml(label)}">
        <path d="${path}" fill="none" stroke="var(--stock)" stroke-width="13"
              stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>
        <path d="${path}" fill="none" stroke="var(--ink-accent)" stroke-width="6"
              stroke-linecap="round" stroke-linejoin="round"/>
        ${terminals(basemap)}
        ${registrationMarks(w, h)}
        ${northArrow(w)}
      </svg>
      <div class="route-scale" aria-hidden="true">
        <span class="route-scale-bar" style="width:${n(basemap.scale?.width, 10)}%"></span>
        <span>${escapeHtml(String(basemap.scale?.label ?? ""))}</span>
      </div>
    </div>`;
}

export function renderRoute(
  route: RouteRender | null,
  snapshot: Snapshot,
  nowMs: number,
  tz: string,
  showBasemap = true,
): string {
  if (!route) {
    const sport = snapshot.facts.last?.sportType ?? "Session";
    const time = snapshot.facts.last ? duration(snapshot.facts.last.movingTimeS) : "";
    const label = time ? `${sport} ${time}` : sport;
    return `<section class="route"><div class="route-frame">
      <p class="route-none">No route: ${escapeHtml(label)}</p>
    </div></section>`;
  }

  const place = route.locationLabel
    ? `<span class="route-place">${escapeHtml(route.locationLabel)}</span>`
    : "";

  // The map is the newest activity that had a trace, which is not always the
  // newest activity (an indoor session has none). Saying when it was is what
  // keeps the figure from implying the athlete's last workout was this ride.
  // Absent on snapshots written before the route carried a date.
  const startedAt =
    typeof route.startedAt === "number" && Number.isFinite(route.startedAt)
      ? route.startedAt
      : null;
  const when = startedAt === null ? "" : `<span>${escapeHtml(agoLabel(startedAt, nowMs, tz))}</span>`;

  const basemap = showBasemap ? route.basemap : null;
  const where = route.locationLabel ? `, on a street map of ${route.locationLabel}` : ", on a street map";
  const label = `Route of the last ${route.sportType}, ${km(route.distanceM)} kilometres${basemap ? where : ""}`;

  // Snapshots written before the basemap existed (and BASEMAP=off) fall back to
  // the bare path on newsprint. Note the two pathD values are in different
  // coordinate systems and are never mixed.
  const figure = basemap
    ? mapFrame(basemap, label)
    : `<svg viewBox="${escapeHtml(route.viewBox)}" role="img" aria-label="${escapeHtml(label)}">
      <path d="${escapeHtml(route.pathD)}" fill="none" stroke="var(--ink-accent)"
            stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  const credit = basemap
    ? `<span class="route-credit">Basemap ` +
      `<a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a> / ` +
      `<a href="https://carto.com/attributions" rel="noopener">CARTO</a></span>`
    : "";

  return `<section class="route"><div class="route-frame">
    ${figure}
    <div class="route-caption">
      <span>${km(route.distanceM)} km</span>
      <span>${Math.round(route.elevationM)} m up</span>
      <span>${escapeHtml(route.sportType)}</span>
      ${when}
      ${place}
      ${credit}
    </div>
  </div></section>`;
}

/* --- Form guide -----------------------------------------------------------
   Twelve weeks of training volume, set as a printed form chart under the map.

   The columns are ink, not accent, on purpose. CLAUDE.md keeps the accent for
   rules, the mood label and the GIF border; twelve accent columns would spend
   the entire accent budget on one figure. So ink carries the data and the accent
   carries the single line you are meant to measure it against: the median week.
   One measure, one axis: hours. Distance and session count ride along in each
   column's tooltip and in the table underneath, never as a second y-scale. */
const CHART = {
  width: 1000,
  height: 236,
  /** Top of the tallest column. The gap above it is where its label sits. */
  top: 28,
  baseline: 196,
  labelY: 222,
  maxBarWidth: 56,
  /** A week off still gets a visible stub, so it reads as "nothing", not "no data". */
  zeroStub: 3,
} as const;

/**
 * The form guide, or an empty string when there is nothing honest to draw.
 *
 * Every number here comes out of KV, which is the trust boundary, so each one is
 * coerced through `n()` before it reaches a coordinate. The layout is derived
 * from `weeks.length` rather than TUNING.WORKLOAD_WEEKS so that a snapshot
 * written under a different setting still draws a correct chart instead of one
 * that runs off the end of the frame.
 */
export function renderWorkload(workload: Workload | null | undefined, tz: string): string {
  if (!workload || !Array.isArray(workload.weeks) || workload.weeks.length === 0) return "";

  const weeks = workload.weeks.map((week) => ({
    startMs: n(week?.startMs),
    count: Math.max(0, Math.trunc(n(week?.count))),
    movingTimeS: Math.max(0, n(week?.movingTimeS)),
    distanceM: Math.max(0, n(week?.distanceM)),
  }));

  const peak = Math.max(...weeks.map((week) => week.movingTimeS));
  // Nothing to scale against: a chart whose every column is zero says less than
  // the "quiet on the pitch" notice already up the page.
  if (peak <= 0) return "";

  const slot = CHART.width / weeks.length;
  const barWidth = Math.min(CHART.maxBarWidth, slot * 0.68);
  const plot = CHART.baseline - CHART.top;
  const medianS = Math.max(0, n(workload.medianMovingTimeS));
  const lastIndex = weeks.length - 1;

  const columnX = (index: number): number => index * slot + (slot - barWidth) / 2;
  const barHeight = (seconds: number): number =>
    seconds > 0 ? Math.max(2, (seconds / peak) * plot) : CHART.zeroStub;

  const bars = weeks
    .map((week, index) => {
      const height = barHeight(week.movingTimeS);
      const rest = week.movingTimeS === 0;
      const label =
        `${shortDate(week.startMs, tz)} to ${shortDate(addDaysMs(week.startMs, 6, tz), tz)} · ` +
        `${week.count} ${week.count === 1 ? "session" : "sessions"} · ` +
        `${hoursLabel(week.movingTimeS)} h · ${km(week.distanceM)} km`;
      return (
        `<g><title>${escapeHtml(label)}</title>` +
        `<rect class="form-bar" x="${r(columnX(index))}" y="${r(CHART.baseline - height)}" ` +
        `width="${r(barWidth)}" height="${r(height)}" ` +
        `fill="${rest ? "var(--rule)" : "var(--ink)"}"${rest ? "" : ' opacity=".86"'}/>` +
        `</g>`
      );
    })
    .join("");

  // Only when there is a middle worth drawing: a median of zero would just print
  // a second axis line on top of the first.
  const usualY = CHART.baseline - (medianS / peak) * plot;
  const usualText = `usual ${hoursLabel(medianS)} h`;

  // The rule goes behind the columns so it never slices through one.
  const usualRule =
    medianS > 0
      ? `<line x1="0" y1="${r(usualY)}" x2="${CHART.width}" y2="${r(usualY)}" ` +
        `stroke="var(--ink-accent)" stroke-width="2" stroke-dasharray="10 7"/>`
      : "";

  // The label goes in front of them, at the left. It used to sit at the right
  // end, where it printed straight through this week's value. SVG has no text
  // metrics to lay this out against, so the white-out behind it is sized from
  // the string at its declared 12px and generous rather than tight, using the same
  // trick the scale bar uses to stay legible over the map.
  const usualLabel =
    medianS > 0
      ? `<rect x="0" y="${r(usualY - 21)}" width="${r(usualText.length * 7.4 + 10)}" ` +
        `height="17" fill="var(--stock)"/>` +
        `<text class="form-usual" x="5" y="${r(usualY - 8)}" text-anchor="start">${usualText}</text>`
      : "";

  const latest = weeks[lastIndex] as (typeof weeks)[number];
  const latestTop = CHART.baseline - barHeight(latest.movingTimeS);
  const latestMark =
    `<rect x="${r(columnX(lastIndex))}" y="${CHART.baseline + 3}" ` +
    `width="${r(barWidth)}" height="3" fill="var(--ink-accent)"/>` +
    `<text class="form-value" x="${r(lastIndex * slot + slot / 2)}" y="${r(latestTop - 9)}" ` +
    `text-anchor="middle">${hoursLabel(latest.movingTimeS)} h</text>`;

  // Every third week, plus the newest one. A tick under all twelve would collide
  // at the widths this sheet actually gets read at.
  const ticks = weeks
    .map((week, index) => {
      const newest = index === lastIndex;
      if (!newest && index % 3 !== 0) return "";
      const text = newest ? "this week" : shortDate(week.startMs, tz);
      return (
        `<text class="form-tick${newest ? " form-tick--now" : ""}" ` +
        `x="${r(index * slot + slot / 2)}" y="${CHART.labelY}" text-anchor="middle">` +
        `${escapeHtml(text)}</text>`
      );
    })
    .join("");

  const sessions = weeks.reduce((total, week) => total + week.count, 0);
  const summary =
    `Training hours per week over the last ${weeks.length} weeks. ` +
    `Peak ${hoursLabel(peak)} hours, usual ${hoursLabel(medianS)} hours, ` +
    `${sessions} ${sessions === 1 ? "session" : "sessions"} in total.`;

  // The same numbers as a table, for anyone who cannot use the picture. Hidden
  // visually rather than omitted: the chart is the only place this data appears.
  const table =
    `<table class="visually-hidden"><caption>Weekly training volume</caption>` +
    `<thead><tr><th scope="col">Week of</th><th scope="col">Sessions</th>` +
    `<th scope="col">Time</th><th scope="col">Distance</th></tr></thead><tbody>` +
    weeks
      .map(
        (week) =>
          `<tr><th scope="row">${escapeHtml(shortDate(week.startMs, tz))}</th>` +
          `<td>${week.count}</td><td>${hoursLabel(week.movingTimeS)} h</td>` +
          `<td>${km(week.distanceM)} km</td></tr>`,
      )
      .join("") +
    `</tbody></table>`;

  return `<section class="form">
    <div class="form-head">
      <h2 class="form-title">Form guide</h2>
      <span class="form-sub">Hours trained per week</span>
    </div>
    <div class="route-frame">
      <svg class="form-chart" viewBox="0 0 ${CHART.width} ${CHART.height}" role="img"
           aria-label="${escapeHtml(summary)}">
        ${usualRule}
        ${bars}
        <line x1="0" y1="${CHART.baseline}" x2="${CHART.width}" y2="${CHART.baseline}"
              stroke="var(--rule)" stroke-width="1.5"/>
        ${usualLabel}
        ${latestMark}
        ${ticks}
      </svg>
      ${table}
    </div>
    <div class="route-caption">
      <span>Peak ${hoursLabel(peak)} h</span>
      <span>Usual ${hoursLabel(medianS)} h</span>
      <span>${sessions} sessions</span>
      <span>${weeks.length} weeks</span>
    </div>
  </section>`;
}

function requireMood(id: string): Mood {
  const mood = getMood(id);
  if (!mood) throw new Error(`mood catalogue is missing '${id}'`);
  return mood;
}

// The catalogue is the single source for every mood's id/name/accent and
// quotes — never hardcoded again here. (This used to duplicate "preseason"
// and its accent verbatim; see also worker.ts's EMPTY_PREVIEW_SNAPSHOT,
// which now reads from the same catalogue entry.)
const PRESEASON_MOOD = requireMood("preseason");

export function renderPage(view: PageView): string {
  const { snapshot, health, nowMs, showRefreshButton, previewNotice, setupKey } = view;
  const showBasemap = view.showBasemap !== false;
  const tz = view.tz || "UTC";

  const mood = snapshot?.mood ?? {
    id: PRESEASON_MOOD.id,
    name: PRESEASON_MOOD.name,
    accent: PRESEASON_MOOD.accent,
  };
  const quote = snapshot?.quote ?? PRESEASON_MOOD.quotes[0]!;

  const ageHours = snapshot ? (nowMs - snapshot.refreshedAt) / 3_600_000 : 0;
  const stale = snapshot !== null && ageHours > TUNING.STALE_SNAPSHOT_HOURS;

  const hasSetupKey = typeof setupKey === "string" && setupKey.length > 0;
  const loginHref = hasSetupKey ? `/auth/login?key=${encodeURIComponent(setupKey as string)}` : null;
  // Render a real link only when there is a key to put in it — a bare
  // `/auth/login` with no `?key=` always 404s, so a link that will only ever
  // fail is worse than no link at all.
  const loginLink = (label: string): string =>
    loginHref
      ? `<a href="${escapeHtml(loginHref)}">${escapeHtml(label)}</a>`
      : `visit the setup URL`;

  // A fresh deploy's very first cron run also sets needsReauth (the
  // "no-token" branch of runRefresh) — that is not a lapse, it is a site that
  // has never been connected. Both signals are required: a null snapshot
  // alone could just mean "the first fetch hasn't run yet" for an
  // otherwise-healthy site the moment before its first success.
  const neverConnected = health.needsReauth && snapshot === null && health.lastSuccessAt === null;

  const notices: string[] = [];
  if (previewNotice) {
    notices.push(`<p class="notice">${escapeHtml(previewNotice)}</p>`);
  }
  if (neverConnected) {
    notices.push(
      `<p class="notice">Strava hasn't been connected yet — this site has never completed a fetch. ` +
        `${loginLink("Connect Strava")} to get started.</p>`,
    );
  } else if (health.needsReauth) {
    notices.push(
      `<p class="notice">Strava access has lapsed — the mood below is the last one we recorded. ` +
        `${loginLink("Reconnect Strava")}.</p>`,
    );
  }
  if (!snapshot && !neverConnected) {
    notices.push(
      `<p class="notice">The first fetch hasn't run yet. Once it does, this page fills in on its own.</p>`,
    );
  } else if (snapshot && snapshot.facts.totalActivities === 0) {
    // Kind copy, not scolding: 90 quiet days is a fact, not a failing, and this
    // is a Ted Lasso site.
    notices.push(
      `<p class="notice">Quiet on the pitch these last 90 days — no activities to report. ` +
        `That's alright. The door's open whenever you're ready to lace back up.</p>`,
    );
  }

  const hasGif = Boolean(snapshot?.gif);
  // A video is offered as a link, never an embedded player: an iframe would put
  // a third party in the read path and hand the loudest object on the page to
  // something that isn't the quote. Gifs and stills both render as <img> —
  // there is nothing to branch on between them.
  const gifColumn = !snapshot?.gif
    ? ""
    : snapshot.gif.kind === "video"
      ? `<div class="hero-gif"><a class="hero-video" href="${escapeHtml(snapshot.gif.url)}" rel="noopener">` +
        `<span class="hero-video-cue">Watch the clip</span>` +
        `<span class="hero-video-alt">${escapeHtml(snapshot.gif.alt)}</span></a></div>`
      : `<div class="hero-gif"><img class="gif" src="${escapeHtml(snapshot.gif.url)}" alt="${escapeHtml(snapshot.gif.alt)}" ` +
        `loading="eager" decoding="async"></div>`;

  const reasons = snapshot?.reasons.length
    ? `<ul class="reasons">${snapshot.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
    : "";

  const staleStamp = stale
    ? `<span class="stamp">last updated ${Math.floor(ageHours)}h ago</span>`
    : "";

  const refreshButton = showRefreshButton
    ? `<form id="refresh-form" method="post" action="/api/refresh?key=${encodeURIComponent(setupKey ?? "")}">
         <button class="refresh" id="refresh" type="submit">Refresh now</button>
       </form>`
    : "";

  const refreshedLabel = snapshot
    ? `Refreshed ${formatUtc(snapshot.refreshedAt)}`
    : "Not yet refreshed";
  const nextRunLabel = `Next run ${formatUtc(nextScheduledRunMs(nowMs))}`;
  const staleGifLabel =
    snapshot?.gif && isGifStale(snapshot.gif.verifiedOn, nowMs)
      ? `<span class="stale-marker">GIF unverified 180+ days</span>`
      : "";
  const footerMeta = [refreshedLabel, nextRunLabel, staleGifLabel]
    .filter((part) => part.length > 0)
    .join(" · ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(mood.name)} — tedlasso-strava</title>
<meta name="robots" content="noindex">
<style>${STYLES}</style>
</head>
<body style="--ink-accent: ${escapeHtml(mood.accent)}">
<main class="sheet">
  <header class="masthead">
    <h1 class="mood-name">${escapeHtml(mood.name)}</h1>
    <div class="masthead-meta">Matchday report ${staleStamp}</div>
  </header>

  ${notices.join("")}

  <section class="hero${hasGif ? " hero--with-gif" : ""}">
    <div class="hero-copy">
      <blockquote class="quote">${escapeHtml(quote.text)}</blockquote>
      <p class="attribution">${escapeHtml(quote.character)}</p>
      ${reasons}
    </div>
    ${gifColumn}
  </section>

  <hr class="rule">
  ${snapshot ? renderRoute(snapshot.route, snapshot, nowMs, tz, showBasemap) : ""}
  ${snapshot ? renderWorkload(snapshot.workload, tz) : ""}
  ${snapshot ? receipts(snapshot, nowMs, tz) : ""}
  ${snapshot ? results(snapshot) : ""}

  <footer class="footer">
    <span><a href="https://www.strava.com" rel="noopener">Powered by Strava</a> · <a href="/catalogue">Quote &amp; GIF catalogue</a></span>
    <span class="footer-meta">${footerMeta}</span>
    <span>${refreshButton}</span>
  </footer>
</main>
<aside class="colophon">made w/ &lt;3 in sf🌁 =&gt; see my prompts, tool calls, code on Entire: <a href="https://entire.io/gh/elizabethsiegle/tedlasso-strava" rel="noopener">https://entire.io/gh/elizabethsiegle/tedlasso-strava</a></aside>
${showRefreshButton ? `<script>${REFRESH_SCRIPT}</script>` : ""}
</body>
</html>`;
}
