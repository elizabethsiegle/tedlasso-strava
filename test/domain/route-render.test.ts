import { describe, expect, it } from "vitest";
import {
  buildRoute,
  haversineM,
  privacyTrim,
  project,
  simplify,
  simplifyToCap,
  splitAwayFrom,
  toPath,
} from "../../src/domain/route";
import type { LatLng, XY } from "../../src/domain/route";
import { makeActivity } from "../fixtures/activities";

const REAL_POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

function line(n: number, step = 0.0001): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({ lat: 37.7 + i * step, lng: -122.4 }));
}

/**
 * Standard Google-polyline encoder (precision 5), inverse of the domain's
 * `decodePolyline`. Test-only: lets fixtures describe a route as lat/lng
 * points and hand `buildRoute` a realistic encoded polyline, instead of
 * hand-writing encoded strings.
 */
function encodeSignedNumber(num: number): string {
  let sgnNum = num << 1;
  if (num < 0) sgnNum = ~sgnNum;
  let output = "";
  let value = sgnNum;
  while (value >= 0x20) {
    output += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
    value >>= 5;
  }
  output += String.fromCharCode(value + 63);
  return output;
}

function encodePolyline(points: LatLng[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let output = "";
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    output += encodeSignedNumber(lat - lastLat);
    output += encodeSignedNumber(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return output;
}

const HOME: LatLng = { lat: 37.7, lng: -122.4 };
const TRIM_M = 250;

/** One leg out from HOME and back, ~11.1m per step, stopping just short of HOME on the return. */
function outAndBack(legLen: number, stepDeg = 0.0001): LatLng[] {
  const out: LatLng[] = Array.from({ length: legLen }, (_, i) => ({
    lat: HOME.lat + (i + 1) * stepDeg,
    lng: HOME.lng,
  }));
  const back = [...out].slice(0, -1).reverse();
  return [...out, ...back];
}

/**
 * Two laps from the front door: HOME -> out-and-back -> HOME -> out-and-back
 * -> HOME. The middle HOME (and the points around it) sit deep in the
 * interior of the point list, which end-trimming alone never reaches.
 */
function lapRoute(legLen = 40): LatLng[] {
  return [{ ...HOME }, ...outAndBack(legLen), { ...HOME }, ...outAndBack(legLen), { ...HOME }];
}

describe("simplify", () => {
  it("collapses collinear points", () => {
    expect(simplify(line(50), 0.00001).length).toBeLessThan(50);
  });

  it("keeps the first and last points", () => {
    const pts = line(50);
    const out = simplify(pts, 0.00001);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("returns short inputs unchanged", () => {
    const pts = line(2);
    expect(simplify(pts, 0.001)).toEqual(pts);
  });

  it("preserves a genuine corner", () => {
    const corner: LatLng[] = [
      { lat: 37.70, lng: -122.40 },
      { lat: 37.75, lng: -122.40 },
      { lat: 37.75, lng: -122.35 },
    ];
    expect(simplify(corner, 0.0001)).toHaveLength(3);
  });
});

describe("project", () => {
  it("scales longitude by cos(latitude) so high-latitude routes are not stretched", () => {
    // One degree of longitude at 60N covers about half the ground distance of
    // one degree of latitude, so x must span about half of y.
    const square: LatLng[] = [
      { lat: 60.0, lng: 0.0 },
      { lat: 61.0, lng: 0.0 },
      { lat: 61.0, lng: 1.0 },
    ];
    const xy = project(square);
    const spanX = Math.max(...xy.map((p) => p.x)) - Math.min(...xy.map((p) => p.x));
    const spanY = Math.max(...xy.map((p) => p.y)) - Math.min(...xy.map((p) => p.y));
    expect(spanX / spanY).toBeCloseTo(0.5, 1);
  });

  it("flips the y axis so north is up in SVG coordinates", () => {
    const xy = project([{ lat: 37.7, lng: -122.4 }, { lat: 37.8, lng: -122.4 }]);
    expect(xy[1]!.y).toBeLessThan(xy[0]!.y); // the northern point has the smaller y
  });

  it("returns an empty array for an empty input", () => {
    expect(project([])).toEqual([]);
  });
});

describe("splitAwayFrom", () => {
  it("drops points near any ref and keeps the rest as one segment", () => {
    const pts = line(10);
    const segments = splitAwayFrom(pts, [pts[0] as LatLng], 5); // 5m: only pts[0] itself is "near"
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual(pts.slice(1));
  });

  it("discards segments shorter than 2 points", () => {
    // A single point stranded between two near-ref regions is not drawable.
    const pts: LatLng[] = [
      { ...HOME },
      { lat: HOME.lat + 0.01, lng: HOME.lng }, // ~1.1km away, alone
      { ...HOME },
    ];
    const segments = splitAwayFrom(pts, [HOME], TRIM_M);
    expect(segments).toEqual([]);
  });

  it("splits a lap route that passes its own start mid-activity into multiple segments, none of which come near start or end", () => {
    const decoded = lapRoute();
    const originalFirst = decoded[0] as LatLng;
    const originalLast = decoded[decoded.length - 1] as LatLng;

    const segments = splitAwayFrom(decoded, [originalFirst, originalLast], TRIM_M);

    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      for (const p of segment) {
        expect(haversineM(p, originalFirst)).toBeGreaterThanOrEqual(TRIM_M);
        expect(haversineM(p, originalLast)).toBeGreaterThanOrEqual(TRIM_M);
      }
    }
  });
});

describe("toPath", () => {
  it("emits a moveto followed by linetos", () => {
    const { pathD } = toPath([project(line(5))]);
    expect(pathD.startsWith("M")).toBe(true);
    expect((pathD.match(/L/g) ?? []).length).toBe(4);
  });

  it("emits a viewBox containing only finite numbers", () => {
    const { viewBox } = toPath([project(line(5))]);
    const parts = viewBox.split(" ").map(Number);
    expect(parts).toHaveLength(4);
    for (const n of parts) expect(Number.isFinite(n)).toBe(true);
  });

  it("rounds coordinates so the path stays small", () => {
    const { pathD } = toPath([project(line(5))]);
    expect(pathD).not.toMatch(/\d\.\d{3}/); // at most two decimal places
  });

  it("emits exactly one M command per segment", () => {
    // Two far-apart clusters, projected together (as buildRoute does) and
    // then handed to toPath as separate segments.
    const clusterA = line(3);
    const clusterB = line(3, 0.0001).map((p) => ({ lat: p.lat + 5, lng: p.lng + 5 }));
    const combined = project([...clusterA, ...clusterB]);
    const segA = combined.slice(0, clusterA.length);
    const segB = combined.slice(clusterA.length);

    const { pathD } = toPath([segA, segB]);
    expect((pathD.match(/M/g) ?? []).length).toBe(2);
  });

  it("shares one bounding box across all segments so they land in distinct places, not the same origin", () => {
    // If each segment were projected/scaled independently, both would collapse
    // to identical local coordinates. Projecting the union first (as
    // buildRoute does) keeps them apart and inside the shared viewBox.
    const clusterA: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }];
    const clusterB: LatLng[] = [{ lat: 10, lng: 10 }, { lat: 10, lng: 11 }];
    const combined = project([...clusterA, ...clusterB]);
    const segA = combined.slice(0, clusterA.length);
    const segB = combined.slice(clusterA.length);

    const { pathD, viewBox } = toPath([segA, segB]);
    const [, , w, h] = viewBox.split(" ").map(Number) as [number, number, number, number];

    const coordPairs = (pathD.match(/[ML][-\d.]+ [-\d.]+/g) ?? []).map((cmd) => {
      const [x, y] = cmd.slice(1).split(" ").map(Number);
      return { x: x as number, y: y as number };
    });
    expect(coordPairs).toHaveLength(4);
    for (const { x, y } of coordPairs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(h);
    }

    const firstOfA = coordPairs[0] as XY;
    const firstOfB = coordPairs[2] as XY; // segB's M command starts at index 2
    expect(firstOfA).not.toEqual(firstOfB);
  });

  it("falls back to a finite scale when every point is identical (zero span on both axes)", () => {
    const { pathD, viewBox } = toPath([[{ x: 5, y: 5 }]]);
    expect(pathD.startsWith("M")).toBe(true);
    const parts = viewBox.split(" ").map(Number);
    for (const n of [...parts, ...pathD.match(/-?\d+(\.\d+)?/g)!.map(Number)]) {
      expect(Number.isFinite(n)).toBe(true);
    }
  });
});

describe("buildRoute", () => {
  it("returns null when the activity has no polyline", () => {
    expect(buildRoute(makeActivity({ summaryPolyline: null }), 250)).toBeNull();
  });

  it("returns null when the trim consumes the whole route", () => {
    // The canonical polyline spans hundreds of km, so trim by more than that.
    expect(buildRoute(makeActivity({ summaryPolyline: REAL_POLYLINE }), 10_000_000)).toBeNull();
  });

  it("builds a path from a real polyline", () => {
    const route = buildRoute(
      makeActivity({ summaryPolyline: REAL_POLYLINE, distanceM: 8000, elevationM: 120, sportType: "Ride" }),
      0,
    );
    expect(route).not.toBeNull();
    expect(route!.pathD.startsWith("M")).toBe(true);
    expect(route!.distanceM).toBe(8000);
    expect(route!.elevationM).toBe(120);
    expect(route!.sportType).toBe("Ride");
    expect(route!.locationLabel).toBeNull();
  });

  it("carries a location label through when Strava supplied one", () => {
    const route = buildRoute(
      makeActivity({ summaryPolyline: REAL_POLYLINE, locationLabel: "San Francisco" }),
      0,
    );
    expect(route!.locationLabel).toBe("San Francisco");
  });

  it("never exceeds the point cap, however dense the input", () => {
    // 5,000 wiggly points must come out under MAX_ROUTE_POINTS (300).
    const dense: LatLng[] = Array.from({ length: 5000 }, (_, i) => ({
      lat: 37.7 + i * 0.00002,
      lng: -122.4 + Math.sin(i / 40) * 0.01,
    }));
    const { pathD } = toPath([project(simplifyToCap(dense))]);
    const commands = (pathD.match(/[ML]/g) ?? []).length;
    expect(commands).toBeGreaterThan(2);
    expect(commands).toBeLessThanOrEqual(300);
  });

  it("throws on a NaN trim value", () => {
    expect(() => buildRoute(makeActivity({ summaryPolyline: REAL_POLYLINE }), NaN)).toThrow();
  });

  it("throws on an undefined trim value", () => {
    expect(() =>
      buildRoute(makeActivity({ summaryPolyline: REAL_POLYLINE }), undefined as unknown as number),
    ).toThrow();
  });

  it("throws on a negative trim value", () => {
    expect(() => buildRoute(makeActivity({ summaryPolyline: REAL_POLYLINE }), -1)).toThrow();
  });

  it("splits a lap route that passes its own start mid-activity into multiple rendered segments", () => {
    const decoded = lapRoute();
    const polyline = encodePolyline(decoded);
    const originalFirst = decoded[0] as LatLng;
    const originalLast = decoded[decoded.length - 1] as LatLng;
    // These are the exact LatLng segments buildRoute itself computes and then
    // feeds to simplifyToCap/project/toPath -- a direct positional check on
    // them (not just a count) confirms no point buildRoute renders is close
    // to the athlete's real start or end, not merely that segmentation
    // happened at all.
    const expectedSegments = splitAwayFrom(decoded, [originalFirst, originalLast], TRIM_M);
    expect(expectedSegments.length).toBeGreaterThan(1);
    for (const segment of expectedSegments) {
      for (const p of segment) {
        expect(haversineM(p, originalFirst)).toBeGreaterThanOrEqual(TRIM_M);
        expect(haversineM(p, originalLast)).toBeGreaterThanOrEqual(TRIM_M);
      }
    }

    const route = buildRoute(makeActivity({ summaryPolyline: polyline }), TRIM_M);
    expect(route).not.toBeNull();
    const mCount = (route!.pathD.match(/M/g) ?? []).length;
    expect(mCount).toBe(expectedSegments.length);
  });

  describe("projects all segments through one shared transform", () => {
    /** Split pathD into per-segment [x,y] point lists -- one array per "M...L...L..." chunk. */
    function parseSegments(pathD: string): XY[][] {
      return (pathD.match(/M[^M]*/g) ?? []).map((chunk) => {
        const nums = (chunk.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
        const pts: XY[] = [];
        for (let i = 0; i < nums.length; i += 2) pts.push({ x: nums[i] as number, y: nums[i + 1] as number });
        return pts;
      });
    }

    it("keeps two widely separated, differently-latituded clusters in a mutually consistent coordinate system", () => {
      // clusterA sits near the equator; clusterB sits near 60N, with an
      // IDENTICAL real-world lng span (0.3 deg) to clusterA. cos(60 deg) is
      // 0.5, so if buildRoute projected each segment independently (its own
      // meanLat, its own scale), clusterB's own longitude scale would shrink
      // its on-screen span to roughly half of clusterA's -- even though
      // toPath's later uniform scale-and-offset step is identical for both,
      // since it operates on whatever XY values it was handed and cannot
      // undo an already-baked-in per-segment distortion. Projecting the
      // union once (as buildRoute does) gives both clusters the same
      // longitude scale, so their on-screen spans come out equal.
      const REF: LatLng = { lat: 30, lng: 25 }; // far from both clusters; doubles as start and end
      const clusterA: LatLng[] = [
        { lat: 0.1, lng: 0.1 },
        { lat: 0.4, lng: 0.1 },
        { lat: 0.4, lng: 0.4 },
        { lat: 0.1, lng: 0.4 },
      ];
      const clusterB: LatLng[] = [
        { lat: 60.1, lng: 50.1 },
        { lat: 60.4, lng: 50.1 },
        { lat: 60.4, lng: 50.4 },
        { lat: 60.1, lng: 50.4 },
      ];
      const decoded: LatLng[] = [
        REF, REF, REF,
        ...clusterA,
        REF, REF, REF, REF, REF,
        ...clusterB,
        REF, REF, REF,
      ];

      const route = buildRoute(makeActivity({ summaryPolyline: encodePolyline(decoded) }), TRIM_M);
      expect(route).not.toBeNull();

      const segments = parseSegments(route!.pathD);
      expect(segments).toHaveLength(2);

      const xSpan = (seg: XY[]): number => Math.max(...seg.map((p) => p.x)) - Math.min(...seg.map((p) => p.x));
      const spanA = xSpan(segments[0] as XY[]);
      const spanB = xSpan(segments[1] as XY[]);

      // Same real lng span, same shared scale -> spans should be close.
      // Independent per-segment projection would put this ratio near 0.5.
      expect(spanB / spanA).toBeGreaterThan(0.7);
      expect(spanB / spanA).toBeLessThan(1.3);

      // Not collapsed to the same local origin, and the relative offset
      // preserves real-world separation: clusterB sits east of clusterA.
      expect(segments[0]![0]).not.toEqual(segments[1]![0]);
      const maxXOfA = Math.max(...(segments[0] as XY[]).map((p) => p.x));
      const minXOfB = Math.min(...(segments[1] as XY[]).map((p) => p.x));
      expect(minXOfB).toBeGreaterThan(maxXOfA);
    });
  });

  it("returns null when every point besides two isolated survivors sits near one of the two reference locations", () => {
    // Two distant "homes" A and B (~111km apart). A short lead-in near A gets
    // end-trimmed, then a lone point X survives (far from both A and B), then
    // an interior run sitting exactly on A, then an interior run sitting
    // exactly on B (both dropped by splitAwayFrom as "near a ref"), then a
    // lone survivor Y (far from both), then a trailing run near B that gets
    // end-trimmed. X and Y each end up alone (run length 1) and get discarded,
    // so no segment survives.
    const A: LatLng = { lat: 0, lng: 0 };
    const B: LatLng = { lat: 0, lng: 1 };
    const X: LatLng = { lat: 0.01, lng: 0 };
    const Y: LatLng = { lat: 0.01, lng: 1 };
    const decoded: LatLng[] = [
      A, A, A,
      X,
      A, A, A, A, A,
      B, B, B, B, B,
      Y,
      B, B, B,
      B,
    ];
    expect(splitAwayFrom(privacyTrim(decoded, TRIM_M), [A, B], TRIM_M)).toEqual([]);

    const route = buildRoute(makeActivity({ summaryPolyline: encodePolyline(decoded) }), TRIM_M);
    expect(route).toBeNull();
  });

  it("skips the redaction pass and yields a single segment when trimM is 0, even for a route that would otherwise split", () => {
    const decoded = lapRoute();
    const polyline = encodePolyline(decoded);

    // Confirm this route really would split at a positive trim, so the
    // trimM=0 case below is a genuine opt-out, not a fixture that never split.
    const originalFirst = decoded[0] as LatLng;
    const originalLast = decoded[decoded.length - 1] as LatLng;
    expect(splitAwayFrom(decoded, [originalFirst, originalLast], TRIM_M).length).toBeGreaterThan(1);

    const route = buildRoute(makeActivity({ summaryPolyline: polyline }), 0);
    expect(route).not.toBeNull();
    const mCount = (route!.pathD.match(/M/g) ?? []).length;
    expect(mCount).toBe(1);
  });
});
