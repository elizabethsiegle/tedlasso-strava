import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { escapeHtml, renderPage } from "../../src/app/render";
import worker from "../../src/worker";
import { MOODS } from "../../src/data/moods";
import { EMPTY_HEALTH, type Snapshot } from "../../src/types";

const NOW = Date.parse("2026-08-14T19:00:00Z");

function snapshot(route: Snapshot["route"]): Snapshot {
  return {
    version: 1, refreshedAt: NOW,
    mood: { id: "believe", name: "Believe", accent: "#F2C14E" },
    quote: { text: "Believe.", character: "AFC Richmond locker room" },
    gif: null, scores: { consistency: 70, charge: 60 }, reasons: [],
    facts: {
      last: {
        name: "Ride", sportType: "Ride", distanceM: 24_300,
        movingTimeS: 3600, elevationM: 210, startedAt: NOW - 3_600_000,
      },
      daysSinceLast: 0.04, countLast7: 3, baselineWeekly: 2, streakDays: 1, totalActivities: 20,
    },
    route,
  };
}

function view(s: Snapshot) {
  return { snapshot: s, health: { ...EMPTY_HEALTH }, nowMs: NOW, showRefreshButton: false, previewNotice: null };
}

/** A snapshot written before the basemap existed: `route.basemap` is absent. */
const LEGACY_ROUTE = {
  pathD: "M40 960 L500 500 L960 40",
  viewBox: "0 0 1000 1000",
  distanceM: 24_300,
  elevationM: 210,
  sportType: "Ride",
  locationLabel: "San Francisco, CA",
};

const BASEMAP = {
  zoom: 14,
  width: 1000,
  height: 560,
  tiles: [
    { z: 14, x: 2620, y: 6333, left: -12.5, top: -8.4, width: 25.6, height: 45.714 },
    { z: 14, x: 2621, y: 6333, left: 13.1, top: -8.4, width: 25.6, height: 45.714 },
  ],
  pathD: "M120 480 L500 280 L880 90",
  scale: { label: "500 m", width: 18.2 },
};

const ROUTE = { ...LEGACY_ROUTE, basemap: BASEMAP };

