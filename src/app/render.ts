import { getMood, type Mood } from "../data/moods";
import { formatCount } from "../domain/mood";
import type { BasemapRender } from "../domain/basemap";
import type { RouteRender } from "../domain/route";
import { DAY_MS, TUNING } from "../domain/tuning";
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
function isGifStale(verifiedOn: string, nowMs: number): boolean {
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

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function agoLabel(days: number | null): string {
  if (days === null) return "—";
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  return `${Math.floor(days)} days ago`;
}

function receipts(snapshot: Snapshot): string {
  const f = snapshot.facts;
  const rows: [string, string][] = [
    ["Last out", f.last ? escapeHtml(f.last.name) : "Nothing yet"],
    ["Sport", f.last ? escapeHtml(f.last.sportType) : "—"],
    ["Distance", f.last ? `${km(f.last.distanceM)} km` : "—"],
    ["Time", f.last ? duration(f.last.movingTimeS) : "—"],
    ["When", agoLabel(f.daysSinceLast)],
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
      ${place}
      ${credit}
    </div>
  </div></section>`;
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
  const gifColumn = snapshot?.gif
    ? `<div class="hero-gif"><img class="gif" src="${escapeHtml(snapshot.gif.url)}" alt="${escapeHtml(snapshot.gif.alt)}" ` +
      `loading="eager" decoding="async"></div>`
    : "";

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
  ${snapshot ? renderRoute(snapshot.route, snapshot, showBasemap) : ""}
  ${snapshot ? receipts(snapshot) : ""}

  <footer class="footer">
    <span><a href="https://www.strava.com" rel="noopener">Powered by Strava</a></span>
    <span class="footer-meta">${footerMeta}</span>
    <span>${refreshButton}</span>
  </footer>
</main>
${showRefreshButton ? `<script>${REFRESH_SCRIPT}</script>` : ""}
</body>
</html>`;
}
