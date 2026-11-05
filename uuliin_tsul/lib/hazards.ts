/** WGS84 polygon geofences, independent of the map renderer. */
export type HazardLevel = 0 | 1 | 2 | 3;
export type HazardZoneLevel = Exclude<HazardLevel, 0>;

export interface HazardFeature {
  readonly attributes?: { readonly code?: unknown } | null;
  readonly geometry?: { readonly rings?: unknown } | null;
}

export interface HazardBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface HazardRing {
  readonly points: readonly (readonly [number, number])[];
  readonly bounds: HazardBounds;
}

export interface HazardZone {
  readonly level: HazardZoneLevel;
  readonly rings: readonly HazardRing[];
  readonly bounds: HazardBounds;
}

/** Highest severity first; source geometry is copied when compiling. */
export type HazardIndex = readonly HazardZone[];

// A small geographic tolerance handles floating-point noise on polygon edges.
const EDGE_EPSILON = 1e-10;

function compileRing(value: unknown): HazardRing | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const points: [number, number][] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2 ||
        typeof point[0] !== "number" || typeof point[1] !== "number" ||
        !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    const [x, y] = point;
    points.push([x, y]);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  // Translate before computing area to avoid cancellation at real lon/lat values.
  const [originX, originY] = points[0];
  let area = 0;
  for (let i = 1; i < points.length - 1; i++) {
    area += (points[i][0] - originX) * (points[i + 1][1] - originY) -
      (points[i + 1][0] - originX) * (points[i][1] - originY);
  }
  if (!Number.isFinite(area) || area === 0) return null;
  return { points, bounds: { minX, minY, maxX, maxY } };
}

/** Ignore unsupported codes and malformed polygons instead of guessing their shape. */
export function compileHazardZones(features: readonly HazardFeature[]): HazardIndex {
  const zones: HazardZone[] = [];
  for (const feature of features) {
    const code = feature?.attributes?.code;
    const level = code === 1 || code === "1" ? 1 :
      code === 2 || code === "2" ? 2 : code === 3 || code === "3" ? 3 : 0;
    const sourceRings = feature?.geometry?.rings;
    if (!level || !Array.isArray(sourceRings) || !sourceRings.length) continue;
    const rings: HazardRing[] = [];
    for (const sourceRing of sourceRings) {
      const ring = compileRing(sourceRing);
      if (!ring) break;
      rings.push(ring);
    }
    // Dropping just a malformed hole could incorrectly fill a safe area.
    if (rings.length !== sourceRings.length) continue;
    const bounds = {
      minX: Math.min(...rings.map(ring => ring.bounds.minX)),
      minY: Math.min(...rings.map(ring => ring.bounds.minY)),
      maxX: Math.max(...rings.map(ring => ring.bounds.maxX)),
      maxY: Math.max(...rings.map(ring => ring.bounds.maxY)),
    };
    zones.push({ level, rings, bounds });
  }
  return zones.sort((a, b) => b.level - a.level);
}

function withinBounds(bounds: HazardBounds, x: number, y: number): boolean {
  return x >= bounds.minX - EDGE_EPSILON && x <= bounds.maxX + EDGE_EPSILON &&
    y >= bounds.minY - EDGE_EPSILON && y <= bounds.maxY + EDGE_EPSILON;
}

/** 0 = outside, 1 = inside, 2 = on the boundary. */
function ringContains(ring: HazardRing, x: number, y: number): 0 | 1 | 2 {
  if (!withinBounds(ring.bounds, x, y)) return 0;
  let inside = false;
  const points = ring.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j], [bx, by] = points[i];
    const dx = bx - ax, dy = by - ay;
    if (x >= Math.min(ax, bx) - EDGE_EPSILON && x <= Math.max(ax, bx) + EDGE_EPSILON &&
        y >= Math.min(ay, by) - EDGE_EPSILON && y <= Math.max(ay, by) + EDGE_EPSILON &&
        Math.abs((x - ax) * dy - (y - ay) * dx) <= EDGE_EPSILON * Math.hypot(dx, dy)) {
      return 2;
    }
    if ((ay > y) !== (by > y) && x < ax + (y - ay) * dx / dy) inside = !inside;
  }
  return inside ? 1 : 0;
}

/**
 * Return the highest hazard level at a truck's WGS84 position.
 * Even/odd ring parity supports holes, nested islands, and multipart polygons;
 * every polygon boundary, including a hole boundary, belongs to the hazard.
 */
export function hazardLevelAt(index: HazardIndex, lon: number, lat: number): HazardLevel {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 0;
  for (const zone of index) {
    if (!withinBounds(zone.bounds, lon, lat)) continue;
    let inside = false;
    for (const ring of zone.rings) {
      const containment = ringContains(ring, lon, lat);
      if (containment === 2) return zone.level;
      if (containment === 1) inside = !inside;
    }
    if (inside) return zone.level;
  }
  return 0;
}
