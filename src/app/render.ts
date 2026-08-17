import type { RouteRender } from "../domain/route";
import { TUNING } from "../domain/tuning";
import type { Health, Snapshot } from "../types";
import { STYLES } from "./styles";

export interface PageView {
  snapshot: Snapshot | null;
  health: Health;
  nowMs: number;
  showRefreshButton: boolean;
  previewNotice: string | null;
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

function count(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function receipts(snapshot: Snapshot): string {
  const f = snapshot.facts;
  const rows: [string, string][] = [
    ["Last out", f.last ? escapeHtml(f.last.name) : "Nothing yet"],
    ["Sport", f.last ? escapeHtml(f.last.sportType) : "—"],
    ["Distance", f.last ? `${km(f.last.distanceM)} km` : "—"],
    ["Time", f.last ? duration(f.last.movingTimeS) : "—"],
    ["When", agoLabel(f.daysSinceLast)],
    ["This week", `${f.countLast7} vs your usual ${count(f.baselineWeekly)}`],
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

/** The state before the first successful fetch, and when there is nothing to show. */
const PRESEASON = {
  mood: { id: "preseason", name: "Preseason", accent: "#6B7A8F" },
  quote: {
    text: "I believe in hope. I believe in believe.",
    character: "Ted Lasso",
  },
};

export function renderPage(view: PageView): string {
  const { snapshot, health, nowMs, showRefreshButton, previewNotice } = view;

  const mood = snapshot?.mood ?? PRESEASON.mood;
  const quote = snapshot?.quote ?? PRESEASON.quote;

  const ageHours = snapshot ? (nowMs - snapshot.refreshedAt) / 3_600_000 : 0;
  const stale = snapshot !== null && ageHours > TUNING.STALE_SNAPSHOT_HOURS;

  const notices: string[] = [];
  if (previewNotice) {
    notices.push(`<p class="notice">${escapeHtml(previewNotice)}</p>`);
  }
  if (health.needsReauth) {
    notices.push(
      `<p class="notice">Strava access has lapsed — the mood below is the last one we recorded. ` +
        `<a href="/auth/login">Reconnect Strava</a>.</p>`,
    );
  }
  if (!snapshot) {
    notices.push(
      `<p class="notice">The first fetch hasn't run yet. Once it does, this page fills in on its own.</p>`,
    );
  } else if (snapshot.facts.totalActivities === 0) {
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
    ? `<button class="refresh" id="refresh" type="button">Refresh now</button>`
    : "";

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

  <footer class="footer">
    <span><a href="https://www.strava.com" rel="noopener">Powered by Strava</a></span>
    <span>${refreshButton}</span>
  </footer>
</main>
</body>
</html>`;
}
