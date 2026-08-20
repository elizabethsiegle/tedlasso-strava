export const STYLES = `
:root {
  --stock: #F4F1E8;
  --ink: #17171A;
  --ink-soft: #55565C;
  --rule: #C9C3B4;
  --ink-accent: #17171A;
  --display: ui-sans-serif, "Helvetica Neue", Arial, sans-serif;
  --text: Georgia, "Iowan Old Style", "Times New Roman", serif;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --stock: #14140F;
    --ink: #F1EDE2;
    --ink-soft: #A7A296;
    --rule: #3A382F;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--stock);
  color: var(--ink);
  font-family: var(--text);
  font-size: 17px;
  line-height: 1.5;
  /* Newsprint tooth: a monochrome 1px paper grain at 1.4% opacity, not a
     decorative hue transition. This is the "human hand" detail the banned-
     gradients rule is not aimed at; plain CSS has no other way to get
     paper-stock texture without shipping an image asset. */
  background-image:
    repeating-linear-gradient(0deg, rgba(0,0,0,.014) 0 1px, transparent 1px 3px);
}

.sheet { max-width: 60rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }

.masthead {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap;
  border-top: 3px solid var(--ink);
  border-bottom: 1px solid var(--rule);
  padding: .5rem 0 .35rem;
}

.mood-name {
  font-family: var(--display);
  font-weight: 800;
  font-size: clamp(1.75rem, 7vw, 3.25rem);
  letter-spacing: -.035em;
  text-transform: uppercase;
  color: var(--ink-accent);
  margin: 0;
  line-height: .95;
}

.masthead-meta {
  font-family: var(--display);
  font-size: .7rem; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-soft);
}

.stamp {
  display: inline-block;
  transform: rotate(-4deg);
  border: 2px solid var(--ink-soft);
  color: var(--ink-soft);
  font-family: var(--display);
  font-size: .62rem; letter-spacing: .2em; text-transform: uppercase;
  padding: .15rem .4rem;
}

/* Single column by default. Six of the ten catalogue moods carry a GIF and
   four legitimately do not (src/data/moods.ts), so a gif-less render is
   still a common case, not a placeholder state. The second track only opens
   up when a gif is actually rendered (".hero--with-gif", set in render.ts),
   so there is never a reserved, empty column sitting beside the quote. */
.hero { display: grid; grid-template-columns: 1fr; gap: 1.5rem; padding: 2.5rem 0 1.75rem; }
@media (min-width: 46rem) {
  .hero.hero--with-gif { grid-template-columns: 1.6fr 1fr; align-items: start; }
}

/* A fixed column measure, print-style, so the quote reads as a deliberately
   set column rather than a stray line stretching edge-to-edge once there is
   no gif column to bound it. */
.hero-copy { max-width: 38rem; }

blockquote.quote {
  margin: 0;
  font-size: clamp(1.65rem, 5.2vw, 3rem);
  line-height: 1.08;
  letter-spacing: -.02em;
  text-wrap: balance;
}

.attribution {
  margin-top: .9rem;
  font-family: var(--display);
  font-size: .72rem; letter-spacing: .18em; text-transform: uppercase;
  color: var(--ink-soft);
}

.gif { width: 100%; height: auto; display: block; border: 1px solid var(--ink-accent); }

.rule { border: 0; border-top: 1px solid var(--rule); margin: 0; }

/* The receipts are deliberately denser than the hero. That contrast is the layout. */
.receipts {
  width: 100%; border-collapse: collapse;
  font-family: var(--display);
  font-size: .8rem;
  font-variant-numeric: tabular-nums lining-nums;
  margin-top: 1.25rem;
}
.receipts th {
  text-align: left; font-weight: 600; letter-spacing: .12em;
  text-transform: uppercase; font-size: .62rem; color: var(--ink-soft);
  padding: .3rem .75rem .3rem 0; white-space: nowrap; vertical-align: baseline;
}
.receipts td { padding: .3rem 0; border-bottom: 1px solid var(--rule); }

.reasons { margin: 1.25rem 0 0; padding: 0; list-style: none; }
.reasons li { padding-left: 1rem; text-indent: -1rem; color: var(--ink-soft); }
.reasons li::before { content: "— "; color: var(--ink-accent); }

/* Echoes the masthead's own rule treatment (heavy top, hairline bottom)
   rather than a colored side tab, so a callout reads as part of this sheet's
   type system instead of a bolted-on alert card. */
.notice {
  border-top: 3px solid var(--ink-accent);
  border-bottom: 1px solid var(--rule);
  padding: .6rem 0;
  margin: 1rem 0;
  font-family: var(--display);
  font-size: .8rem;
}

.footer {
  margin-top: 2.5rem; padding-top: .6rem;
  border-top: 1px solid var(--rule);
  display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  font-family: var(--display);
  font-size: .68rem; letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-soft);
}
.footer a { color: inherit; }

button.refresh {
  font-family: var(--display);
  font-size: .68rem; letter-spacing: .18em; text-transform: uppercase;
  background: var(--ink); color: var(--stock);
  border: 0; padding: .5rem .9rem; cursor: pointer;
}
button.refresh[disabled] { opacity: .45; cursor: wait; }

body[data-refreshing="true"] .hero { opacity: .35; transition: opacity .35s ease; }

.route { margin-top: 1.75rem; border-top: 1px solid var(--rule); padding-top: .9rem; }
.route-frame { border: 1px solid var(--rule); padding: .75rem; }
.route svg { display: block; width: 100%; height: auto; }
.route-caption {
  display: flex; gap: 1.25rem; flex-wrap: wrap;
  margin-top: .6rem;
  font-family: var(--display);
  font-size: .68rem; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums lining-nums;
}
.route-none {
  font-family: var(--display); font-weight: 800;
  font-size: clamp(1.25rem, 4vw, 2rem);
  letter-spacing: -.02em; text-transform: uppercase;
  color: var(--ink-soft);
  padding: 2.5rem .25rem;
}

/* A results table off the back page of a matchday programme: no frame, no
   zebra striping, just a heavy rule under the heading and hairlines between
   fixtures. Tighter than the hero on purpose — that density contrast is the
   layout. */
.results { margin-top: 1.75rem; }
.results-head {
  font-family: var(--display);
  font-size: .68rem; letter-spacing: .18em; text-transform: uppercase;
  color: var(--ink-soft);
  margin: 0 0 .35rem;
  padding-bottom: .35rem;
  border-bottom: 3px solid var(--ink);
}
.results table { width: 100%; border-collapse: collapse; }
.results td {
  padding: .38rem 0;
  border-bottom: 1px solid var(--rule);
  font-variant-numeric: tabular-nums lining-nums;
}
.results-day {
  font-family: var(--display);
  font-size: .72rem; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-soft);
  white-space: nowrap;
}
.results-num { text-align: right; padding-left: .75rem; white-space: nowrap; }
/* The route as a margin glyph — a shape at a glance, not a map. Sized in the
   row's own terms so it never becomes the loudest thing in the table. The
   square 1000-unit viewBox is letterboxed into this strip by the default
   preserveAspectRatio, which is why the path's stroke-width is set far heavier
   than the full map's: at this scale a hairline would vanish. */
.results-glyph { width: 3.25rem; padding-left: .75rem; line-height: 0; }
.results-trace {
  display: block; width: 3.25rem; height: 1.5rem;
  color: var(--ink-accent);
  overflow: visible;
}
.results-indoor { color: var(--ink-soft); font-family: var(--display); font-size: .72rem; }
/* The link is a mark in the margin, not a button: the row is the content and
   the arrow just says there is somewhere to go. */
.results-out { text-align: right; padding-left: .9rem; width: 1.5rem; }
.results-out a {
  color: var(--ink-accent);
  text-decoration: none;
  font-size: .9rem;
}
.results-out a:hover, .results-out a:focus-visible { text-decoration: underline; }

/* A video stands in for the still: a framed plate the size the image would
   have been, so the hero's two-column balance survives whichever kind of media
   the mood happens to carry. */
.hero-video {
  display: flex; flex-direction: column; gap: .4rem; justify-content: center;
  min-height: 8rem; padding: 1.1rem;
  border: 1px solid var(--rule);
  border-top: 3px solid var(--ink-accent);
  color: inherit; text-decoration: none;
}
.hero-video-cue {
  font-family: var(--display); font-weight: 800;
  font-size: .8rem; letter-spacing: .16em; text-transform: uppercase;
  color: var(--ink-accent);
}
/* The escape below is doubled because this whole stylesheet is a TS template
   literal: a single backslash would be consumed as a JS escape rather than
   reaching CSS. The codepoint is the north-east arrow. Note this comment must
   avoid writing it raw for the same reason. */
.hero-video-cue::after { content: " \\2197"; }
.hero-video-alt { color: var(--ink-soft); font-size: .95rem; }
.hero-video:hover .hero-video-cue, .hero-video:focus-visible .hero-video-cue { text-decoration: underline; }

/* Catalogue sheet. Each mood re-declares --ink-accent locally, so its own ink
   colours its heading and its links without any per-mood CSS being generated. */
.cat-intro { color: var(--ink-soft); max-width: 42rem; margin: 1.25rem 0 2rem; }
.cat-mood { margin-top: 2.25rem; }
.cat-name {
  font-family: var(--display); font-weight: 800;
  font-size: clamp(1.25rem, 4vw, 1.9rem);
  letter-spacing: -.03em; text-transform: uppercase;
  color: var(--ink-accent);
  margin: 0;
  border-bottom: 3px solid var(--ink-accent);
  padding-bottom: .2rem;
}
.cat-meta {
  display: flex; gap: 1.1rem; flex-wrap: wrap;
  margin: .45rem 0 .8rem;
  font-family: var(--display);
  font-size: .68rem; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-soft);
}
.cat-meta a { color: var(--ink-accent); }
.cat-table { width: 100%; border-collapse: collapse; }
.cat-table td { padding: .4rem 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
/* The quotes are the product; they get the text face at reading size while the
   metadata beside them stays in the small display face. */
.cat-quote { font-family: var(--text); padding-right: 1rem; }
.cat-alt { color: var(--ink-soft); padding-right: 1rem; }
.cat-who, .cat-when {
  font-family: var(--display); font-size: .68rem; letter-spacing: .08em;
  text-transform: uppercase; color: var(--ink-soft); white-space: nowrap;
}
.cat-gifs { margin-top: .9rem; }
.cat-kind {
  font-family: var(--display); font-size: .62rem; letter-spacing: .14em;
  text-transform: uppercase; color: var(--ink-accent);
  white-space: nowrap; padding-right: .75rem;
}

/* The imprint line a printed programme carries at the foot of every sheet.
   Heavy top rule to echo the masthead, set in the display face but left
   lowercase — a hand-set credit, not another uppercase section label. Pinned
   because it should survive the long scroll past the route and the stats. */
.colophon {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 2;
  background: var(--stock);
  border-top: 3px solid var(--ink);
  padding: .5rem 1.25rem;
  text-align: center;
  font-family: var(--display);
  font-size: .68rem; letter-spacing: .06em;
  color: var(--ink-soft);
}
.colophon a {
  color: var(--ink-accent);
  text-underline-offset: .18em;
  /* The URL is longer than a phone is wide; break it rather than let it push
     the pinned bar into a horizontal scroll. */
  word-break: break-all;
}
/* Keep the sheet's last line clear of the pinned imprint, which wraps to two
   lines on narrow screens. */
body { padding-bottom: 4rem; }
/* --- Basemap ------------------------------------------------------------
   The tile layer is laid out in the fixed reference frame the domain computed
   (TUNING.BASEMAP_WIDTH x _HEIGHT) using percentages, so the whole thing
   scales with the sheet and needs no JavaScript to size itself. */
.route-map { position: relative; overflow: hidden; background: var(--stock); }
.route-tiles { position: absolute; inset: 0; }
.route-tile {
  position: absolute; display: block; border: 0;
  /* A levels stretch, not a plain fade. CARTO Positron sits in the top 6% of
     the range (streets ~#f2f2f2 on white), which a simple opacity drop would
     erase entirely: darken first, blow out the contrast so the streets and
     labels separate from the paper, then lift the whole thing back to white so
     only the ink survives the multiply. */
  filter: grayscale(1) brightness(.6) contrast(4) brightness(1.32);
  /* Multiply is what makes it read as printed *on* the newsprint rather than
     pasted over it: white map background disappears into the stock. */
  mix-blend-mode: multiply;
  opacity: .85;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .route-tile {
    /* Same stretch, then inverted and screened, so ink becomes light on the
       dark stock instead of a white slab. Held back further because light
       lines on dark read stronger than dark on light at the same opacity. */
    filter: grayscale(1) brightness(.6) contrast(4) brightness(1.32) invert(1);
    mix-blend-mode: screen;
    opacity: .5;
  }
}
.route-map .route-line { position: absolute; inset: 0; width: 100%; height: 100%; }

/* A bar, not a "1 : 25000" ratio: the frame is fitted to the route, so without
   one a 400 m loop and a 40 km ride look identical. Ticked at both ends like a
   printed map's scale. */
/* Full-width and unpadded on purpose: the bar's width is a percentage of the
   frame the domain measured it against, so any padding on this element would
   quietly rescale the bar and make it lie. */
.route-scale {
  position: absolute; left: 0; right: 0; bottom: .55rem;
  display: flex; align-items: flex-end; gap: .4rem;
  font-family: var(--display);
  font-size: .58rem; letter-spacing: .16em; text-transform: uppercase;
  white-space: nowrap;
  color: var(--ink-soft);
}
.route-scale-bar {
  flex: 0 0 auto; height: 6px; margin-left: .8rem;
  border: 1px solid currentColor; border-top: 0;
}
.route-scale span:last-child {
  background: var(--stock); padding: 0 .25rem; line-height: 1;
}
.route-credit { margin-left: auto; }
.route-credit a { color: inherit; text-decoration-thickness: 1px; }

/* A second, inner keyline. Printed plates carry a double rule, and an outline
   with a negative offset draws one without touching the tile layer's geometry
   the way a border would (percentage tile positions are measured against this
   box). Not a card shadow: no blur, no elevation, just a rule. */
.route-map { outline: 1px solid var(--rule); outline-offset: -1px; }

.route-reg path { fill: none; stroke: var(--ink-soft); stroke-width: 2; opacity: .55; }
.route-north-label {
  font-family: var(--display); font-weight: 700;
  font-size: 17px; letter-spacing: 1px;
  fill: var(--ink-soft);
}

/* --- Form guide ---------------------------------------------------------
   Set tighter than the hero and looser than the receipts: the chart is the
   middle density on the sheet, which is what lets it sit between them. */
.form { margin-top: 1.75rem; }
.form-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap;
  border-bottom: 1px solid var(--rule);
  padding-bottom: .3rem;
  margin-bottom: .85rem;
}
.form-title {
  margin: 0;
  font-family: var(--display); font-weight: 800;
  font-size: 1.1rem; letter-spacing: -.015em; text-transform: uppercase;
}
.form-sub {
  font-family: var(--display);
  font-size: .62rem; letter-spacing: .16em; text-transform: uppercase;
  color: var(--ink-soft);
}
.form-chart { display: block; width: 100%; height: auto; }
.form-chart text {
  font-family: var(--display);
  font-variant-numeric: tabular-nums lining-nums;
  text-transform: uppercase;
}
/* Sizes are in viewBox units, so they scale with the sheet like the columns do. */
.form-tick { font-size: 13px; letter-spacing: 1.6px; fill: var(--ink-soft); }
.form-tick--now { fill: var(--ink); font-weight: 700; }
.form-value { font-size: 16px; font-weight: 800; letter-spacing: .4px; fill: var(--ink-accent); }
.form-usual { font-size: 12px; letter-spacing: 1.8px; fill: var(--ink-accent); }

/* Present for screen readers and omitted from the page. The chart is the only
   place the weekly numbers appear, so they cannot simply be left out. */
.visually-hidden {
  position: absolute; width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
`;
