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
