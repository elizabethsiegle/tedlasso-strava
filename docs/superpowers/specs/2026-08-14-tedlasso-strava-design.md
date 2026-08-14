# tedlasso-strava — Design Spec

**Date:** 2026-08-14
**Status:** Approved, ready for implementation planning

## 1. Purpose

A single-page website, deployed on Cloudflare Workers, that reads one athlete's Strava
activity on a schedule, derives a "mood" from it, and displays a matching Ted Lasso quote
and GIF.

Single-athlete by design. There are no user accounts and no visitor-facing OAuth. Everyone
who visits sees the owner's mood.

## 2. Constraints established during design

These come from the Strava API documentation and were verified on 2026-08-14.

| Constraint | Value | Source |
|---|---|---|
| Read rate limit | 100 requests / 15 min, 1,000 / day | [rate-limits](https://developers.strava.com/docs/rate-limits/) |
| Overall rate limit | 200 requests / 15 min, 2,000 / day | same |
| Access token lifetime | 6 hours | [authentication](https://developers.strava.com/docs/authentication/) |
| Refresh token rotation | A new refresh token is returned on every refresh; the old one stops working | same |
| Required scope | `activity:read_all` | same |
| Attribution | "Powered by Strava" logo and link-back required when displaying Strava data | [guidelines](https://developers.strava.com/guidelines/) |

Budget check: the scheduled job makes 2 requests per run (token refresh + activity list) and
runs 6 times a day. That is 12 requests/day against a 1,000/day read limit. Manual refreshes
are additionally capped by a 60-second cooldown.

**Strava has no client-credentials or service-account grant for athlete data.** A one-time
human approval in a browser is unavoidable. Everything after that approval is automatic.

## 3. Architecture

### 3.1 Layering

```
src/
  domain/              no I/O, no network, no Workers types, no Date.now()
    activity.ts        normalized Activity type
    facts.ts           deriveFacts(activities, now, tz) -> Facts
    axes.ts            scoreConsistency(facts), scoreCharge(facts)
    mood.ts            selectMood(facts, axes) -> { moodId, reasons[] }
    quote.ts           pickQuote(moodId, seed) -> { quote, gif }
    tuning.ts          all numeric constants, single module
  data/
    moods.ts           versioned mood catalogue
  infrastructure/
    strava/client.ts   token refresh, activity fetch
    strava/map.ts      Strava JSON -> domain Activity
    store/kv.ts        SnapshotRepo, TokenRepo, HealthRepo, CooldownRepo
  app/
    refresh.ts         orchestration, shared by cron and manual endpoint
    auth.ts            /auth/login and /auth/callback
    render.ts          Snapshot -> HTML
  worker.ts            fetch + scheduled entrypoints
```

`src/domain` imports nothing from `src/infrastructure`. Infrastructure implements interfaces
the domain declares.

### 3.2 Two independent paths

**Write path — scheduled, `0 */4 * * *` (6×/day):**

```
scheduled()
  -> read refresh token from KV
  -> POST https://www.strava.com/oauth/token (grant_type=refresh_token)
  -> WRITE new refresh token to KV          <-- before any other use
  -> GET /api/v3/athlete/activities?after=<now-90d>&per_page=200
  -> map to domain Activity[]
  -> deriveFacts -> axes -> selectMood -> pickQuote
  -> write snapshot to KV, update health
```

**Read path — every page view:**

```
fetch() -> read snapshot + health from KV -> render HTML -> respond
```

The read path never calls Strava and never uses a token. Only the scheduled handler and the
guarded `/api/refresh` endpoint may call Strava.

### 3.3 Token handling

Refresh tokens rotate, so the live token cannot live in a Worker secret (secrets are
read-only at runtime). It lives in KV at `token/refresh`.

Rules:

1. The new refresh token is written to KV **before** the access token it came with is used
   for anything. A crash after that write loses nothing.
2. A failed refresh **never** clears or overwrites `snapshot/current`. It writes an error to
   `health` only. A stale mood is better than a blank page.
3. On a 4xx from the refresh grant, set `health.needsReauth = true`. The page then renders
   the last good snapshot plus a reconnect link.
4. There is no seed-token secret. Bootstrap and recovery are both the `/auth/login` flow.

### 3.4 One-time authorization flow

`GET /auth/login?key=<SETUP_KEY>`
- Rejects with 404 if the key is absent or wrong (404, not 403, to avoid advertising the route).
- Generates a random nonce, stores it at `oauth/state/<nonce>` with a 600-second TTL.
- Redirects to `https://www.strava.com/oauth/authorize` with `client_id`, `response_type=code`,
  `redirect_uri`, `approval_prompt=auto`, `scope=activity:read_all`, `state=<nonce>`.

`GET /auth/callback?code=…&state=…`
- Looks up `oauth/state/<nonce>`. Missing or expired -> 400. Deletes it on use, so a state is
  single-use.
- Exchanges the code (`grant_type=authorization_code`).
- Verifies `response.athlete.id === STRAVA_ATHLETE_ID`. Mismatch -> 403, nothing written.
- Writes the refresh token to KV, clears `needsReauth`, then immediately runs one refresh so
  a snapshot exists within seconds.

Both gates matter: the setup key prevents a stranger from starting a flow, and the athlete-ID
check prevents a stranger's Strava account from overwriting the owner's token even if they
somehow reached the callback.

## 4. The mood engine

All functions in this section are pure. `now` is always a parameter.

### 4.1 Window and fetch

90 days of activities via `GET /api/v3/athlete/activities`, with `after` as **epoch seconds**
(Strava's unit, not milliseconds), `per_page=200` (Strava's maximum), and at most 2 pages — a
hard cap of 400 activities bounds the work. 90 days covers the 12 full weeks the baseline
needs.

### 4.2 Facts

```ts
interface Facts {
  totalActivities: number          // within the 90-day window
  last: LastActivity | null        // name, sportType, distanceM, movingTimeS,
                                   // elevationM, startedAt
  daysSinceLast: number | null     // fractional days
  countLast7: number
  countLast14: number
  countLast28: number
  baselineWeekly: number           // median weekly count, trailing 12 FULL weeks,
                                   // excluding the current partial week
  streakDays: number
  relEffortLast: number            // 0..1
  isLongest90: boolean
  isFastest90: boolean
  previousGapDays: number | null   // days between the last activity and the one before it
}
```

**baselineWeekly.** Median of the per-week activity counts over the 12 full weeks preceding
the current partial week. With fewer than 4 full weeks of history, fall back to
`countLast28 / 4`. With no history, `0`.

**streakDays.** Consecutive calendar days, in a fixed configured IANA timezone (default
`America/Los_Angeles`), each containing at least one activity. Counting starts today if today
has an activity, otherwise yesterday. If neither has one, the streak is `0`. The timezone is
injected, never read from the runtime.

**relEffortLast.** Define `effort(a) = a.suffer_score ?? (a.moving_time / 60)`. Compute the
percentile rank of the last activity's effort against all *other* activities of the same
`sport_type` in the window. Requires at least 5 same-sport samples; otherwise fall back to
all sports, which also requires 5; otherwise `0.5`. Percentile rank is
`(count of other activities with strictly lower effort) / (count of other activities)`.

**isLongest90.** The last activity has the greatest `distance` among same-sport activities in
the window, and there are at least 3 prior same-sport samples. The sample floor stops a
first-ever activity from registering as a record.

**isFastest90.** The last activity has the greatest `average_speed` among same-sport
activities in the window whose `distance >= 0.8 * last.distance`, with at least 3 such prior
samples. The distance guard prevents a short sprint from beating a long ride.

### 4.3 Axes

Constants live in `src/domain/tuning.ts`.

**Consistency (0–100):**

```
volumeRatio = countLast7 / max(baselineWeekly, 1)
vol         = min(volumeRatio, 1.5) / 1.5           // 0..1, caps at 150% of baseline
floor28     = min(countLast28 / 12, 1)              // 12 in 4 weeks = full marks
streakPart  = min(streakDays / 5, 1)
raw         = 0.55*vol + 0.30*floor28 + 0.15*streakPart
recency     = clamp(1 - (daysSinceLast - 3) / 11, 0.15, 1)
consistency = round(100 * raw * recency)
```

`recency` is 1.0 through day 3, then falls linearly to its floor of 0.15 at day 14. With no
activities, consistency is `0`.

**Charge (0–100):**

```
charge = round(100 * relEffortLast * 0.5 ** (daysSinceLast / 3))
```

A 3-day half-life. Effort at the 100th percentile yesterday scores 79; the same effort 9 days
ago scores 13. With no activities, charge is `0`.

The two axes are deliberately independent: consistency measures showing up over weeks, charge
measures how recently hard work happened.

### 4.4 Selection

Ordered overrides, first match wins. Each returns the mood plus its reason strings.

| # | Condition | Mood id |
|---|---|---|
| 1 | `totalActivities === 0` | `preseason` |
| 2 | `daysSinceLast >= 10` | `whered-you-go` |
| 3 | `(isLongest90 \|\| isFastest90) && daysSinceLast <= 2` | `believe` |
| 4 | `streakDays >= 5` | `roy-kent` |
| 5 | `daysSinceLast <= 2 && previousGapDays >= 7` | `comeback-szn` |

If none match, select from the score grid. A score of `>= 60` is high; `36–59` is the middle
band; `<= 35` is low. The rules below are evaluated in order, so the middle-band rule is
checked before the four quadrants.

| Condition | Mood id |
|---|---|
| both scores in 36–59 | `diamond-dogs` |
| `consistency >= 60 && charge >= 60` | `football-is-life` |
| `consistency >= 60 && charge < 60` | `gaffer-mode` |
| `consistency < 60 && charge >= 60` | `hopeful` |
| `consistency < 60 && charge < 60` | `biscuits` |

Nine moods total.

### 4.5 Mood catalogue

`src/data/moods.ts`. Data, never logic.

```ts
interface Mood {
  id: string
  name: string
  accent: string                 // hex, the mood's single ink color
  quotes: { text: string; character: string }[]   // 3–5 per mood
  gifs: { url: string; alt: string; source: string; verifiedOn: string }[]
  verifiedOn: string             // ISO date
}
```

GIF `alt` text is written to read as a complete sentence on its own, so a failed image
degrades to a readable caption. A `verifiedOn` older than 180 days renders a staleness marker
in the footer.

### 4.6 Quote selection

```
index = fnv1a(String(refreshedAt) + moodId) % quotes.length
```

Seeded on the snapshot's `refreshedAt`, not the calendar date, so a manual refresh visibly
changes the quote even when the mood is unchanged. No `Math.random()` anywhere in the domain;
output is a pure function of its inputs and tests assert exact strings.

### 4.7 Reasons

Every selection emits human-readable reason strings for the receipts block, phrased in terms
of observable facts rather than scores. Examples: "4 workouts this week, against your usual
2.5", "hardest session in three weeks, and it was yesterday", "9 days since your last
activity".

**Accuracy rule:** never use the phrase "personal record" or "PR". Activity summaries do not
contain best-effort data, so the defensible claim is "longest ride in 90 days".

### 4.8 Route geometry

`SummaryActivity` already includes `map.summary_polyline` (a Google-encoded polyline, and
nullable) plus `start_latlng` / `end_latlng`. This is in the activity-list response we
already fetch, so the map costs **zero additional API calls**.

The last activity's route is drawn as an inline SVG path in the mood's accent color. There is
no base map, no tile provider, no API key, and no client-side JavaScript.

The whole pipeline is pure and runs in `src/domain/route.ts`:

```
decodePolyline(str)      -> LatLng[]        Google polyline algorithm, precision 5
privacyTrim(points, m)   -> LatLng[]        drop both ends (see below)
simplify(points, eps)    -> LatLng[]        Ramer–Douglas–Peucker, cap ~300 points
project(points)          -> XY[]            equirectangular, x scaled by cos(mean latitude)
toPath(xy, padding)      -> { pathD, viewBox }
```

**Privacy trim.** Walk in from the start dropping points until the cumulative haversine
distance from the first point exceeds `PRIVACY_TRIM_M` (default 250), then do the same from
the end. Routes typically begin and end at the athlete's home, and `activity:read_all`
bypasses any Strava privacy zones the athlete has configured — so the untrimmed polyline
would reveal more than their public Strava profile does. If fewer than 2 points survive the
trim, the route is `null` and the no-route fallback renders instead.

**Projection.** Equirectangular with `x = lng * cos(meanLat)` to prevent horizontal
squashing, then fit to the viewBox preserving aspect ratio with uniform padding. Web Mercator
is unnecessary at the scale of a single activity.

**Where trimming happens is load-bearing.** Decode, trim, and simplify all run in the write
path. Only the finished `pathD` string reaches `snapshot/current`. Untrimmed coordinates are
never persisted in anything the site can serve, which makes the privacy trim a structural
property rather than a render-time convention a later change could undo.

**No-route fallback.** `summary_polyline` is null for indoor and manually-entered activities
(treadmill, gym, manual swim). These render a designed block in the same frame — sport name
set large with the duration — never an empty box.

**Caption.** Distance, elevation gain, and sport type. Strava's `location_city` /
`location_state` are frequently null, so the label renders only when present and its absence
changes nothing about the layout.

## 5. Storage

One KV namespace.

| Key | Contents | Notes |
|---|---|---|
| `token/refresh` | the live rotating refresh token | written before use |
| `snapshot/current` | last good `Snapshot` JSON | only written on a fully successful refresh |
| `health` | `{ lastAttemptAt, lastSuccessAt, lastError, needsReauth }` | written on every attempt |
| `refresh/lastAt` | epoch ms of the last manual refresh | 60s cooldown |
| `oauth/state/<nonce>` | pending OAuth state | 600s TTL, single-use |

```ts
interface Snapshot {
  version: 1
  refreshedAt: number
  mood: { id: string; name: string; accent: string }
  quote: { text: string; character: string }
  gif: { url: string; alt: string }
  scores: { consistency: number; charge: number }
  reasons: string[]
  facts: PublicFacts
  route: {
    pathD: string          // already trimmed, simplified, projected
    viewBox: string
    distanceM: number
    elevationM: number
    sportType: string
    locationLabel: string | null
  } | null                 // null for indoor/manual activities, or if the trim consumed it
}
```

Splitting `snapshot/current` from `health` is what makes "a failed refresh never damages the
page" structurally true rather than a convention.

## 6. Routes

| Route | Behavior |
|---|---|
| `GET /` | Render the page from `snapshot/current` + `health`. Never calls Strava. |
| `GET /?preview=<moodId>` | Render any catalogue mood against real stats, with a visible "preview — not your live mood" banner. Ungated; it reveals nothing the page doesn't already show. |
| `GET /auth/login?key=` | Setup-key gated. Starts the OAuth flow. |
| `GET /auth/callback` | State + athlete-ID gated. Stores the token, runs a first refresh. |
| `POST /api/refresh` | Setup-key gated, 60s cooldown. Runs the same orchestration as cron, returns the new snapshot as JSON. |

The refresh button renders only when the page is loaded with a valid `?key=`, and the
endpoint validates the key independently — it never trusts that the button was present.

**Local development:** `wrangler dev --test-scheduled` exposes `/__scheduled`, so the cron
handler can be fired by hand with
`curl "http://localhost:8787/__scheduled?cron=0+*/4+*+*+*"`. No extra code.

## 7. The page

Server-rendered HTML with inline CSS. No component framework and no CSS framework, so there
are no defaults to accidentally ship.

**Visual direction: a non-league matchday programme.** Newsprint stock, heavy condensed
display type over a plain text face, one ink accent per mood, hairline rules doing the layout
work instead of card shadows, statistics set like a results table. This direction is recorded
in `CLAUDE.md` so it is not re-decided each session.

Anatomy, top to bottom:

1. Thin masthead rule; the mood name set tight and large in the mood's accent.
2. The quote — by a wide margin the largest element on the page — with the character's name
   beneath in small caps.
3. The GIF, beside the quote on wide screens and beneath it on narrow, bordered in the accent.
4. The route map: an inline SVG of the last activity's path, stroked in the mood accent on
   the newsprint background, in a ruled frame with a caption of distance, elevation, and
   sport. No base map, no tiles, no JavaScript. Falls back to the designed no-route block for
   indoor and manual activities.
5. A hairline rule, then the receipts: last activity name, sport, distance, and when; this
   week's count against baseline; streak; days since. Set as a dense tabular block with
   lining numerals, deliberately tighter than the hero. That density contrast is the layout.
6. Footer: "Powered by Strava" with link-back, the refresh timestamp, the next scheduled run,
   and a staleness marker if any displayed GIF's `verifiedOn` is over 180 days old.

Manual refresh swaps the quote and GIF in place without a page reload, after a tunable
minimum animation duration (default 1200ms) so the change registers as an event. Without
JavaScript, the button falls back to a form POST and a redirect.

**Designed failure states**, each with real copy:

| State | Behavior |
|---|---|
| No snapshot yet | `preseason` mood, copy stating the first fetch has not run. No fake spinner. |
| `needsReauth` | Last good snapshot still renders, plus a reconnect link to `/auth/login`. |
| Snapshot older than 12h | Small dated stamp on the masthead. Visible, not alarming. |
| No activities in 90 days | `preseason`, with copy that is kind rather than scolding. |
| GIF fails to load | Degrades to its `alt` text, which reads as a sentence. |

## 8. Testing

**Domain — plain Vitest, fixture-driven.** JSON fixtures of Strava responses paired with
expected facts, scores, mood, and reasons. Fixtures are ground truth: if the implementation
and a fixture disagree, the implementation is wrong. Target at or near 100% branch coverage,
gated in CI. Required cases include every override rule, every grid region, and:

- an activity exactly 10.0 days old (override 2 boundary)
- a first-ever activity, which must not satisfy `isLongest90`
- a short fast run that must not satisfy `isFastest90` against longer rides
- a DST transition inside a streak
- an athlete with under 4 weeks of history (baseline fallback)
- zero activities

Route geometry (§4.8) gets its own fixture set, since it is the most arithmetic-heavy code in
the repo:

- `decodePolyline` against the canonical test vectors from Google's polyline documentation
- the privacy trim removes at least `PRIVACY_TRIM_M` from **both** ends, verified by
  recomputing haversine distance from the original endpoints
- an out-and-back route whose start and end are the same point still has both ends trimmed
- a route shorter than twice the trim distance yields `route: null`, not a stub path
- a null `summary_polyline` yields `route: null` and the no-route fallback
- projection preserves aspect ratio, and a route at high latitude is not horizontally stretched
- simplification stays under the point cap and never drops the first or last surviving point
- a snapshot never contains coordinates outside the trimmed set (asserted directly against
  the serialized `pathD`, so a future refactor cannot silently reintroduce them)

**Infrastructure — `@cloudflare/vitest-pool-workers` with a mocked Strava.** Required cases:

- the rotated refresh token is written to KV before the access token is used
- a 4xx refresh leaves `snapshot/current` byte-identical and sets `needsReauth`
- a 429 on the activity fetch writes no snapshot
- `/api/refresh` rejects a missing or wrong key
- `/api/refresh` honors the 60-second cooldown
- `/auth/callback` rejects a reused state, an expired state, and a mismatched athlete ID

**Render — snapshot tests** over the HTML for all nine moods and every failure state in §7.

## 9. Configuration

`wrangler.jsonc`: one KV namespace binding, observability enabled, and cron triggers declared
under a `triggers` object (verified 2026-08-14 against the Cloudflare docs — `crons` is not a
top-level key):

```jsonc
"triggers": { "crons": ["0 */4 * * *"] }
```

Secrets: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_ATHLETE_ID`, `SETUP_KEY`.

Vars: `TIMEZONE` (default `America/Los_Angeles`), `REDIRECT_URI`, `PRIVACY_TRIM_M`
(default `250`; set to `0` to disable trimming entirely).

## 10. Decisions taken, with the reasoning

- **Cron-and-snapshot over lazy revalidation.** Lazy refresh lets data rot when nobody
  visits, races between concurrent visitors, and makes page uptime depend on Strava's.
- **KV over a Durable Object.** A DO would serialize token writes, but there is exactly one
  writer, so KV's consistency model is not a problem worth new infrastructure.
- **Curated GIF list over a GIF API.** No API key, no rate limit, no second failure mode, and
  no off-topic results. Variety is bounded by curation, which is an acceptable trade.
- **Overrides before the grid.** A pure grid cannot express "gone for ten days" or "just set
  a 90-day best", which are the most interesting states. A pure rule ladder loses the nuance
  of ordinary weeks. Both together cover both.
- **No seed-token secret.** Its only job was bootstrap, which `/auth/login` now does better.
  Recovery becomes one click instead of a terminal session.
- **No OAuth callback for visitors.** Single-athlete by design; the callback exists only for
  the owner and is gated twice.
- **Inline SVG route over a tile-provider map.** The polyline is already in the data we
  fetch, so drawing it ourselves costs nothing: no API key, no per-view request to a third
  party, no client-side JavaScript, and no visitor data leaking to a tile host. It is also
  fully unit-testable as a pure function, and looks far less generic than an embedded map —
  which the project's UI rules require.
- **Ghost trails deferred.** Overlaying all 90 days of routes was considered and set aside
  for the first build. It needs outlier handling for travel and roughly triples the route
  payload. Revisit once the single-route renderer is proven.

## 11. Accepted risk, flagged explicitly

**The page is public and displays real activity data** — the last activity's name, sport,
distance, timing, workout frequency, and the shape of the route. Anyone with the URL can see
it. The owner reviewed this on 2026-08-14 and accepted it, and asked for the map specifically.

The one mitigation that is **in** the first build is the privacy trim described in §4.8, on
by default at 250m. It exists because `activity:read_all` bypasses Strava privacy zones, so
an untrimmed route would publish the athlete's home address more precisely than their own
Strava profile does. Setting `PRIVACY_TRIM_M=0` disables it; that is a deliberate choice, not
a default anyone falls into.

Residual exposure after the trim: the general neighborhood, the athlete's training schedule,
and any location detail they typed into an activity name themselves. Two further mitigations
remain available and cheap if wanted later — a `DETAIL_LEVEL` var that keeps the mood while
suppressing the name, route, and exact distance, or putting the whole site behind Cloudflare
Access. Neither is in scope for the first build.

## 12. Out of scope

Mood history and charts (would require D1 rather than a KV snapshot), multi-athlete support,
real personal records via per-activity best-effort calls, and webhook-driven near-real-time
updates.
