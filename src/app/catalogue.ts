import { MOODS } from "../data/moods";
import { TUNING } from "../domain/tuning";
import { escapeHtml, isGifStale } from "./render";
import { STYLES } from "./styles";

/**
 * The quote and GIF catalogue, rendered from `src/data/moods.ts` — the same
 * versioned source the engine picks from, not a copy. Nothing here is fetched
 * or stored: if this page and the mood engine ever disagreed, one of them would
 * be reading stale data, so there is deliberately only one place to read.
 */
export function renderCatalogue(nowMs: number): string {
  const totals = MOODS.reduce(
    (acc, m) => ({
      quotes: acc.quotes + m.quotes.length,
      media: acc.media + m.media.length,
      stale: acc.stale + m.media.filter((g) => isGifStale(g.verifiedOn, nowMs)).length,
    }),
    { quotes: 0, media: 0, stale: 0 },
  );

  const sections = MOODS.map((mood) => {
    const quotes = mood.quotes
      .map(
        (q) => `<tr>
          <td class="cat-quote">${escapeHtml(q.text)}</td>
          <td class="cat-who">${escapeHtml(q.character)}</td>
        </tr>`,
      )
      .join("");

    const media = mood.media
      .map((g) => {
        const stale = isGifStale(g.verifiedOn, nowMs)
          ? `<span class="stale-marker">unverified ${TUNING.STALE_VERIFIED_DAYS}+ days</span>`
          : "";
        return `<tr>
          <td class="cat-kind">${escapeHtml(g.kind)}</td>
          <td class="cat-alt">${escapeHtml(g.alt)}</td>
          <td class="cat-who">${escapeHtml(g.source)}</td>
          <td class="cat-when">${escapeHtml(g.verifiedOn)} ${stale}</td>
          <td class="results-out"><a href="${escapeHtml(g.url)}" rel="noopener" aria-label="Open the ${escapeHtml(g.kind)} for ${escapeHtml(mood.name)}">&#8599;</a></td>
        </tr>`;
      })
      .join("");

    return `<section class="cat-mood" style="--ink-accent: ${escapeHtml(mood.accent)}">
      <h2 class="cat-name">${escapeHtml(mood.name)}</h2>
      <p class="cat-meta">
        <span>id <code>${escapeHtml(mood.id)}</code></span>
        <span>verified ${escapeHtml(mood.verifiedOn)}</span>
        <span>${mood.quotes.length} quotes · ${mood.media.length} media</span>
        <a href="/?preview=${encodeURIComponent(mood.id)}">Preview this mood</a>
      </p>
      <table class="cat-table"><tbody>${quotes}</tbody></table>
      <table class="cat-table cat-gifs"><tbody>${media}</tbody></table>
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Catalogue — tedlasso-strava</title>
<meta name="robots" content="noindex">
<style>${STYLES}</style>
</head>
<body>
<main class="sheet">
  <header class="masthead">
    <h1 class="mood-name">Catalogue</h1>
    <div class="masthead-meta">
      ${MOODS.length} moods · ${totals.quotes} quotes · ${totals.media} media${
        totals.stale > 0 ? ` · <span class="stale-marker">${totals.stale} unverified</span>` : ""
      }
    </div>
  </header>

  <p class="cat-intro">
    Every quote, GIF, still and clip the site can serve, read straight from the versioned
    catalogue in <code>src/data/moods.ts</code>. A mood is chosen from your Strava
    activity; the quote and GIF within it are seeded from the snapshot's refresh
    time, so the same refresh always yields the same pairing.
  </p>

  ${sections}

  <footer class="footer">
    <span><a href="/">&larr; Back to the matchday report</a></span>
    <span><a href="https://www.strava.com" rel="noopener">Powered by Strava</a></span>
  </footer>
</main>
</body>
</html>`;
}
