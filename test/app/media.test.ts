import { describe, expect, it } from "vitest";
import { handleMedia, mediaPath, resolveMedia } from "../../src/app/media";
import { MOODS, type Media, type Mood } from "../../src/data/moods";
import { TUNING } from "../../src/domain/tuning";

const ctx = (): { waitUntil: (p: Promise<unknown>) => void } => ({ waitUntil: () => {} });

const req = (path: string, method = "GET"): Request => new Request(`https://x${path}`, { method });

function jpegResponse(status = 200, type = "image/jpeg"): Response {
  return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
    status,
    headers: { "content-type": type, "set-cookie": "upstream=1", "cache-control": "max-age=60" },
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

function fakeMood(media: Media[]): Mood {
  return { id: "fake", name: "Fake", accent: "#000000", quotes: [], media, verifiedOn: "2026-08-20" };
}

const art = (over: Partial<Media> = {}): Media => ({
  kind: "image",
  url: "https://upload.wikimedia.org/wikipedia/commons/x.jpg",
  alt: "Art.",
  source: "Wikimedia Commons, public domain",
  verifiedOn: "2026-08-20",
  ...over,
});

describe("mediaPath", () => {
  it("names a catalogue entry, never a URL", () => {
    expect(mediaPath("believe", 0)).toBe("/media/believe/0");
    // Whatever it produces has to be resolvable by the thing that serves it.
    expect(resolveMedia(mediaPath("believe", 0))).not.toBeNull();
  });

  it("round-trips for every entry in the real catalogue", () => {
    for (const mood of MOODS) {
      for (let i = 0; i < mood.media.length; i++) {
        expect(resolveMedia(mediaPath(mood.id, i))).toEqual(mood.media[i]);
      }
    }
  });
});

describe("resolveMedia", () => {
  it("refuses a path that is not a catalogue entry", () => {
    for (const bad of [
      "/media/believe",
      "/media/believe/",
      "/media//0",
      "/media/believe/0/1",
      "/media/believe/x",
      "/media/BELIEVE/0",
      "/media/believe/0.jpg",
      "/tiles/14/1/1.png",
    ]) {
      expect(resolveMedia(bad)).toBeNull();
    }
  });

  it("refuses an unknown mood and an index past the end", () => {
    expect(resolveMedia("/media/not-a-mood/0")).toBeNull();
    expect(resolveMedia("/media/believe/9")).toBeNull();
  });

  it("refuses a video, because a video is a link and never auto-loaded", () => {
    const lookup = (): Mood => fakeMood([art({ kind: "video", url: "https://upload.wikimedia.org/v.webm" })]);
    expect(resolveMedia("/media/fake/0", lookup)).toBeNull();
  });

  it("refuses a host that is not on the allowlist", () => {
    // Cannot be triggered by a request: it guards against a future catalogue
    // edit quietly reintroducing a third-party fetch.
    const lookup = (): Mood => fakeMood([art({ url: "https://evil.test/x.jpg" })]);
    expect(resolveMedia("/media/fake/0", lookup)).toBeNull();
  });

  it("refuses a non-https url and an unparseable one", () => {
    expect(resolveMedia("/media/fake/0", () => fakeMood([art({ url: "http://upload.wikimedia.org/x.jpg" })]))).toBeNull();
    expect(resolveMedia("/media/fake/0", () => fakeMood([art({ url: "not a url" })]))).toBeNull();
  });
});

describe("handleMedia", () => {
  it("serves the upstream bytes with our own headers", async () => {
    const fetchSpy = spyFetch(() => jpegResponse());
    const res = await handleMedia(req("/media/believe/0"), ctx(), { fetchImpl: fetchSpy.impl, cache: null });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${TUNING.MEDIA_MAX_AGE_S}, immutable`);
    // Nothing from the upstream response reaches the visitor.
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("asks upstream for the catalogue's url, identifying itself", async () => {
    const fetchSpy = spyFetch(() => jpegResponse());
    await handleMedia(req("/media/believe/0"), ctx(), { fetchImpl: fetchSpy.impl, cache: null });

    const entry = MOODS.find((m) => m.id === "believe")!.media[0]!;
    expect(fetchSpy.calls[0]!.url).toBe(entry.url);
    const headers = fetchSpy.calls[0]!.init!.headers as Record<string, string>;
    expect(headers["user-agent"]).toContain("Cloudflare Worker");
  });

  it("passes a png through as a png", async () => {
    const fetchSpy = spyFetch(() => jpegResponse(200, "image/png; charset=binary"));
    const res = await handleMedia(req("/media/believe/0"), ctx(), { fetchImpl: fetchSpy.impl, cache: null });
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("404s rather than relaying a content type we did not ask for", async () => {
    // An upstream that starts answering with html must not become a way to
    // serve html from this origin.
    const fetchSpy = spyFetch(() => jpegResponse(200, "text/html"));
    const res = await handleMedia(req("/media/believe/0"), ctx(), { fetchImpl: fetchSpy.impl, cache: null });
    expect(res.status).toBe(404);
  });

  it("404s on an upstream error status and on a thrown fetch", async () => {
    const bad = spyFetch(() => jpegResponse(503));
    expect((await handleMedia(req("/media/believe/0"), ctx(), { fetchImpl: bad.impl, cache: null })).status).toBe(404);

    const boom = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const res = await handleMedia(req("/media/believe/0"), ctx(), { fetchImpl: boom, cache: null });
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("404s an unresolvable path without going upstream at all", async () => {
    const fetchSpy = spyFetch(() => jpegResponse());
    const res = await handleMedia(req("/media/not-a-mood/0"), ctx(), { fetchImpl: fetchSpy.impl, cache: null });
    expect(res.status).toBe(404);
    expect(fetchSpy.calls).toHaveLength(0);
  });

  it("refuses methods that are not a read", async () => {
    for (const method of ["POST", "DELETE", "PUT"]) {
      const res = await handleMedia(req("/media/believe/0", method), ctx(), { cache: null });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
    }
  });

  it("serves a cache hit without going upstream", async () => {
    const fetchSpy = spyFetch(() => jpegResponse());
    const cached = new Response("cached", { status: 200, headers: { "content-type": "text/plain" } });
    const cache = { match: async () => cached, put: async () => {} } as unknown as Cache;

    const res = await handleMedia(req("/media/believe/0"), ctx(), { fetchImpl: fetchSpy.impl, cache });
    expect(await res.text()).toBe("cached");
    expect(fetchSpy.calls).toHaveLength(0);
  });

  it("stores a miss in the cache", async () => {
    const fetchSpy = spyFetch(() => jpegResponse());
    const puts: Request[] = [];
    const cache = {
      match: async () => undefined,
      put: async (r: Request) => {
        puts.push(r);
      },
    } as unknown as Cache;

    const waited: Promise<unknown>[] = [];
    await handleMedia(req("/media/believe/0"), { waitUntil: (p) => waited.push(p) }, {
      fetchImpl: fetchSpy.impl,
      cache,
    });
    await Promise.all(waited);
    expect(puts).toHaveLength(1);
  });

  it("skips the cache for HEAD, which the Cache API cannot store", async () => {
    const fetchSpy = spyFetch(() => jpegResponse());
    let matched = false;
    const cache = {
      match: async () => {
        matched = true;
        return undefined;
      },
      put: async () => {},
    } as unknown as Cache;

    const res = await handleMedia(req("/media/believe/0", "HEAD"), ctx(), { fetchImpl: fetchSpy.impl, cache });
    expect(res.status).toBe(200);
    expect(matched).toBe(false);
  });
});