describe("route rendering", () => {
  it("emits an inline svg with the path", () => {
    const html = renderPage(view(snapshot(LEGACY_ROUTE)));
    expect(html).toContain("<svg");
    expect(html).toContain("M40 960 L500 500 L960 40");
    expect(html).toContain('viewBox="0 0 1000 1000"');
  });

  it("strokes the route rather than filling it", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).toContain('fill="none"');
    expect(html).toContain("stroke=");
  });

  it("captions the route with distance, elevation, and sport", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).toContain("24.3");
    expect(html).toContain("210");
    expect(html).toContain("Ride");
  });

  it("includes the location label when present", () => {
    expect(renderPage(view(snapshot(ROUTE)))).toContain("San Francisco, CA");
  });

  it("omits the location line when absent, without leaving an empty element", () => {
    const html = renderPage(view(snapshot({ ...ROUTE, locationLabel: null })));
    expect(html).not.toContain("route-place");
  });

  // The basemap replaced the original "no tiles at all" rule with a narrower
  // one: tiles are allowed, but the browser must never talk to the tile host.
  // Every image the page loads is same-origin and proxied (src/app/tiles.ts),
  // so no visitor IP or referrer reaches a third party.
  it("loads every map image from our own origin, never a tile host", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    const sources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]!);

    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src, src).toMatch(/^\/tiles\//);
    }
    for (const host of ["cartocdn", "mapbox", "tile.openstreetmap", "googleapis", "arcgis"]) {
      expect(html, host).not.toContain(host);
    }
  });

  it("credits OpenStreetMap and CARTO, as their terms require", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).toContain("https://www.openstreetmap.org/copyright");
    expect(html).toContain("https://carto.com/attributions");
  });

  it("renders a designed fallback for an indoor activity", () => {
    const html = renderPage(view(snapshot(null)));
    expect(html).not.toContain("<svg");
    expect(html).toContain("No route");
    expect(html).toContain("Ride"); // the sport still gets named
  });

  it("escapes a malicious location label", () => {
    const html = renderPage(view(snapshot({ ...ROUTE, locationLabel: '"><script>x</script>' })));
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("basemap under the route", () => {
  it("lays the tiles out in the frame the domain computed", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).toContain('src="/tiles/14/2620/6333.png"');
    expect(html).toContain('src="/tiles/14/2621/6333.png"');
    expect(html).toContain("left:13.1%;top:-8.4%;width:25.6%;height:45.714%");
    // The frame's own proportions, not the abstract 1000x1000 box.
    expect(html).toContain("aspect-ratio:1000/560");
    expect(html).toContain('viewBox="0 0 1000 560"');
  });

  it("draws the tile-aligned path, not the equirectangular one", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).toContain("M120 480 L500 280 L880 90");
    expect(html).not.toContain("M40 960 L500 500 L960 40");
  });

  it("strokes the line twice so the accent survives crossing a street label", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).toContain('stroke="var(--stock)"');
    expect(html).toContain('stroke="var(--ink-accent)"');
  });

  it("hides the tiles from assistive tech and describes the map in one label", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).toContain('<div class="route-tiles" aria-hidden="true">');
    expect(html).toContain("street map of San Francisco, CA");
    // One img alt per tile would read as 15 unlabelled images.
    expect(html).not.toContain('class="route-tile" src="/tiles/14/2620/6333.png" alt="Map');
  });

  it("prints a scale bar, because a fitted frame hides how far this actually was", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).toContain("500 m");
    expect(html).toContain("width:18.2%");
  });

  it("falls back to the bare path for a snapshot written before the basemap existed", () => {
    const html = renderPage(view(snapshot(LEGACY_ROUTE)));
    expect(html).not.toContain("/tiles/");
    expect(html).not.toContain('<div class="route-map');
    expect(html).toContain("M40 960 L500 500 L960 40");
    expect(html).not.toContain("openstreetmap.org/copyright");
  });

  it("falls back to the bare path when the basemap is switched off", () => {
    const html = renderPage({ ...view(snapshot(ROUTE)), showBasemap: false });
    expect(html).not.toContain('src="/tiles/');
    expect(html).toContain("M40 960 L500 500 L960 40");
  });

  it("still renders the route when the basemap came back null (no tiles fit)", () => {
    const html = renderPage(view(snapshot({ ...LEGACY_ROUTE, basemap: null })));
    expect(html).toContain("M40 960 L500 500 L960 40");
    expect(html.toLowerCase()).not.toContain("undefined");
  });

  // KV is the trust boundary: the snapshot is JSON we parsed, not a value we
  // can assume our own writer produced.
  it("drops a tampered tile coordinate instead of emitting it into an attribute", () => {
    const hostile = {
      ...ROUTE,
      basemap: {
        ...BASEMAP,
        tiles: [
          { z: 14, x: 999_999, y: 6333, left: 0, top: 0, width: 25.6, height: 45.714 },
          { z: 9, x: 1, y: 1, left: 0, top: 0, width: 25.6, height: 45.714 },
          { z: 14, x: "1\" onerror=alert(1) x=\"", y: 1, left: 0, top: 0, width: 1, height: 1 },
        ],
      },
    } as unknown as Snapshot["route"];

    const html = renderPage(view(snapshot(hostile)));
    expect(html).not.toContain("999999");
    expect(html).not.toContain("/tiles/9/");
    expect(html).not.toContain("onerror");
  });

  it("coerces a non-numeric position rather than writing NaN into the style", () => {
    const hostile = {
      ...ROUTE,
      basemap: { ...BASEMAP, tiles: [{ z: 14, x: 1, y: 1, left: "x", top: null, width: 1, height: 1 }] },
    } as unknown as Snapshot["route"];

    const html = renderPage(view(snapshot(hostile)));
    expect(html).toContain("left:0%;top:0%");
    expect(html.toLowerCase()).not.toContain("nan");
  });

  it("escapes a tampered path and scale label", () => {
    const hostile = {
      ...ROUTE,
      basemap: {
        ...BASEMAP,
        pathD: '"><script>x</script>',
        scale: { label: '"><script>y</script>', width: 10 },
      },
    } as unknown as Snapshot["route"];

    const html = renderPage(view(snapshot(hostile)));
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<script>y</script>");
  });
});

