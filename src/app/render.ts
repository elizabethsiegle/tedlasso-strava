import { getMood, type Mood } from "../data/moods";
import { formatCount } from "../domain/mood";
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
      return `<tr>
        <td class="results-day">${when}</td>
        <td>${sport}</td>
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

export function renderRoute(route: RouteRender | null, snapshot: Snapshot): string {
  if (!route) {
    const sport = snapshot.facts.last?.sportType ?? "Session";
    const time = snapshot.facts.last ? duration(snapshot.facts.last.movingTimeS) : "";
    const label = time ? `${sport} ${time}` : sport;
    return `<section class="route"><div class="route-frame">
      <p class="route-none">No route — ${escapeHtml(label)}</p>
    </div></section>`;
  }

  const place = route.locationLabel
    ? `<span class="route-place">${escapeHtml(route.locationLabel)}</span>`
    : "";

  return `<section class="route"><div class="route-frame">
    <svg viewBox="${escapeHtml(route.viewBox)}" role="img"
         aria-label="Route of the last ${escapeHtml(route.sportType)}, ${km(route.distanceM)} kilometres">
      <path d="${escapeHtml(route.pathD)}" fill="none" stroke="var(--ink-accent)"
            stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="route-caption">
      <span>${km(route.distanceM)} km</span>
      <span>${Math.round(route.elevationM)} m up</span>
      <span>${escapeHtml(route.sportType)}</span>
      ${place}
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
  ${snapshot ? renderRoute(snapshot.route, snapshot) : ""}
  ${snapshot ? receipts(snapshot) : ""}
  ${snapshot ? results(snapshot) : ""}

  <footer class="footer">
    <span><a href="https://www.strava.com" rel="noopener">Powered by Strava</a></span>
    <span class="footer-meta">${footerMeta}</span>
    <span>${refreshButton}</span>
  </footer>
</main>
<aside class="colophon">made w/ &lt;3 in sf🌁 =&gt; see my prompts, tool calls, code on Entire: <a href="https://entire.io/gh/elizabethsiegle/tedlasso-strava" rel="noopener">https://entire.io/gh/elizabethsiegle/tedlasso-strava</a></aside>
${showRefreshButton ? `<script>${REFRESH_SCRIPT}</script>` : ""}
</body>
</html>`;
}
