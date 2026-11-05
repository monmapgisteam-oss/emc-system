import type { Truck } from "./flow";

export interface ExcavatorPlacement {
  truckId: number;
  lon: number;
  lat: number;
  heading: number;
}

// Flat working areas beside these parked trucks, checked against all six
// monthly mine surfaces. Positive aft is behind the truck; side -1 is left.
const WORK_AREAS = [
  { truckId: 10000, side: -1, lateral: 26, aft: 2 },
  { truckId: 10001, side: -1, lateral: 28, aft: -6 },
  { truckId: 10003, side: -1, lateral: 26, aft: 2 },
] as const;

/** Fixed equipment belongs beside parked trucks, not traffic waiting to turn. */
export function placeExcavators(
  trucks: readonly Pick<Truck, "id" | "parked" | "lon" | "lat" | "heading">[],
): ExcavatorPlacement[] {
  const placements: ExcavatorPlacement[] = [];
  for (const area of WORK_AREAS) {
    const truck = trucks.find((item) => item.id === area.truckId && item.parked);
    if (!truck || ![truck.lon, truck.lat, truck.heading].every(Number.isFinite)) continue;
    const latitude = truck.lat * Math.PI / 180;
    const heading = truck.heading * Math.PI / 180;
    // WGS84 local radii convert the small offsets from metres to degrees.
    const eccentricitySquared = 0.00669437999014;
    const denominator = 1 - eccentricitySquared * Math.sin(latitude) ** 2;
    const metresLongitude = Math.PI / 180 * 6378137 / Math.sqrt(denominator) * Math.cos(latitude);
    const metresLatitude = Math.PI / 180 * 6378137 * (1 - eccentricitySquared) / denominator ** 1.5;
    if (Math.abs(metresLongitude) < 1) continue;
    const east = area.side * area.lateral * Math.cos(heading) - area.aft * Math.sin(heading);
    const north = -area.side * area.lateral * Math.sin(heading) - area.aft * Math.cos(heading);
    // Face the dump body, three metres behind the truck's center.
    const targetEast = -3 * Math.sin(heading);
    const targetNorth = -3 * Math.cos(heading);
    placements.push({
      truckId: truck.id,
      lon: truck.lon + east / metresLongitude,
      lat: truck.lat + north / metresLatitude,
      heading: (Math.atan2(targetEast - east, targetNorth - north) * 180 / Math.PI + 360) % 360,
    });
  }
  return placements;
}
