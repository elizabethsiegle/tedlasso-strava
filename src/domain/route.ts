import type { Activity } from "./activity";
import { buildBasemap, type BasemapRender } from "./basemap";
import { TUNING } from "./tuning";

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Google encoded polyline algorithm, precision 5. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    for (const axis of ["lat", "lng"] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === "lat") lat += delta;
      else lng += delta;
    }
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Drop points from both ends until each end is at least `trimM` from the
 * original endpoint. Measured as straight-line distance FROM THE ORIGINAL
 * ENDPOINT, not cumulative path length — an out-and-back route would otherwise
 * satisfy a cumulative check while still ending at the athlete's front door.
 */
export function privacyTrim(points: LatLng[], trimM: number): LatLng[] {
  if (trimM <= 0 || points.length === 0) return points;

  const first = points[0] as LatLng;
  let start = 0;
  while (start < points.length && haversineM(first, points[start] as LatLng) < trimM) {
    start++;
  }

  const last = points[points.length - 1] as LatLng;
  let end = points.length - 1;
  while (end >= start && haversineM(last, points[end] as LatLng) < trimM) {
    end--;
  }

  return points.slice(start, end + 1);
}

/**
 * Drop every point within `minM` of any reference point, wherever it occurs in
 * the route, and return the surviving runs as separate segments.
 *
 * End-trimming alone cannot protect a lap route that passes its own start
 * mid-activity — the athlete's home survives in the interior. This pass closes
 * that gap. Segments of fewer than 2 points are discarded: a single stranded
 * point is not drawable and is not worth publishing.
 */
export function splitAwayFrom(points: LatLng[], refs: LatLng[], minM: number): LatLng[][] {
  const segments: LatLng[][] = [];
  let current: LatLng[] = [];

  for (const p of points) {
    const isNearRef = refs.some((ref) => haversineM(p, ref) < minM);
    if (isNearRef) {
      if (current.length >= 2) segments.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length >= 2) segments.push(current);

  return segments;
}

export interface XY {
  x: number;
  y: number;
}

export interface RouteRender {
  pathD: string;
  viewBox: string;
  distanceM: number;
  elevationM: number;
  sportType: string;
  locationLabel: string | null;
  /**
   * When the activity this route came from started, epoch ms.
   *
   * The map is no longer guaranteed to be the newest activity (see the picker in
   * refresh.ts), so the caption has to be able to say when it was. Optional
   * because snapshots written before that change have no such field.
   */
  startedAt?: number;
  /**
   * Tile-aligned geometry for the same route, drawn over a real street map.
   * Optional, not required: snapshots written before the basemap existed have
   * no such field, and the renderer falls back to the bare `pathD` frame. Its
   * own `pathD` is in Web Mercator tile pixels and is NOT interchangeable with
   * the equirectangular one above.
   */
  basemap?: BasemapRender | null;
}

/** Perpendicular distance from `p` to the segment `a`–`b`, in degrees. */
function perpendicularDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return Math.hypot(p.lng - a.lng, p.lat - a.lat);
  const t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy);
  const clamped = Math.min(1, Math.max(0, t));
  return Math.hypot(p.lng - (a.lng + clamped * dx), p.lat - (a.lat + clamped * dy));
}

