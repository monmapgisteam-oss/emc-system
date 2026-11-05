import assert from "node:assert/strict";
import test from "node:test";
import { compileHazardZones, hazardLevelAt, type HazardFeature } from "../lib/hazards";

const square = (x: number, y: number, size: number) =>
  [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const feature = (code: unknown, rings: unknown): HazardFeature => ({
  attributes: { code }, geometry: { rings },
});

test("a truck gains and clears its hazard as it crosses the polygon", () => {
  const index = compileHazardZones([feature(2, [square(104, 49, 0.01)])]);
  assert.equal(hazardLevelAt(index, 103.99, 49.005), 0);
  assert.equal(hazardLevelAt(index, 104.005, 49.005), 2);
  assert.equal(hazardLevelAt(index, 104.02, 49.005), 0);
});

test("holes are safe and nested islands are hazardous regardless of winding", () => {
  const index = compileHazardZones([feature(3, [
    square(0, 0, 10), square(2, 2, 6), square(4, 4, 2).reverse(),
  ])]);
  assert.equal(hazardLevelAt(index, 1, 1), 3);
  assert.equal(hazardLevelAt(index, 3, 3), 0);
  assert.equal(hazardLevelAt(index, 5, 5), 3);
});

test("multipart polygons include each outer ring but exclude the space between them", () => {
  const index = compileHazardZones([feature(1, [square(0, 0, 2), square(5, 5, 2).reverse()])]);
  assert.equal(hazardLevelAt(index, 1, 1), 1);
  assert.equal(hazardLevelAt(index, 6, 6), 1);
  assert.equal(hazardLevelAt(index, 3, 3), 0);
});

test("outer edges, hole edges, vertices and diagonal edges count as hazardous", () => {
  const index = compileHazardZones([feature(2, [square(0, 0, 10), square(2, 2, 6)])]);
  for (const [x, y] of [[0, 0], [0, 5], [5, 10], [2, 5], [2, 2]]) {
    assert.equal(hazardLevelAt(index, x, y), 2);
  }
  const triangle = compileHazardZones([feature(3, [[[104, 49], [104.01, 49], [104, 49.01]]])]);
  assert.equal(hazardLevelAt(triangle, 104.005, 49.005), 3);
  assert.equal(hazardLevelAt(triangle, 104.006, 49.006), 0);
  assert.equal(hazardLevelAt(index, -0.000001, 5), 0);
});

test("highest severity wins in overlapping zones in either input order", () => {
  const zones = [feature(1, [square(0, 0, 10)]), feature(3, [square(2, 2, 6)]),
    feature(2, [square(1, 1, 8)])];
  for (const ordered of [zones, [...zones].reverse()]) {
    const index = compileHazardZones(ordered);
    assert.equal(hazardLevelAt(index, 0.5, 0.5), 1);
    assert.equal(hazardLevelAt(index, 1.5, 1.5), 2);
    assert.equal(hazardLevelAt(index, 5, 5), 3);
    assert.equal(hazardLevelAt(index, 2, 5), 3);
  }
});

test("a hole in a severe zone still allows a lower overlapping hazard", () => {
  const index = compileHazardZones([
    feature(3, [square(0, 0, 10), square(2, 2, 6)]),
    feature(1, [square(3, 3, 2)]),
  ]);
  assert.equal(hazardLevelAt(index, 4, 4), 1);
  assert.equal(hazardLevelAt(index, 6, 6), 0);
});

test("unknown, missing and nonfinite codes are ignored", () => {
  const invalidCodes = [undefined, null, "", "unknown", "01", 0, -1, 4, 1.5, NaN, Infinity, true];
  assert.equal(compileHazardZones(invalidCodes.map(code => feature(code, [square(0, 0, 5)]))).length, 0);
  for (const code of ["1", "2", "3"]) {
    assert.equal(hazardLevelAt(compileHazardZones([feature(code, [square(0, 0, 5)])]), 1, 1), Number(code));
  }
});

test("missing, malformed, nonfinite and degenerate geometry is ignored", () => {
  const invalid = [
    undefined, null, {}, [], [[]], [[[0, 0], [1, 1]]],
    [[[0, 0], [1, 1], [2, 2]]],
    [[[0, 0], [1, Infinity], [1, 0]]],
    [[[0, 0], ["1", 1], [1, 0]]],
    [square(0, 0, 5), [[1, 1], [2, 2]]], // Never discard only a malformed hole.
  ];
  const index = compileHazardZones([
    {}, { attributes: { code: 3 } }, { attributes: { code: 3 }, geometry: null },
    ...invalid.map(rings => feature(3, rings)),
  ]);
  assert.equal(index.length, 0);
  assert.equal(hazardLevelAt(index, 0, 0), 0);
});

test("nonfinite truck coordinates are outside and compiled geometry is a snapshot", () => {
  const ring = square(0, 0, 5);
  const index = compileHazardZones([feature(2, [ring])]);
  ring[0][0] = 100;
  assert.equal(hazardLevelAt(index, 1, 1), 2);
  assert.equal(hazardLevelAt(index, NaN, 1), 0);
  assert.equal(hazardLevelAt(index, 1, Infinity), 0);
});
