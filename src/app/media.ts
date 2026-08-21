import { getMood, type Media, type Mood } from "../data/moods";
import { TUNING } from "../domain/tuning";

/**
 * Same-origin proxy for the catalogue's artwork, built on the same reasoning as
 * the tile proxy in `tiles.ts`: the browser only ever talks to this Worker, so
 * the image host sees one client instead of every visitor's IP and referrer.
 *
 * The difference from tiles is what stops this being an open proxy. A tile is
 * validated arithmetically (a zoom and an x/y inside the world at that zoom).
 * There is no such check for an arbitrary URL, so this proxy does not accept
 * one: the path names a *catalogue entry*, and the upstream URL is read from
 * the versioned catalogue in `src/data/moods.ts`. Nothing a caller sends is
 * ever passed to fetch, which is what makes this safe rather than an SSRF hole
 * with extra steps.
 *
 * Attribution and licensing live with the catalogue entry (`source`), and the
 * artwork is public domain.
 */

const MEDIA_PATH = /^\/media\/([a-z][a-z0-9-]{0,40})\/(\d{1,2})$/;

/**
 * Belt and braces. The URL already comes from our own versioned catalogue, so
 * this cannot be tripped by a request; it is here so that a future catalogue
 * edit pointing at some other host fails loudly at the proxy instead of quietly
 * reintroducing the third-party fetch this module exists to prevent.
 */
const ALLOWED_HOSTS = new Set(["upload.wikimedia.org"]);

/** Proxied through as-is; anything else is refused rather than relayed. */
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);

export interface MediaDeps {
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** `null` disables the read-through cache (tests); omitted uses the edge cache. */
  cache?: Cache | null;
}

/**
 * The same-origin path for a catalogue entry. This is what gets written into
 * the snapshot, so the page never carries an upstream URL for anything the
 * browser loads on its own.
 */
export function mediaPath(moodId: string, index: number): string {
  return `/media/${moodId}/${index}`;
}

/**
 * Resolve `/media/{moodId}/{index}` against the catalogue.
 *
 * Videos resolve to null on purpose: they are offered as a link for the visitor
 * to click, never auto-loaded, so there is nothing to proxy and proxying a
 * video would only invite someone to stream it through the Worker.
 */
export function resolveMedia(
  pathname: string,
  lookup: (id: string) => Mood | undefined = getMood,
): Media | null {
  const match = MEDIA_PATH.exec(pathname);
  if (!match) return null;

  const mood = lookup(match[1] as string);
  if (!mood) return null;

  const entry = mood.media[Number(match[2])];
  if (!entry || entry.kind === "video") return null;

  let host: string;
  try {
    const url = new URL(entry.url);
    if (url.protocol !== "https:") return null;
    host = url.hostname;
  } catch {
    return null;
  }
  return ALLOWED_HOSTS.has(host) ? entry : null;
}

/**
 * 404 rather than a placeholder image, which is the opposite of the tile
 * proxy's choice and deliberate. A hole in a tile grid is invisible; a 1x1
 * stretched across the hero column is a hairline artefact. A missing image lets
 * the browser fall back to the `alt` text, which actually says what the picture
 * was.
 */
function missing(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleMedia(
  request: Request,
  ctx: Pick<ExecutionContext, "waitUntil">,
  deps: MediaDeps = {},
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const entry = resolveMedia(new URL(request.url).pathname);
  if (!entry) return missing();

  // The Cache API only accepts GET, so a HEAD goes straight upstream.
  const cache =
    request.method === "GET" ? (deps.cache === undefined ? caches.default : deps.cache) : null;
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }

  const doFetch = deps.fetchImpl ?? fetch;
  let upstream: Response;
  try {
    upstream = await doFetch(entry.url, {
      headers: {
        accept: "image/jpeg,image/png,image/*;q=0.8",
        // Identifies us to the host, as Wikimedia's user-agent policy requires.
        "user-agent": "tedlasso-strava (single-athlete Cloudflare Worker)",
      },
    });
  } catch {
    return missing();
  }

  const type = (upstream.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!upstream.ok || !upstream.body || !ALLOWED_TYPES.has(type)) return missing();

  // Rebuilt rather than passed through: nothing from the upstream response
  // headers (cookies, vary, its own cache policy) should reach the visitor.
  const response = new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": type,
      "cache-control": `public, max-age=${TUNING.MEDIA_MAX_AGE_S}, immutable`,
    },
  });

  if (cache) ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}
