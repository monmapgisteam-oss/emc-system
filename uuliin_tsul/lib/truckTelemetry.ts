import type { HazardLevel } from "./hazards";

export interface TruckTelemetryInput {
  readonly id: number;
  readonly lon: number;
  readonly lat: number;
  /** Compass bearing: 0 = north, 90 = east. */
  readonly heading: number;
  readonly loaded: boolean;
  readonly parked: boolean;
}

export interface TerrainElevationSample {
  height: number;
  source: "mesh" | "ground";
}

export interface TruckTelemetry {
  id: number;
  displayNumber: number;
  loaded: boolean;
  parked: boolean;
  incline: number | null;
  nearestDistance: number | null;
  hazardLevel: HazardLevel | null;
}

const EARTH_RADIUS_METERS = 6_371_008.8;
const RADIANS = Math.PI / 180;
const INCLINE_HALF_SPAN_METERS = 6;

function hasPosition(truck: TruckTelemetryInput): boolean {
  return Number.isFinite(truck.lon) && Number.isFinite(truck.lat) &&
    Math.abs(truck.lon) <= 180 && Math.abs(truck.lat) <= 90;
}

/** Horizontal great-circle distance, without Web Mercator's latitude distortion. */
function distanceMeters(a: TruckTelemetryInput, b: TruckTelemetryInput): number {
  const halfLatitude = (b.lat - a.lat) * RADIANS / 2;
  const halfLongitude = (b.lon - a.lon) * RADIANS / 2;
  const haversine = Math.sin(halfLatitude) ** 2 +
    Math.cos(a.lat * RADIANS) * Math.cos(b.lat * RADIANS) *
    Math.sin(halfLongitude) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

function positionAlongHeading(
  truck: TruckTelemetryInput,
  distance: number,
): [number, number] {
  const latitude = truck.lat * RADIANS;
  const heading = (truck.heading % 360) * RADIANS;
  const angle = distance / EARTH_RADIUS_METERS;
  const sinLatitude = Math.sin(latitude) * Math.cos(angle) +
    Math.cos(latitude) * Math.sin(angle) * Math.cos(heading);
  const nextLatitude = Math.asin(Math.max(-1, Math.min(1, sinLatitude)));
  const nextLongitude = truck.lon * RADIANS + Math.atan2(
    Math.sin(heading) * Math.sin(angle) * Math.cos(latitude),
    Math.cos(angle) - Math.sin(latitude) * Math.sin(nextLatitude),
  );
  return [((nextLongitude / RADIANS + 540) % 360) - 180, nextLatitude / RADIANS];
}

/**
 * Estimate slope from terrain ahead and behind the truck, never from its visual
 * model's elevation offset. Different terrain sources can have different datums.
 */
function terrainIncline(
  truck: TruckTelemetryInput,
  sampleElevation?: (lon: number, lat: number) => TerrainElevationSample | null,
): number | null {
  if (!sampleElevation || !Number.isFinite(truck.heading)) return null;
  const behind = sampleElevation(...positionAlongHeading(truck, -INCLINE_HALF_SPAN_METERS));
  const ahead = sampleElevation(...positionAlongHeading(truck, INCLINE_HALF_SPAN_METERS));
  if (!behind || !ahead || behind.source !== ahead.source ||
      !Number.isFinite(behind.height) || !Number.isFinite(ahead.height)) return null;
  const rise = ahead.height - behind.height;
  return Number.isFinite(rise)
    ? Math.atan2(rise, INCLINE_HALF_SPAN_METERS * 2) / RADIANS
    : null;
}

/** Build a snapshot for the full-screen truck strip; unavailable metrics stay null. */
export function buildTruckTelemetry(
  trucks: readonly TruckTelemetryInput[],
  sampleElevation?: (lon: number, lat: number) => TerrainElevationSample | null,
  hazardLevel?: (lon: number, lat: number) => HazardLevel | null,
): TruckTelemetry[] {
  const validPositions = trucks.map(hasPosition);
  return trucks.map((truck, index) => {
    let nearest = Infinity;
    if (validPositions[index]) {
      for (let other = 0; other < trucks.length; other++) {
        if (other === index || !validPositions[other]) continue;
        nearest = Math.min(nearest, distanceMeters(truck, trucks[other]));
      }
    }
    return {
      id: truck.id,
      displayNumber: index + 1,
      loaded: truck.loaded,
      parked: truck.parked,
      incline: validPositions[index] ? terrainIncline(truck, sampleElevation) : null,
      nearestDistance: Number.isFinite(nearest) ? nearest : null,
      hazardLevel: validPositions[index] && hazardLevel
        ? hazardLevel(truck.lon, truck.lat)
        : null,
    };
  });
}
