# tedlasso-strava

A single-athlete Cloudflare Worker that reads my Strava activity every 4 hours, derives a
"mood" from it, and serves one Ted Lasso quote + GIF that matches.

## UI must not look AI-generated

The global `~/.claude/CLAUDE.md` rule applies here in full — read it, it lists the specific
tells that are banned. This section pins down what we do *instead* on this project, so nobody
has to re-litigate the aesthetic every session.

**The aesthetic is a non-league matchday programme.** Newsprint stock, heavy condensed
display type over a plain workhorse text face, a single ink accent per mood, hairline rules
doing the layout work instead of card shadows, stats set like a results table. Think a
printed team sheet someone folded into their back pocket — not a SaaS dashboard.

Concretely, on this project:
- No cards with shadows. Structure comes from rules, spacing, and type weight.
- The quote is the largest thing on the page by a wide margin. It is the design.
- Stats are set as a dense tabular block with tabular-lining numerals — deliberately tighter
  than the hero, because that density contrast is the whole layout.
- One accent color per mood, defined in the mood catalogue, used sparingly (rules, the mood
  label, the GIF border). The rest stays near-monochrome ink on stock.
- Off-grid human details are wanted: a rotated "MATCHDAY" stamp, a printer's registration
  mark, a slightly-too-tight kerned mood name.
- Server-rendered HTML with inline CSS. No component framework, no CSS framework, so there
  are no defaults to accidentally ship.

## Architecture

- Hexagonal layering: `src/domain` imports nothing from `src/infrastructure` — no I/O, no
  network, no Workers types, no React. Infrastructure implements interfaces the domain
  declares, never the reverse.
- Inject the clock. `now` is always a parameter in domain code; never call `Date.now()` or
  `new Date()` inside `src/domain`, so "9 days since your last run" is testable without
  waiting nine days.
- No `Math.random()` in the domain. Quote and GIF selection are seeded from the snapshot's
  `refreshedAt`, so output is a pure function of its inputs and tests assert exact strings.
- The mood engine is the safety-critical code here: fixture-based tests are ground truth. If
  the implementation and a fixture disagree, the implementation is wrong. Keep it at or near
  100% branch coverage.

## Domain constraints

- No scraping. All activity data comes from the official Strava API with my own OAuth token.
- One human click, ever: the initial Strava authorization. Everything after that — token
  rotation, refresh, scheduling — is automatic. Never design a flow that needs me to paste a
  token or run `wrangler secret put` as routine maintenance.
- The refresh token rotates on every use. Always persist the new one *before* using the
  access token it came with. A failed refresh must never clear the last good snapshot.
- The read path (page views) never calls Strava. It reads the KV snapshot only. Only the
  cron and the guarded manual-refresh endpoint may call Strava.
- Every mood, quote, and GIF lives in the versioned catalogue in `src/data/moods.ts` with a
  `verifiedOn` date — never hardcoded in rendering or engine logic. Flag GIF links whose
  `verifiedOn` is older than 180 days as stale.
- Never claim a "personal record." We only have 90 days of activity list data, so the honest
  claim is "longest ride in 90 days." Say what we can actually back.
- The route is drawn over a real basemap, and every tile is proxied through our own
  `/tiles/{z}/{x}/{y}.png` (`src/app/tiles.ts`). The browser must never request a tile from
  the upstream host directly: one Worker talking to the tile provider leaks nothing about
  visitors, a thousand browsers doing it leaks all of them. Basemap credit for OpenStreetMap
  and CARTO is rendered on the page, as their terms require.
- Two route path strings exist and are never interchangeable: `RouteRender.pathD` is
  equirectangular, normalised into an abstract 1000x1000 box, and `basemap.pathD` is Web
  Mercator in tile pixels. Mixing them draws the route over the wrong streets.
- Route polylines are privacy-trimmed at both ends in the *write* path, before anything is
  persisted. The snapshot stores finished SVG path data, never raw coordinates. We request
  `activity:read_all`, which bypasses Strava privacy zones, so an untrimmed route would
  publish a home address more precisely than the athlete's own Strava profile does. Never
  move trimming to render time, and never persist untrimmed coordinates "just in case."
  The basemap is built from the *redacted* segments, so it frames only geometry that was
  already cleared for publication. It does change what the published part reveals, though: a
  shape on paper is anonymous, and the same shape over a street map is an address. If that
  trade is ever unwanted, `BASEMAP=off` drops the tiles and keeps the route.
- The map shows the most recent activity that actually has a GPS trace, not simply the most
  recent activity. Tennis, the gym, a treadmill and a pool swim carry no polyline, and taking
  only the newest activity meant one indoor session hid the map entirely while a mappable ride
  sat right behind it. Because the figure is therefore not always the athlete's latest
  workout, `RouteRender.startedAt` rides along and the caption always dates it. Never drop
  that date: without it the map silently implies the last thing they did was this ride.
- The form guide under the map is one measure on one axis: weekly moving time, in hours.
  Never give it a second y-scale. Session count and distance belong in the column hover
  titles and the table beneath the figure, never as a second series. The columns are ink and
  the median rule is the accent, not the other way round, and rest weeks are counted in the
  median so "usual" stays a number the athlete actually held.
- `Snapshot.workload`, `BasemapRender.start` and `BasemapRender.end` are optional, not merely
  nullable. Snapshots written before each of them exist in KV, and the read path has to
  survive being handed one, so guard on the key rather than trusting the type.
- Display "Powered by Strava" attribution with a link back, per Strava's brand guidelines.