/** Ramer–Douglas–Peucker. Iterative, so a long route cannot blow the stack. */
export function simplify(points: LatLng[], epsilonDeg: number): LatLng[] {
  if (points.length <= 2) return points;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let maxDist = 0;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i] as LatLng, points[start] as LatLng, points[end] as LatLng);
      if (d > maxDist) {
        maxDist = d;
        maxIndex = i;
      }
    }
    if (maxIndex !== -1 && maxDist > epsilonDeg) {
      keep[maxIndex] = true;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Reduce to at most TUNING.MAX_ROUTE_POINTS by increasing epsilon until it fits. */
export function simplifyToCap(points: LatLng[]): LatLng[] {
  let epsilon = 0.00001;
  let out = simplify(points, epsilon);
  while (out.length > TUNING.MAX_ROUTE_POINTS && epsilon < 1) {
    epsilon *= 2;
    out = simplify(points, epsilon);
  }
  return out;
}

/**
 * Project the union of all points across every segment through one shared
 * bounding box and scale, then map each segment's points through that same
 * transform. Segments must share one coordinate system or they will not line
 * up with each other when rendered.
 */
export function project(points: LatLng[]): XY[] {
  if (points.length === 0) return [];
  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const scale = Math.cos((meanLat * Math.PI) / 180);
  // Negate latitude: SVG y grows downward, and north should be up.
  return points.map((p) => ({ x: p.lng * scale, y: -p.lat }));
}

/**
 * Emit one subpath per segment: an `M` command starts each segment, `L`
 * commands continue within it, all inside a single `d` string. All segments
 * share one bounding box and scale (computed over every point across every
 * segment), so they stay in a consistent coordinate system relative to each
 * other.
 */
export function toPath(segments: XY[][]): { pathD: string; viewBox: string } {
  const size = TUNING.ROUTE_VIEWBOX;
  const pad = TUNING.ROUTE_PADDING;
  const inner = size - pad * 2;

  const all = segments.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  // A single uniform scale for both axes keeps the route's real proportions.
  const scale = Math.min(spanX > 0 ? inner / spanX : Infinity, spanY > 0 ? inner / spanY : Infinity);
  const usable = Number.isFinite(scale) ? scale : 1;

  const offsetX = pad + (inner - spanX * usable) / 2;
  const offsetY = pad + (inner - spanY * usable) / 2;

  const round = (n: number): string => (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");

  const d = segments
    .map((segment) =>
      segment
        .map((p, i) => {
          const x = round(offsetX + (p.x - minX) * usable);
          const y = round(offsetY + (p.y - minY) * usable);
          return `${i === 0 ? "M" : "L"}${x} ${y}`;
        })
        .join(" "),
    )
    .join(" ");

  return { pathD: d, viewBox: `0 0 ${size} ${size}` };
}

/**
 * Decode, redact, simplify, and project a route into ready-to-render SVG path
 * data. The redaction is two passes: `privacyTrim` clips both ends, then
 * `splitAwayFrom` removes any remaining points within `trimM` of the
 * *original* (pre-trim) start or end — protecting a lap route that passes its
 * own start mid-activity, which end-trimming alone cannot catch. If no
 * segment survives, returns `null` so the caller can render the no-route
 * fallback.
 */
export function buildRoute(activity: Activity, trimM: number): RouteRender | null {
  if (!Number.isFinite(trimM) || trimM < 0) {
    throw new Error(`buildRoute: trimM must be a finite, non-negative number (got ${String(trimM)})`);
  }
  if (!activity.summaryPolyline) return null;

  const decoded = decodePolyline(activity.summaryPolyline);
  if (decoded.length === 0) return null;

  const originalFirst = decoded[0] as LatLng;
  const originalLast = decoded[decoded.length - 1] as LatLng;

  const trimmed = privacyTrim(decoded, trimM);
  if (trimmed.length < 2) return null;

  const segments =
    trimM === 0 ? [trimmed] : splitAwayFrom(trimmed, [originalFirst, originalLast], trimM);
  if (segments.length === 0) return null;

  const simplifiedSegments = segments.map((segment) => simplifyToCap(segment));
  const projectedAll = project(simplifiedSegments.flat());

  // Re-split the single projected list back into per-segment arrays, in the
  // same lengths as simplifiedSegments, so every segment is projected through
  // the one shared transform computed over the full union of points.
  const projectedSegments: XY[][] = [];
  let cursor = 0;
  for (const segment of simplifiedSegments) {
    projectedSegments.push(projectedAll.slice(cursor, cursor + segment.length));
    cursor += segment.length;
  }

  const { pathD, viewBox } = toPath(projectedSegments);

  return {
    pathD,
    viewBox,
    startedAt: activity.startedAt,
    // Built from the redacted segments, never the raw decode, so the write-path
    // privacy rule still holds: nothing untrimmed is persisted.
    basemap: buildBasemap(simplifiedSegments),
    distanceM: activity.distanceM,
    elevationM: activity.elevationM,
    sportType: activity.sportType,
    locationLabel: activity.locationLabel,
  };
}
