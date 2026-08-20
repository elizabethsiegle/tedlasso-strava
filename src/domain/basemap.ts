import type { LatLng } from "./route";
import { TUNING } from "./tuning";

/**
 * Web Mercator tile arithmetic for the basemap that sits under the route line.
 *
 * The route path in `route.ts` is projected equirectangular and normalised into
 * an abstract 1000x1000 box, which is fine for a shape on paper but cannot line
 * up with map tiles. Tiles are Web Mercator, so the basemap gets its own
 * projection and its own copy of the path, computed in the same pixel space as
 * the tiles it sits on. Both live in the snapshot; the renderer picks one.
 *
 * Pure, no I/O: the tile URLs are same-origin paths served by our own proxy
 * (`src/app/tiles.ts`), so this module never needs to know the upstream host.
 */

const TILE_PX = 256;
/** Mercator diverges at the poles; every real tile scheme clamps here. */
const MAX_MERCATOR_LAT = 85.05112878;
/** Ground resolution at the equator, zoom 0, 256px tiles. */
const EQUATOR_M_PER_PX = 156_543.033_928;

export interface BasemapTile {
  z: number;
  x: number;
  y: number;
  /** Position and size as percentages of the frame, so the layer scales fluidly. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BasemapScale {
  /** e.g. "500 m" or "2 km": a round number, not whatever the frame happens to be. */
  label: string;
  /** Bar length as a percentage of the frame width. */
  width: number;
}

/** A point in the same tile-pixel space as `BasemapRender.tiles`. */
export interface BasemapPoint {
  x: number;
  y: number;
}

export interface BasemapRender {
  zoom: number;
  /** The frame's reference pixel size; also the overlay SVG's viewBox. */
  width: number;
  height: number;
  tiles: BasemapTile[];
  /** The route, in the same pixel space as `tiles`. Not interchangeable with RouteRender.pathD. */
  pathD: string;
  /**
   * The first and last points of the *published* line, so the figure can show
   * which way round it was ridden. These are ends of the already-trimmed
   * geometry, not the real ones: marking them reveals nothing the path itself
   * does not already draw.
   */
  start?: BasemapPoint;
  end?: BasemapPoint;
  scale: BasemapScale;
}

function clampLat(lat: number): number {
  return Math.min(MAX_MERCATOR_LAT, Math.max(-MAX_MERCATOR_LAT, lat));
}

/** Fraction of the world, 0 at 180°W, 1 at 180°E. */
export function mercatorXFraction(lng: number): number {
  return (lng + 180) / 360;
}

