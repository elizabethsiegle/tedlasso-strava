import { TUNING } from "../domain/tuning";

/**
 * Same-origin basemap tile proxy.
 *
 * The original design refused a tile provider partly to keep visitor IPs and
 * referrers away from a third party. Proxying keeps that promise: the browser
 * only ever talks to this Worker, and the Worker is the single client the tile
 * host sees, no matter how many people load the page. It also lets us cache
 * hard at the edge, which is what makes a 15-tile frame cheap on repeat views.
 *
 * Attribution for the upstream data is rendered on the page itself (see
 * `renderRoute`), as OpenStreetMap's and CARTO's terms require.
 */

const UPSTREAM_HOST = "https://basemaps.cartocdn.com";
/**
 * CARTO Positron. Chosen because it is nearly all white with pale grey streets
 * and thin labels, which is what survives the newsprint treatment in
 * `styles.ts` (multiply blend + a levels stretch): what prints is the street
 * network and the place names, not a slab of map colour fighting the accent.
 */
const UPSTREAM_STYLE = "light_all";

const TILE_PATH = /^\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/;

/** 1x1 transparent PNG: the frame degrades to bare newsprint if a tile fails. */
const BLANK_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

export interface TileDeps {
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** `null` disables the read-through cache (tests); omitted uses the edge cache. */
  cache?: Cache | null;
}

export interface TileCoords {
  z: number;
  x: number;
  y: number;
}

/**
 * Parse and bounds-check `/tiles/{z}/{x}/{y}.png`. Returns null for anything
 * that is not a tile we would ever ask for ourselves, so the proxy cannot be
 * pointed at arbitrary zooms or used as a general-purpose fetcher.
 */
export function parseTilePath(pathname: string): TileCoords | null {
  const match = TILE_PATH.exec(pathname);
  if (!match) return null;

  const z = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  if (z < TUNING.BASEMAP_MIN_ZOOM || z > TUNING.BASEMAP_MAX_ZOOM) return null;

  const perAxis = 2 ** z;
  if (x < 0 || x >= perAxis || y < 0 || y >= perAxis) return null;

  return { z, x, y };
}

function blank(): Response {
  return new Response(BLANK_PNG, {
    status: 200,
    headers: {
      "content-type": "image/png",
      // Never cached: a tile host hiccup must not freeze a hole in the map.
      "cache-control": "no-store",
    },
  });
}

export async function handleTile(
  request: Request,
  ctx: Pick<ExecutionContext, "waitUntil">,
  deps: TileDeps = {},
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const coords = parseTilePath(new URL(request.url).pathname);
  if (!coords) return new Response("Not found", { status: 404 });

  // The Cache API only accepts GET, so a HEAD goes straight upstream.
  const cache = request.method === "GET" ? (deps.cache === undefined ? caches.default : deps.cache) : null;
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }

  const doFetch = deps.fetchImpl ?? fetch;
  let upstream: Response;
  try {
    upstream = await doFetch(
      `${UPSTREAM_HOST}/${UPSTREAM_STYLE}/${coords.z}/${coords.x}/${coords.y}.png`,
      {
        headers: {
          accept: "image/png,image/*;q=0.8",
          // Identifies us to the tile host, as its usage terms ask.
          "user-agent": "tedlasso-strava (single-athlete Cloudflare Worker)",
        },
      },
    );
  } catch {
    return blank();
  }

  if (!upstream.ok || !upstream.body) return blank();

  // Rebuilt rather than passed through: nothing from the upstream response
  // headers (cookies, vary, its own cache policy) should reach the visitor.
  const response = new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": `public, max-age=${TUNING.BASEMAP_TILE_MAX_AGE_S}, immutable`,
      "x-tile": `${coords.z}/${coords.x}/${coords.y}`,
    },
  });

  if (cache) ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}
