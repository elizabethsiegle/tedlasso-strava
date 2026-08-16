import { describe, expect, it } from "vitest";
import { decodePolyline, haversineM, privacyTrim } from "../../src/domain/route";
import type { LatLng } from "../../src/domain/route";

describe("decodePolyline", () => {
  it("decodes the canonical example from Google's documentation", () => {
    // "_p~iF~ps|U_ulLnnqC_mqNvxq`@" -> (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(points).toHaveLength(3);
    expect(points[0]!.lat).toBeCloseTo(38.5, 5);
    expect(points[0]!.lng).toBeCloseTo(-120.2, 5);
    expect(points[1]!.lat).toBeCloseTo(40.7, 5);
    expect(points[1]!.lng).toBeCloseTo(-120.95, 5);
    expect(points[2]!.lat).toBeCloseTo(43.252, 5);
    expect(points[2]!.lng).toBeCloseTo(-126.453, 5);
  });

  it("returns an empty array for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("haversineM", () => {
  it("is zero for identical points", () => {
    expect(haversineM({ lat: 37.77, lng: -122.42 }, { lat: 37.77, lng: -122.42 })).toBe(0);
  });

  it("measures roughly 111km per degree of latitude", () => {
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("is symmetric", () => {
    const a = { lat: 37.77, lng: -122.42 };
    const b = { lat: 37.80, lng: -122.40 };
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
  });
});

/** A straight south-to-north line of `n` points spaced ~11.1m apart. */
function line(n: number): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({ lat: 37.7 + i * 0.0001, lng: -122.4 }));
}

const HOME: LatLng = { lat: 37.7, lng: -122.4 };

/**
 * Simulates a GPS lock acquired in the driveway: `clusterSize` points that
 * oscillate ~22m east/west of HOME (well inside a 50m radius), followed by a
 * straight run of `runSize` points heading north, each step ~11.1m.
 *
 * Every step here is real distance traveled, so a CUMULATIVE path-length trim
 * burns through a 250m budget by roughly the 12th oscillation — while every
 * one of those points is still standing within ~22m of HOME in a straight
 * line. A straight-line-from-endpoint trim will not release the start index
 * until a point is actually >=250m from HOME, which only happens well into
 * the straight run. This fixture is constructed specifically so a
 * cumulative-length implementation fails the assertion below — see the
 * "cumulative-length variant" experiment in the Task 8 report for the
 * measured failure.
 */
function clusterThenRun(clusterSize: number, runSize: number): LatLng[] {
  const cluster: LatLng[] = Array.from({ length: clusterSize }, (_, i) =>
    i % 2 === 0 ? { ...HOME } : { lat: HOME.lat, lng: HOME.lng + 0.00025 },
  );
  const run: LatLng[] = Array.from({ length: runSize }, (_, i) => ({
    lat: HOME.lat + (i + 1) * 0.0001,
    lng: HOME.lng,
  }));
  return [...cluster, ...run];
}

describe("privacyTrim", () => {
  it("removes at least trimM from the start", () => {
    const pts = line(200); // ~2.2km
    const trimmed = privacyTrim(pts, 250);
    expect(haversineM(pts[0]!, trimmed[0]!)).toBeGreaterThanOrEqual(250);
  });

  it("removes at least trimM from the end", () => {
    const pts = line(200);
    const trimmed = privacyTrim(pts, 250);
    expect(haversineM(pts[pts.length - 1]!, trimmed[trimmed.length - 1]!)).toBeGreaterThanOrEqual(250);
  });

  it("keeps the middle of a long route", () => {
    const pts = line(200);
    expect(privacyTrim(pts, 250).length).toBeGreaterThan(100);
  });

  // NOTE: this fixture has uniform ~11.1m spacing on both legs, so index
  // position is a linear proxy for BOTH straight-line distance from the
  // endpoint and cumulative path length walked. A cumulative-length trim
  // would land on the same indices here and pass this test too. This test
  // verifies coincident-endpoint handling (start == end physical location),
  // not the straight-line-vs-cumulative design choice — see
  // "does not release the trim while circling near home before heading out"
  // below for the fixture that actually discriminates the two designs.
  it("trims both ends of an out-and-back that starts and ends at the same point", () => {
    const out = line(100);
    const back = [...out].reverse().slice(1);
    const loop = [...out, ...back];
    const trimmed = privacyTrim(loop, 250);
    expect(trimmed.length).toBeGreaterThan(1);
    expect(haversineM(loop[0]!, trimmed[0]!)).toBeGreaterThanOrEqual(250);
    expect(haversineM(loop[loop.length - 1]!, trimmed[trimmed.length - 1]!)).toBeGreaterThanOrEqual(250);
  });

  it("does not release the trim while circling near home before heading out", () => {
    const pts = clusterThenRun(20, 60);
    const trimmed = privacyTrim(pts, 250);
    expect(trimmed.length).toBeGreaterThan(1);
    expect(haversineM(pts[0]!, trimmed[0]!)).toBeGreaterThanOrEqual(250);
  });

  it("returns fewer than two points when the route is shorter than twice the trim", () => {
    expect(privacyTrim(line(20), 250).length).toBeLessThan(2); // ~220m total
  });

  it("returns an empty array for an empty input", () => {
    expect(privacyTrim([], 250)).toEqual([]);
  });

  it("passes the route through untouched when trimM is 0", () => {
    const pts = line(50);
    expect(privacyTrim(pts, 0)).toEqual(pts);
  });
});
