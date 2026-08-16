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

  it("trims both ends of an out-and-back that starts and ends at the same point", () => {
    const out = line(100);
    const back = [...out].reverse().slice(1);
    const loop = [...out, ...back];
    const trimmed = privacyTrim(loop, 250);
    expect(trimmed.length).toBeGreaterThan(1);
    expect(haversineM(loop[0]!, trimmed[0]!)).toBeGreaterThanOrEqual(250);
    expect(haversineM(loop[loop.length - 1]!, trimmed[trimmed.length - 1]!)).toBeGreaterThanOrEqual(250);
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
