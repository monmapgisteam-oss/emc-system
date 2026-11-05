import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTruckTelemetry,
  type TerrainElevationSample,
  type TruckTelemetryInput,
} from "../lib/truckTelemetry";

const truck = (overrides: Partial<TruckTelemetryInput> = {}): TruckTelemetryInput => ({
  id: 42, lon: 104, lat: 49, heading: 0, loaded: false, parked: false, ...overrides,
});
const mesh = (height: number): TerrainElevationSample => ({ height, source: "mesh" });
const closeTo = (actual: number | null, expected: number, tolerance = 0.001) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < tolerance, `${actual} should be near ${expected}`);
};

test("nearest truck uses physical meters and longitude's latitude correction", () => {
  const results = buildTruckTelemetry([
    truck(), truck({ id: 15, lon: 104.001 }), truck({ id: 16, lat: 49.001 }),
  ]);
  // At 49 degrees north, 0.001 degree east is about 72.95 m, not 111.2 m.
  closeTo(results[0].nearestDistance, 72.9505, 0.01);
  closeTo(results[1].nearestDistance, results[0].nearestDistance!);
  closeTo(results[2].nearestDistance, 111.1951, 0.01);
});

test("self is excluded, parked neighbors count, and coincident trucks are zero meters apart", () => {
  assert.equal(buildTruckTelemetry([truck()])[0].nearestDistance, null);
  const results = buildTruckTelemetry([truck(), truck({ id: 99, parked: true })]);
  assert.equal(results[0].nearestDistance, 0);
  assert.equal(results[1].nearestDistance, 0);
  assert.equal(results[1].parked, true);
  assert.deepEqual(buildTruckTelemetry([]), []);
});

test("distance follows the short crossing of the antimeridian", () => {
  const results = buildTruckTelemetry([
    truck({ lon: 179.999, lat: 0 }),
    truck({ id: 99, lon: -179.999, lat: 0 }),
  ]);
  closeTo(results[0].nearestDistance, 222.3902, 0.01);
});

test("incline is signed terrain slope along the truck's heading", () => {
  const metersPerLatitudeDegree = 6_371_008.8 * Math.PI / 180;
  const northRising = (_lon: number, lat: number) =>
    mesh(1_500 + (lat - 49) * metersPerLatitudeDegree * 0.1);
  const results = buildTruckTelemetry([
    truck({ heading: 0 }),
    truck({ id: 99, heading: 180 }),
    truck({ id: 101, heading: 90 }),
    truck({ id: 102, heading: 360 }),
  ], northRising);
  const angle = Math.atan(0.1) * 180 / Math.PI;
  closeTo(results[0].incline, angle);
  closeTo(results[1].incline, -angle);
  closeTo(results[2].incline, 0);
  closeTo(results[3].incline, angle);
});

test("east-facing incline also accounts for latitude", () => {
  const metersPerLongitudeDegree = 6_371_008.8 * Math.PI / 180 * Math.cos(49 * Math.PI / 180);
  const eastRising = (lon: number) => mesh(1_500 + (lon - 104) * metersPerLongitudeDegree * 0.2);
  const [east, west] = buildTruckTelemetry([
    truck({ heading: 90 }), truck({ id: 99, heading: 270 }),
  ], eastRising);
  closeTo(east.incline, Math.atan(0.2) * 180 / Math.PI);
  closeTo(west.incline, -Math.atan(0.2) * 180 / Math.PI);
});

test("flat terrain includes a valid zero-meter elevation", () => {
  assert.equal(buildTruckTelemetry([truck()], () => mesh(0))[0].incline, 0);
  assert.equal(buildTruckTelemetry([truck()], () => ({ height: 1500, source: "ground" }))[0].incline, 0);
});

test("missing, nonfinite, or mixed-source elevations are unavailable", () => {
  assert.equal(buildTruckTelemetry([truck()])[0].incline, null);
  for (const height of [NaN, Infinity, -Infinity]) {
    assert.equal(buildTruckTelemetry([truck()], () => mesh(height))[0].incline, null);
  }
  assert.equal(buildTruckTelemetry([truck()], (_lon, lat) =>
    lat > 49 ? null : mesh(1500))[0].incline, null);
  assert.equal(buildTruckTelemetry([truck()], (_lon, lat) => ({
    height: lat > 49 ? 1510 : 1500,
    source: lat > 49 ? "mesh" : "ground",
  }))[0].incline, null);
});

test("hazard severity and loading state are preserved with stable ids and sequential labels", () => {
  const trucks = [truck({ id: 27, loaded: true }), truck({ id: 4, parked: true })];
  for (const severity of [0, 1, 2, 3, null] as const) {
    const results = buildTruckTelemetry(trucks, undefined, () => severity);
    assert.deepEqual(results.map(value => value.hazardLevel), [severity, severity]);
    assert.deepEqual(results.map(value => value.id), [27, 4]);
    assert.deepEqual(results.map(value => value.displayNumber), [1, 2]);
    assert.deepEqual(results.map(value => value.loaded), [true, false]);
    assert.deepEqual(results.map(value => value.parked), [false, true]);
  }
  assert.equal(buildTruckTelemetry(trucks)[0].hazardLevel, null);
});

test("invalid coordinates do not call terrain or hazard lookups or create a nearest neighbor", () => {
  const invalid = [
    truck({ lon: NaN }), truck({ lat: Infinity }),
    truck({ lon: 181 }), truck({ lat: -91 }),
  ];
  const unexpectedLookup = () => { throw new Error("Invalid position must not be sampled"); };
  for (const item of buildTruckTelemetry(invalid, unexpectedLookup, unexpectedLookup)) {
    assert.equal(item.incline, null);
    assert.equal(item.nearestDistance, null);
    assert.equal(item.hazardLevel, null);
  }
  const results = buildTruckTelemetry([truck(), ...invalid]);
  assert.equal(results[0].nearestDistance, null);
});

test("invalid heading only makes incline unavailable", () => {
  const [result] = buildTruckTelemetry([
    truck({ heading: NaN }), truck({ id: 99, lon: 104.001 }),
  ], () => mesh(0), () => 2);
  assert.equal(result.incline, null);
  assert.equal(result.hazardLevel, 2);
  closeTo(result.nearestDistance, 72.9505, 0.01);
});
