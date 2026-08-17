# tedlasso-strava

A single-athlete Cloudflare Worker that reads your Strava activity every 4 hours, derives a
"mood" from it, and serves a matching Ted Lasso quote and GIF on a public page. It is built
for one Strava account at a time — there is no multi-user login or account switching.

## One-time setup

1. Create a Strava API application at
   [`https://www.strava.com/settings/api`](https://www.strava.com/settings/api). Set the
   **Authorization Callback Domain** to the Worker's domain (for local work, use
   `localhost`).
2. Create the KV namespace the Worker stores its snapshot and tokens in:

   ```bash
   npx wrangler kv namespace create STORE
   ```

   Paste the returned `id` into the `kv_namespaces` entry in `wrangler.jsonc`.
3. Set the required secrets:

   ```bash
   npx wrangler secret put STRAVA_CLIENT_ID
   npx wrangler secret put STRAVA_CLIENT_SECRET
   npx wrangler secret put STRAVA_ATHLETE_ID
   npx wrangler secret put SETUP_KEY
   ```

   `STRAVA_ATHLETE_ID` is the number in your Strava profile URL
   (`strava.com/athletes/<this number>`). `SETUP_KEY` is a long random string you pick — it
   gates `/auth/login` and `/api/refresh` so nobody else can trigger them.
4. Set `REDIRECT_URI` in `wrangler.jsonc` to `https://<your-worker-domain>/auth/callback`.
5. Deploy:

   ```bash
   npx wrangler deploy
   ```
6. Visit `https://<your-worker-domain>/auth/login?key=<SETUP_KEY>` **once** and approve the
   Strava authorization prompt.

That single click is the only manual step, ever. Strava has no service-account or
machine-to-machine grant for personal data, so one browser approval is unavoidable to start —
but everything after it (token refresh, rotation, and the recurring data pull) is automatic.

## Local development

```bash
cp .dev.vars.example .dev.vars   # then fill in real values
npm run dev
```

To exercise the scheduled refresh without waiting for the real cron:

```bash
curl "http://localhost:8787/__scheduled?cron=0+*/4+*+*+*"
```

## Operating notes

- The cron runs every 4 hours — roughly 12 Strava API requests a day against Strava's
  1,000/day rate limit.
- `POST /api/refresh?key=<SETUP_KEY>` forces an immediate refresh. It's throttled to once a
  minute.
- `/?preview=<moodId>` previews any mood regardless of current Strava data. Valid ids:
  `preseason`, `whered-you-go`, `believe`, `roy-kent`, `comeback-szn`, `diamond-dogs`,
  `football-is-life`, `gaffer-mode`, `hopeful`, `biscuits`.
- If the page shows "Reconnect Strava", the stored token has stopped refreshing — visit
  `/auth/login?key=<SETUP_KEY>` again to reauthorize.

## Privacy

**This page is public.** Anyone with the URL can see the last activity's name, sport,
distance, and timing, a rolling sense of workout frequency, and the shape of the route.

Routes are trimmed by `PRIVACY_TRIM_M` metres (default `250`) at both the start and the end,
and anywhere the route passes back near either its original start or its original end —
because the Worker requests the `activity:read_all` scope, which bypasses Strava's own
privacy zones entirely. Without this trimming, the published route would reveal a home
address more precisely than the athlete's own Strava profile does. As a result, a route may
render with a visible gap where it enters or exits the trimmed radius — that gap is
intentional, not a bug.

Setting `PRIVACY_TRIM_M=0` disables trimming entirely and publishes exact start and end
coordinates. Do this only if you understand and accept that trade-off.

## Attribution

Powered by [Strava](https://www.strava.com).

GIFs are hotlinked from [Giphy](https://giphy.com) (`media.giphy.com`); credit to Giphy and
the original clip creators.

This project is not affiliated with, endorsed by, or sponsored by Strava, Giphy, or the
makers of Ted Lasso.

## Known limitations

- 4 of the 10 moods (`whered-you-go`, `gaffer-mode`, `hopeful`, `biscuits`) currently ship
  without a GIF and render a single-column layout instead of the two-column quote+GIF
  layout.
- GIF alt text was written from search-result metadata rather than by viewing each GIF
  directly, so descriptions are approximate — they describe the character and emotional beat
  the mood mapping supports, not verified frame-by-frame content.
