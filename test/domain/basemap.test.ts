import { describe, expect, it } from "vitest";
import {
  buildBasemap,
  fitZoom,
  latFromYFraction,
  mercatorXFraction,
  mercatorYFraction,
  scaleBar,
} from "../../src/domain/basemap";
import { haversineM, type LatLng } from "../../src/domain/route";
import { TUNING } from "../../src/domain/tuning";

const W = TUNING.BASEMAP_WIDTH;
const H = TUNING.BASEMAP_HEIGHT;
const TILE_PX = 256;

/** A ~1.5km loop in San Francisco's Mission, the kind of route this actually renders. */
const MISSION_LOOP: LatLng[] = [
  { lat: 37.7599, lng: -122.4148 },
  { lat: 37.7644, lng: -122.4148 },
  { lat: 37.7644, lng: -122.4089 },
  { lat: 37.7599, lng: -122.4089 },
  { lat: 37.7599, lng: -122.4148 },
];

function pathPoints(pathD: string): { x: number; y: number }[] {
  return [...pathD.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

describe("mercator projection", () => {
  it("puts the prime meridian and the equator at the centre of the world", () => {
    expect(mercatorXFraction(0)).toBeCloseTo(0.5, 12);
    expect(mercatorYFraction(0)).toBeCloseTo(0.5, 12);
  });

  it("puts the antimeridian at both edges", () => {
    expect(mercatorXFraction(-180)).toBeCloseTo(0, 12);
    expect(mercatorXFraction(180)).toBeCloseTo(1, 12);
  });

  it("grows y southward", () => {
    expect(mercatorYFraction(60)).toBeLessThan(mercatorYFraction(0));
    expect(mercatorYFraction(-60)).toBeGreaterThan(mercatorYFraction(0));
  });

  it("clamps at the mercator limit instead of diverging at the poles", () => {
    // Un-clamped, log((1+sin)/(1-sin)) at lat 90 is Infinity, which would
    // poison every downstream pixel.
    expect(Number.isFinite(mercatorYFraction(90))).toBe(true);
    expect(Number.isFinite(mercatorYFraction(-90))).toBe(true);
    expect(mercatorYFraction(90)).toBeCloseTo(mercatorYFraction(85.05112878), 9);
  });

  it("round-trips through latFromYFraction", () => {
    for (const lat of [-70, -37.8, 0, 12.5, 51.5, 80]) {
      expect(latFromYFraction(mercatorYFraction(lat))).toBeCloseTo(lat, 9);
    }
  });
});

describe("fitZoom", () => {
  it("chooses a zoom whose pixel span still fits the padded frame", () => {
    const fractionX = 0.0004;
    const z = fitZoom(fractionX, 0.0002, W, H, TUNING.BASEMAP_PADDING);
    const spanPx = fractionX * TILE_PX * 2 ** z;
    expect(spanPx).toBeLessThanOrEqual(W - TUNING.BASEMAP_PADDING * 2);
    // ...and it is the largest such zoom: one step in would overflow.
    expect(spanPx * 2).toBeGreaterThan(W - TUNING.BASEMAP_PADDING * 2);
  });

  it("is driven by whichever axis is tighter", () => {
    const wide = fitZoom(0.01, 0.0001, W, H, TUNING.BASEMAP_PADDING);
    const tall = fitZoom(0.0001, 0.01, W, H, TUNING.BASEMAP_PADDING);
    expect(wide).toBeLessThan(fitZoom(0.0001, 0.0001, W, H, TUNING.BASEMAP_PADDING));
    expect(tall).toBeLessThan(fitZoom(0.0001, 0.0001, W, H, TUNING.BASEMAP_PADDING));
  });

  it("clamps to the maximum zoom for a route with no extent at all", () => {
    expect(fitZoom(0, 0, W, H, TUNING.BASEMAP_PADDING)).toBe(TUNING.BASEMAP_MAX_ZOOM);
  });

  it("clamps to the minimum zoom rather than asking for a tile that cannot exist", () => {
    expect(fitZoom(0.9, 0.9, W, H, TUNING.BASEMAP_PADDING)).toBe(TUNING.BASEMAP_MIN_ZOOM);
  });

  it("survives padding wider than the frame", () => {
    const z = fitZoom(0.001, 0.001, 100, 100, 500);
    expect(z).toBeGreaterThanOrEqual(TUNING.BASEMAP_MIN_ZOOM);
    expect(z).toBeLessThanOrEqual(TUNING.BASEMAP_MAX_ZOOM);
  });
});

describe("scaleBar", () => {
  it("labels a round distance, not the frame's arbitrary width", () => {
    expect(scaleBar(14, 37.76, W).label).toMatch(/^(50|100|200|500) m$|^(1|2|5) km$/);
  });

  it("switches to kilometres above 1000 metres", () => {
    expect(scaleBar(9, 37.76, W).label).toMatch(/km$/);
    expect(scaleBar(16, 37.76, W).label).toMatch(/ m$/);
  });

  it("never takes more than a third of the frame", () => {
    for (const z of [3, 8, 12, 16]) {
      expect(scaleBar(z, 37.76, W).width).toBeLessThanOrEqual(30);
      expect(scaleBar(z, 37.76, W).width).toBeGreaterThan(0);
    }
  });

  it("accounts for latitude: the same zoom covers less ground near the poles", () => {
    const equator = scaleBar(12, 0, W);
    const arctic = scaleBar(12, 70, W);
    // A fixed bar length near the pole spans fewer metres, so the chosen round
    // step is smaller or the bar is shorter. Either way they must differ.
    expect(`${arctic.label}/${arctic.width}`).not.toBe(`${equator.label}/${equator.width}`);
  });
});

describe("buildBasemap", () => {
  it("returns null when there is nothing drawable", () => {
    expect(buildBasemap([])).toBeNull();
    expect(buildBasemap([[{ lat: 37.76, lng: -122.41 }]])).toBeNull();
  });

  it("tiles the whole frame, with no gap at any edge", () => {
    const b = buildBasemap([MISSION_LOOP])!;
    const lefts = b.tiles.map((t) => t.left);
    const tops = b.tiles.map((t) => t.top);
    expect(Math.min(...lefts)).toBeLessThanOrEqual(0);
    expect(Math.max(...lefts) + b.tiles[0]!.width).toBeGreaterThanOrEqual(100);
    expect(Math.min(...tops)).toBeLessThanOrEqual(0);
    expect(Math.max(...tops) + b.tiles[0]!.height).toBeGreaterThanOrEqual(100);
  });

  it("asks only for tiles that exist at the chosen zoom", () => {
    const b = buildBasemap([MISSION_LOOP])!;
    const perAxis = 2 ** b.zoom;
    for (const t of b.tiles) {
      expect(t.z).toBe(b.zoom);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(perAxis);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(perAxis);
      expect(Number.isInteger(t.x) && Number.isInteger(t.y)).toBe(true);
    }
  });

  it("keeps the whole route inside the frame", () => {
    const points = pathPoints(buildBasemap([MISSION_LOOP])!.pathD);
    expect(points).toHaveLength(MISSION_LOOP.length);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(H);
    }
  });

  /**
   * The whole point of this module: the line and the tiles must share one
   * coordinate system. Recover the frame's world-pixel origin from an emitted
   * tile, project the first route point independently, and the two must agree.
   * If they drift, the route draws over the wrong streets.
   */
  it("puts the line in the same pixel space as the tiles it sits on", () => {
    const b = buildBasemap([MISSION_LOOP])!;
    const world = TILE_PX * 2 ** b.zoom;
    const anchor = b.tiles[0]!;
    const originX = anchor.x * TILE_PX - (anchor.left / 100) * b.width;
    const originY = anchor.y * TILE_PX - (anchor.top / 100) * b.height;

    const first = MISSION_LOOP[0]!;
    const expectedX = mercatorXFraction(first.lng) * world - originX;
    const expectedY = mercatorYFraction(first.lat) * world - originY;

    const drawn = pathPoints(b.pathD)[0]!;
    expect(drawn.x).toBeCloseTo(expectedX, 1);
    expect(drawn.y).toBeCloseTo(expectedY, 1);
  });

  /**
   * The scale bar is the one thing on the frame a reader could measure against,
   * so it has to agree with the ground truth: compare it to the real distance
   * between two route points and the pixels between them.
   */
  it("prints a scale bar that matches the ground distance the frame covers", () => {
    const b = buildBasemap([MISSION_LOOP])!;
    const [a, c] = pathPoints(b.pathD);
    const pixelGap = Math.hypot(c!.x - a!.x, c!.y - a!.y);
    const groundGap = haversineM(MISSION_LOOP[0]!, MISSION_LOOP[1]!);

    const barMetres = Number(b.scale.label.replace(/[^\d.]/g, "")) * (b.scale.label.endsWith("km") ? 1000 : 1);
    const barPixels = (b.scale.width / 100) * b.width;

    expect(barMetres / barPixels).toBeCloseTo(groundGap / pixelGap, 1);
  });

  it("centres the route in the frame", () => {
    const points = pathPoints(buildBasemap([MISSION_LOOP])!.pathD);
    const midX = (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2;
    const midY = (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2;
    expect(midX).toBeCloseTo(W / 2, 0);
    expect(midY).toBeCloseTo(H / 2, 0);
  });

  it("starts a fresh subpath per segment, so a redacted gap is not bridged", () => {
    const b = buildBasemap([
      MISSION_LOOP.slice(0, 2),
      MISSION_LOOP.slice(2, 4),
    ])!;
    expect(b.pathD.match(/M/g)).toHaveLength(2);
  });

  it("drops a stranded single-point segment rather than emitting a bare M", () => {
    const b = buildBasemap([MISSION_LOOP.slice(0, 3), [{ lat: 37.762, lng: -122.412 }]])!;
    expect(b.pathD.match(/M/g)).toHaveLength(1);
    expect(b.pathD.endsWith("M")).toBe(false);
  });

  it("returns null when a coordinate is not a real number", () => {
    expect(buildBasemap([[{ lat: Number.NaN, lng: -122.41 }, { lat: 37.76, lng: -122.41 }]])).toBeNull();
    expect(buildBasemap([[{ lat: 37.76, lng: Number.POSITIVE_INFINITY }, { lat: 37.76, lng: -122.41 }]])).toBeNull();
  });

  it("returns null when every segment is a stranded single point", () => {
    // Two points in total, so the point count passes, but neither segment is
    // drawable and an empty `d` attribute is not a route.
    expect(buildBasemap([[{ lat: 37.76, lng: -122.41 }], [{ lat: 37.77, lng: -122.42 }]])).toBeNull();
  });

  it("wraps longitude at the antimeridian instead of asking for a negative tile", () => {
    const b = buildBasemap([
      [
        { lat: -16.9, lng: 179.98 },
        { lat: -16.89, lng: 179.995 },
      ],
    ])!;
    const perAxis = 2 ** b.zoom;
    for (const t of b.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(perAxis);
    }
  });

  // A wide route hard against a pole is the only shape whose frame actually
  // extends past the top or bottom of the tile grid: the zoom clamps out, and
  // the frame then reaches for rows that do not exist. The newsprint shows
  // through there instead.
  it("skips rows past the north pole rather than requesting one that cannot exist", () => {
    const b = buildBasemap([
      [
        { lat: 84.2, lng: -170 },
        { lat: 85.0, lng: 170 },
      ],
    ])!;
    const perAxis = 2 ** b.zoom;
    expect(b.tiles.length).toBeGreaterThan(0);
    // The skipped row leaves the top of the frame as bare stock: the first
    // tile that does exist starts below the frame's own top edge.
    expect(Math.min(...b.tiles.map((t) => t.top))).toBeGreaterThan(0);
    for (const t of b.tiles) {
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(perAxis);
    }
  });

  it("skips rows past the south pole too", () => {
    const b = buildBasemap([
      [
        { lat: -85.0, lng: -170 },
        { lat: -84.2, lng: 170 },
      ],
    ])!;
    const perAxis = 2 ** b.zoom;
    expect(Math.max(...b.tiles.map((t) => t.top + t.height))).toBeLessThan(100);
    for (const t of b.tiles) {
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(perAxis);
    }
  });

  it("zooms in tight on a short route and out on a long one", () => {
    const short = buildBasemap([MISSION_LOOP])!;
    const long = buildBasemap([
      [
        { lat: 37.76, lng: -122.42 },
        { lat: 38.58, lng: -121.49 },
      ],
    ])!;
    expect(short.zoom).toBeGreaterThan(long.zoom);
  });

  it("still produces a frame for a route that cannot fit even at the minimum zoom", () => {
    const b = buildBasemap([
      [
        { lat: -33.87, lng: 151.2 },
        { lat: 51.5, lng: -0.12 },
      ],
    ])!;
    expect(b.zoom).toBe(TUNING.BASEMAP_MIN_ZOOM);
    expect(b.tiles.length).toBeGreaterThan(0);
    expect(b.pathD).toMatch(/^M/);
  });

  it("reports the frame it was laid out in, so the renderer's viewBox cannot drift", () => {
    const b = buildBasemap([MISSION_LOOP])!;
    expect(b.width).toBe(TUNING.BASEMAP_WIDTH);
    expect(b.height).toBe(TUNING.BASEMAP_HEIGHT);
  });
});
