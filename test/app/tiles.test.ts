import { describe, expect, it } from "vitest";
import { handleTile, parseTilePath } from "../../src/app/tiles";
import { TUNING } from "../../src/domain/tuning";

const ctx = (): { waitUntil: (p: Promise<unknown>) => void } => ({
  waitUntil: () => {},
});

function pngResponse(status = 200): Response {
  return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
    status,
    headers: { "content-type": "image/png", "set-cookie": "upstream=1", "cache-control": "max-age=60" },
  });
}

/** Records what the proxy asked upstream for, so tests can assert on it. */
function spyFetch(response: () => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const tileRequest = (path: string, method = "GET"): Request =>
  new Request(`https://x${path}`, { method });

describe("parseTilePath", () => {
  it("accepts a tile inside the zoom range we actually render", () => {
    expect(parseTilePath("/tiles/14/2620/6333.png")).toEqual({ z: 14, x: 2620, y: 6333 });
  });

  it("rejects a zoom outside the range, so the proxy cannot be pushed past our own tiles", () => {
    expect(parseTilePath(`/tiles/${TUNING.BASEMAP_MIN_ZOOM - 1}/0/0.png`)).toBeNull();
    expect(parseTilePath(`/tiles/${TUNING.BASEMAP_MAX_ZOOM + 1}/0/0.png`)).toBeNull();
  });

  it("rejects coordinates that do not exist at that zoom", () => {
    // Zoom 3 is an 8x8 grid, so 8 is one past the edge.
    expect(parseTilePath("/tiles/3/8/0.png")).toBeNull();
    expect(parseTilePath("/tiles/3/0/8.png")).toBeNull();
    expect(parseTilePath("/tiles/3/7/7.png")).toEqual({ z: 3, x: 7, y: 7 });
  });

  it("rejects anything that is not a plain z/x/y png path", () => {
    for (const path of [
      "/tiles/14/2620.png",
      "/tiles/14/2620/6333.jpg",
      "/tiles/14/2620/6333.png/extra",
      "/tiles/14/-1/6333.png",
      "/tiles/14/26 20/6333.png",
      "/tiles/14/2620/6333.png?x=1",
      "/tiles/../../etc/passwd",
      "/tiles/14/2620/6333.PNG",
      "/",
    ]) {
      expect(parseTilePath(path), path).toBeNull();
    }
  });
});

describe("tile proxy", () => {
  it("fetches the tile from the upstream basemap and serves it as a png", async () => {
    const fetchSpy = spyFetch(() => pngResponse());
    const res = await handleTile(tileRequest("/tiles/14/2620/6333.png"), ctx(), {
      fetchImpl: fetchSpy.impl,
      cache: null,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(fetchSpy.calls).toHaveLength(1);
    expect(fetchSpy.calls[0]!.url).toBe("https://basemaps.cartocdn.com/light_all/14/2620/6333.png");
  });

  it("caches hard: tiles for a fixed z/x/y never change", async () => {
    const res = await handleTile(tileRequest("/tiles/14/2620/6333.png"), ctx(), {
      fetchImpl: spyFetch(() => pngResponse()).impl,
      cache: null,
    });
    expect(res.headers.get("cache-control")).toBe(
      `public, max-age=${TUNING.BASEMAP_TILE_MAX_AGE_S}, immutable`,
    );
  });

  it("passes nothing from the upstream response through to the visitor", async () => {
    const res = await handleTile(tileRequest("/tiles/14/2620/6333.png"), ctx(), {
      fetchImpl: spyFetch(() => pngResponse()).impl,
      cache: null,
    });
    expect(res.headers.get("set-cookie")).toBeNull();
    // Our policy, not the upstream's 60s one.
    expect(res.headers.get("cache-control")).not.toContain("max-age=60");
  });

  it("404s a tile we would never ask for, instead of proxying it", async () => {
    const fetchSpy = spyFetch(() => pngResponse());
    const res = await handleTile(tileRequest("/tiles/20/1/1.png"), ctx(), {
      fetchImpl: fetchSpy.impl,
      cache: null,
    });
    expect(res.status).toBe(404);
    expect(fetchSpy.calls).toHaveLength(0);
  });

  it("rejects a write method", async () => {
    const res = await handleTile(tileRequest("/tiles/14/2620/6333.png", "POST"), ctx(), {
      fetchImpl: spyFetch(() => pngResponse()).impl,
      cache: null,
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("GET");
  });

  it("serves a HEAD without touching the cache", async () => {
    const res = await handleTile(tileRequest("/tiles/14/2620/6333.png", "HEAD"), ctx(), {
      fetchImpl: spyFetch(() => pngResponse()).impl,
    });
    expect(res.status).toBe(200);
  });

  it("degrades to a blank tile when the basemap host errors, never a broken image", async () => {
    const res = await handleTile(tileRequest("/tiles/14/2620/6333.png"), ctx(), {
      fetchImpl: spyFetch(() => pngResponse(503)).impl,
      cache: null,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    // Not cached, so one bad minute does not freeze a hole in the map.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("degrades to a blank tile when the fetch itself throws", async () => {
    const impl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const res = await handleTile(tileRequest("/tiles/14/2620/6333.png"), ctx(), {
      fetchImpl: impl,
      cache: null,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("degrades to a blank tile when the upstream sends no body", async () => {
    const impl = (async () =>
      new Response(null, { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    const res = await handleTile(tileRequest("/tiles/14/2620/6333.png"), ctx(), {
      fetchImpl: impl,
      cache: null,
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("serves a cache hit without going upstream at all", async () => {
    const fetchSpy = spyFetch(() => pngResponse());
    const cached = new Response(new Uint8Array([1]), {
      headers: { "content-type": "image/png", "x-cache-fixture": "hit" },
    });
    const cache = {
      match: async () => cached,
      put: async () => {},
    } as unknown as Cache;

    const res = await handleTile(tileRequest("/tiles/14/2620/6333.png"), ctx(), {
      fetchImpl: fetchSpy.impl,
      cache,
    });
    expect(res.headers.get("x-cache-fixture")).toBe("hit");
    expect(fetchSpy.calls).toHaveLength(0);
  });

  it("writes a fresh tile into the cache for the next visitor", async () => {
    const puts: string[] = [];
    const cache = {
      match: async () => undefined,
      put: async (req: Request) => {
        puts.push(req.url);
      },
    } as unknown as Cache;
    const waited: Promise<unknown>[] = [];

    const res = await handleTile(
      tileRequest("/tiles/14/2620/6333.png"),
      { waitUntil: (p: Promise<unknown>) => waited.push(p) },
      { fetchImpl: spyFetch(() => pngResponse()).impl, cache },
    );
    await Promise.all(waited);

    expect(res.status).toBe(200);
    expect(puts).toEqual(["https://x/tiles/14/2620/6333.png"]);
    // The response the visitor gets must still be readable after the clone.
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });
});