describe("the printed plate around the map", () => {
  const WITH_ENDS = {
    ...ROUTE,
    basemap: { ...BASEMAP, start: { x: 120, y: 480 }, end: { x: 880, y: 90 } },
  };

  it("studs the start and rings the finish, each cased in stock", () => {
    const html = renderPage(view(snapshot(WITH_ENDS)));
    expect(html).toContain(
      '<circle cx="120" cy="480" r="9" fill="var(--ink-accent)" stroke="var(--stock)" stroke-width="4"/>',
    );
    expect(html).toContain(
      '<circle cx="880" cy="90" r="9" fill="var(--stock)" stroke="var(--ink-accent)" stroke-width="5"/>',
    );
  });

  it("draws no terminals for a snapshot written before they existed", () => {
    // BASEMAP has no start/end: the plate still prints, minus the studs.
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).not.toContain("<circle");
    expect(html).toContain('class="route-reg"');
  });

  it("prints four registration marks, one per corner", () => {
    const html = renderPage(view(snapshot(WITH_ENDS)));
    const marks = html.slice(html.indexOf('class="route-reg"'));
    expect([...marks.slice(0, marks.indexOf("</g>")).matchAll(/<path /g)]).toHaveLength(4);
  });

  it("orients the frame with a north arrow to go with the scale bar", () => {
    const html = renderPage(view(snapshot(WITH_ENDS)));
    expect(html).toContain('class="route-north"');
    expect(html).toContain(">N</text>");
    expect(html).toContain('class="route-scale-bar"');
  });

  it("keeps the furniture out of the accessible tree", () => {
    const html = renderPage(view(snapshot(WITH_ENDS)));
    const reg = html.indexOf('class="route-reg"');
    const north = html.indexOf('class="route-north"');
    expect(html.slice(reg, reg + 60)).toContain("aria-hidden");
    expect(html.slice(north, north + 60)).toContain("aria-hidden");
  });

  it("coerces hand-edited terminal coordinates instead of drawing to NaN", () => {
    const hostile = {
      ...ROUTE,
      basemap: { ...BASEMAP, start: { x: "left", y: null }, end: { x: Infinity, y: 90 } },
    } as unknown as Snapshot["route"];
    const html = renderPage(view(snapshot(hostile)));
    expect(html).toContain('<circle cx="0" cy="0"');
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});

describe("preview route", () => {
  function testEnv() {
    return {
      ...(env as object),
      TIMEZONE: "UTC", PRIVACY_TRIM_M: "250",
      REDIRECT_URI: "https://x/auth/callback",
      STRAVA_CLIENT_ID: "cid", STRAVA_CLIENT_SECRET: "sec",
      STRAVA_ATHLETE_ID: "1", SETUP_KEY: "s3cret",
    } as never;
  }
  const ctx = () => ({ waitUntil: () => {}, passThroughOnException: () => {} }) as unknown as ExecutionContext;

  it("renders the requested mood with a visible notice", async () => {
    const res = await worker.fetch(new Request("https://x/?preview=roy-kent"), testEnv(), ctx());
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Roy Kent");
    expect(html.toLowerCase()).toContain("preview");
  });

  it("ignores an unknown mood id rather than erroring", async () => {
    const res = await worker.fetch(new Request("https://x/?preview=not-a-mood"), testEnv(), ctx());
    expect(res.status).toBe(200);
    expect((await res.text()).toLowerCase()).not.toContain("not-a-mood");
  });
});

// Spec §8 requires render coverage of all ten moods, not just the one the
// engine happens to select today.
describe("every mood renders", () => {
  for (const mood of MOODS) {
    it(`renders ${mood.id} with its name, accent, and a quote`, () => {
      const s = snapshot(ROUTE);
      s.mood = { id: mood.id, name: mood.name, accent: mood.accent };
      s.quote = mood.quotes[0]!;
      const html = renderPage(view(s));

      // The raw markup legitimately escapes apostrophes (e.g. "Where'd You
      // Go" is emitted as "Where&#39;d You Go") — a browser renders that
      // identically to the un-escaped form, so asserting a literal substring
      // of the catalogue name against pre-parse markup is the wrong check.
      // Assert against what the renderer actually emits instead; this still
      // fails if a mood's name were rendered wrongly or omitted.
      expect(html).toContain(escapeHtml(mood.name));
      expect(html).toContain(`--ink-accent: ${mood.accent}`);
      expect(html).toContain(mood.quotes[0]!.character);
      expect(html).toContain("Powered by Strava");
      expect(html.toLowerCase()).not.toContain("undefined");
      expect(html.toLowerCase()).not.toContain("[object object]");
    });
  }

  it("renders every failure state without leaking undefined into the markup", () => {
    const states = [
      view(snapshot(ROUTE)),
      { ...view(snapshot(ROUTE)), snapshot: null },
      { ...view(snapshot(ROUTE)), health: { ...EMPTY_HEALTH, needsReauth: true } },
      { ...view(snapshot(ROUTE)), snapshot: snapshot(null) },
      { ...view(snapshot(ROUTE)), previewNotice: "Preview — not your live mood." },
      { ...view(snapshot(ROUTE)), nowMs: NOW + 30 * 3_600_000 },
    ];
    for (const state of states) {
      const html = renderPage(state);
      expect(html.toLowerCase()).not.toContain("undefined");
      expect(html).toContain("</html>");
    }
  });
});