/** Fraction of the world, 0 at the north edge, 1 at the south edge. */
export function mercatorYFraction(lat: number): number {
  const sin = Math.sin((clampLat(lat) * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

/**
 * The largest zoom at which the route still fits inside the padded frame.
 * Solved rather than looped: each zoom step doubles the world, so the fit
 * condition is a single inequality in 2^z.
 */
export function fitZoom(fractionX: number, fractionY: number, width: number, height: number, padding: number): number {
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const limitX = fractionX > 0 ? innerW / (fractionX * TILE_PX) : Infinity;
  const limitY = fractionY > 0 ? innerH / (fractionY * TILE_PX) : Infinity;
  const limit = Math.min(limitX, limitY);
  // A single point (both spans zero) has no scale to fit, so take the closest
  // zoom we allow rather than dividing by zero into Infinity.
  const zoom = Number.isFinite(limit) ? Math.floor(Math.log2(limit)) : TUNING.BASEMAP_MAX_ZOOM;
  return Math.min(TUNING.BASEMAP_MAX_ZOOM, Math.max(TUNING.BASEMAP_MIN_ZOOM, zoom));
}

const SCALE_STEPS_M = [50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000];

/**
 * A scale bar keeps the frame honest: without one, a 400m loop and a 40km ride
 * look identical once both are fitted to the same box.
 */
export function scaleBar(zoom: number, centreLat: number, frameWidth: number): BasemapScale {
  const mPerPx = (EQUATOR_M_PER_PX * Math.cos((clampLat(centreLat) * Math.PI) / 180)) / 2 ** zoom;
  const targetPx = frameWidth * 0.18;
  const maxPx = frameWidth * 0.3;

  let chosen = SCALE_STEPS_M[0] as number;
  let bestGap = Infinity;
  for (const step of SCALE_STEPS_M) {
    const px = step / mPerPx;
    if (px > maxPx) continue;
    const gap = Math.abs(px - targetPx);
    if (gap < bestGap) {
      bestGap = gap;
      chosen = step;
    }
  }

  const px = chosen / mPerPx;
  return {
    label: chosen >= 1000 ? `${chosen / 1000} km` : `${chosen} m`,
    // Clamped so a route below the smallest step still draws a sane bar.
    width: round(Math.min(maxPx, px) / frameWidth * 100),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Lay out the tile grid and re-project the route into tile pixel space.
 *
 * `segments` must already be privacy-redacted: this is fed the same segments
 * the SVG path is built from, after `privacyTrim`/`splitAwayFrom`, so the
 * basemap frames only geometry that was already cleared for publication. It
 * does not widen what is published, but it does make the published part
 * locatable on a street map, which the bare path did not.
 */
export function buildBasemap(segments: LatLng[][]): BasemapRender | null {
  const points = segments.flat();
  if (points.length < 2) return null;

  const width = TUNING.BASEMAP_WIDTH;
  const height = TUNING.BASEMAP_HEIGHT;

  const xs = points.map((p) => mercatorXFraction(p.lng));
  const ys = points.map((p) => mercatorYFraction(p.lat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;

  const zoom = fitZoom(maxX - minX, maxY - minY, width, height, TUNING.BASEMAP_PADDING);
  const world = TILE_PX * 2 ** zoom;
  const tilesPerAxis = 2 ** zoom;

  // Centre the route's bounding box in the frame, then everything else is
  // measured from the frame's top-left corner in world pixels.
  const originX = ((minX + maxX) / 2) * world - width / 2;
  const originY = ((minY + maxY) / 2) * world - height / 2;

  const tiles: BasemapTile[] = [];
  const firstCol = Math.floor(originX / TILE_PX);
  const lastCol = Math.ceil((originX + width) / TILE_PX) - 1;
  const firstRow = Math.floor(originY / TILE_PX);
  const lastRow = Math.ceil((originY + height) / TILE_PX) - 1;

  for (let row = firstRow; row <= lastRow; row++) {
    // Latitude does not wrap: above the north edge or below the south edge
    // there is no tile to ask for, and the newsprint shows through instead.
    if (row < 0 || row >= tilesPerAxis) continue;
    for (let col = firstCol; col <= lastCol; col++) {
      // Longitude does wrap, so a route near the antimeridian still tiles.
      const wrapped = ((col % tilesPerAxis) + tilesPerAxis) % tilesPerAxis;
      tiles.push({
        z: zoom,
        x: wrapped,
        y: row,
        left: round(((col * TILE_PX - originX) / width) * 100),
        top: round(((row * TILE_PX - originY) / height) * 100),
        width: round((TILE_PX / width) * 100),
        height: round((TILE_PX / height) * 100),
      });
    }
  }

  const px = (n: number): number => Math.round(n * 100) / 100;
  const toXY = (p: LatLng): BasemapPoint => ({
    x: px(mercatorXFraction(p.lng) * world - originX),
    y: px(mercatorYFraction(p.lat) * world - originY),
  });

  // A one-point segment has nothing to stroke, and a frame of nothing but those
  // has no line at all, which is a null basemap rather than an empty path string.
  const drawn = segments.filter((segment) => segment.length >= 2);
  if (drawn.length === 0) return null;

  const pathD = drawn
    .map((segment) =>
      segment
        .map((p, i) => {
          const { x, y } = toXY(p);
          return `${i === 0 ? "M" : "L"}${x} ${y}`;
        })
        .join(" "),
    )
    .join(" ");

  const firstSegment = drawn[0] as LatLng[];
  const lastSegment = drawn[drawn.length - 1] as LatLng[];

  return {
    zoom,
    width,
    height,
    tiles,
    pathD,
    start: toXY(firstSegment[0] as LatLng),
    end: toXY(lastSegment[lastSegment.length - 1] as LatLng),
    scale: scaleBar(zoom, latFromYFraction((minY + maxY) / 2), width),
  };
}

/** Inverse of `mercatorYFraction`, needed only for the scale bar's centre latitude. */
export function latFromYFraction(fraction: number): number {
  const n = Math.PI * (1 - 2 * fraction);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
