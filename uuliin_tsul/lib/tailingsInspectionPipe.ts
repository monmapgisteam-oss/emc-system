import Graphic from "@arcgis/core/Graphic";
import Mesh from "@arcgis/core/geometry/Mesh";
import MeshMaterialMetallicRoughness from "@arcgis/core/geometry/support/MeshMaterialMetallicRoughness";
import MeshSymbol3D from "@arcgis/core/symbols/MeshSymbol3D";

interface RoutePoint { lon: number; lat: number; z: number; nx: number; ny: number }
type Vector = [number, number, number];
interface Frame { point: RoutePoint; normal: Vector; up: Vector; tangent: Vector }

const DEG = Math.PI / 180, EARTH = 6378137, LAT_METERS = 111320;
const unit = (v: Vector): Vector => {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
const cross = (a: Vector, b: Vector): Vector =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A green bolted sleeve on the real pipe, with an open front/top viewing window.
 * +N is the route's left normal; the cutout runs from -25° through +70°.
 * Nothing spans the opening. The water mesh behind it remains fully visible.
 */
export function createInspectionPipe(
  at: (s: number) => RoutePoint,
  centerS: number,
  radius: number,
): Graphic {
  const r = Math.max(1, Number.isFinite(radius) ? radius : 7);
  const half = r * 4.5, windowHalf = r * 2.9;
  const start = centerS - half, end = centerS + half;
  const windowStart = centerS - windowHalf, windowEnd = centerS + windowHalf;
  const outer = r * 1.035, inner = outer - 0.15;
  const angleStart = -25 * DEG, angleEnd = 70 * DEG;
  const slices = 72, cutSlices = 19;
  const positions: number[] = [];
  const greenFaces: number[] = [], innerFaces: number[] = [], trimFaces: number[] = [], boltFaces: number[] = [];
  const quad = (faces: number[], a: number, b: number, c: number, d: number) =>
    faces.push(a, b, c, a, c, d);

  const frameAt = (s: number): Frame => {
    const point = at(s), a = at(s - 0.5), b = at(s + 0.5);
    const horizontal: Vector = [(b.lon - a.lon) * LAT_METERS * Math.cos(point.lat * DEG),
      (b.lat - a.lat) * LAT_METERS, b.z - a.z];
    const tangent = Math.hypot(...horizontal) > 0.001 ? unit(horizontal) : unit([point.ny, -point.nx, 0]);
    const normal = unit([-tangent[1], tangent[0], 0]);
    return { point, tangent, normal, up: unit(cross(tangent, normal)) };
  };
  const vertex = (frame: Frame, lateral: number, height: number, axial = 0): number => {
    const east = frame.normal[0] * lateral + frame.up[0] * height + frame.tangent[0] * axial;
    const north = frame.normal[1] * lateral + frame.up[1] * height + frame.tangent[1] * axial;
    const up = frame.normal[2] * lateral + frame.up[2] * height + frame.tangent[2] * axial;
    const lon = frame.point.lon + east / (LAT_METERS * Math.cos(frame.point.lat * DEG));
    const lat = frame.point.lat + north / LAT_METERS;
    const index = positions.length / 3;
    positions.push(EARTH * lon * DEG, EARTH * Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2)), frame.point.z + up);
    return index;
  };
  const ring = (frame: Frame, ringRadius: number, axial = 0, first = angleStart, last = angleStart + Math.PI * 2,
    count = slices): number[] => Array.from({ length: count + 1 }, (_, j) => {
    const angle = first + (last - first) * j / count;
    return vertex(frame, ringRadius * Math.cos(angle), ringRadius * Math.sin(angle), axial);
  });
  const join = (faces: number[], a: number[], b: number[], reverse = false) => {
    for (let j = 0; j < a.length - 1; j++) {
      if (reverse) quad(faces, a[j], b[j], b[j + 1], a[j + 1]);
      else quad(faces, a[j], a[j + 1], b[j + 1], b[j]);
    }
  };
  // Explicit stations ensure the cut edges never drift to a nearby route sample.
  const stations = [start];
  for (const [a, b] of [[start, windowStart], [windowStart, windowEnd], [windowEnd, end]]) {
    const count = Math.ceil((b - a) / 2);
    for (let i = 1; i <= count; i++) stations.push(a + (b - a) * i / count);
  }
  const shell = stations.map(s => {
    const frame = frameAt(s);
    return { s, outer: ring(frame, outer), inner: ring(frame, inner) };
  });
  for (let i = 1; i < shell.length; i++) {
    const a = shell[i - 1], b = shell[i];
    const open = (a.s + b.s) / 2 > windowStart && (a.s + b.s) / 2 < windowEnd;
    for (let j = 0; j < slices; j++) {
      if (open && j < cutSlices) continue;
      quad(greenFaces, a.outer[j], a.outer[j + 1], b.outer[j + 1], b.outer[j]);
      quad(innerFaces, a.inner[j], b.inner[j], b.inner[j + 1], a.inner[j + 1]);
    }
    if (open) {
      for (const edge of [0, cutSlices])
        quad(trimFaces, a.outer[edge], b.outer[edge], b.inner[edge], a.inner[edge]);
    }
  }
  for (const s of [start, end, windowStart, windowEnd]) {
    const frame = frameAt(s);
    const isWindow = s === windowStart || s === windowEnd;
    const outside = ring(frame, outer, 0, angleStart, isWindow ? angleEnd : angleStart + Math.PI * 2,
      isWindow ? cutSlices : slices);
    const inside = ring(frame, inner, 0, angleStart, isWindow ? angleEnd : angleStart + Math.PI * 2,
      isWindow ? cutSlices : slices);
    join(trimFaces, outside, inside);
  }
  // A narrow raised trim follows the perimeter, on the retained steel only.
  const trimWidth = 0.15, trimRadius = outer + 0.018;
  for (const angle of [angleStart, angleEnd]) {
    const lower = angle === angleStart ? angle - trimWidth / outer : angle;
    const upper = angle === angleStart ? angle : angle + trimWidth / outer;
    const selected = stations.filter(s => s >= windowStart && s <= windowEnd);
    for (let i = 1; i < selected.length; i++) {
      const a = ring(frameAt(selected[i - 1]), trimRadius, 0, lower, upper, 1);
      const b = ring(frameAt(selected[i]), trimRadius, 0, lower, upper, 1);
      join(trimFaces, a, b);
    }
  }
  for (const s of [windowStart, windowEnd]) {
    const outsideS = s + (s === windowStart ? -trimWidth : trimWidth);
    join(trimFaces, ring(frameAt(s), trimRadius, 0, angleStart, angleEnd, cutSlices),
      ring(frameAt(outsideS), trimRadius, 0, angleStart, angleEnd, cutSlices));
  }

  const bolt = (frame: Frame, lateral: number, height: number, lo: number, hi: number,
    boltRadius: number, sides: number) => {
    const ends = [lo, hi].map(axial => Array.from({ length: sides }, (_, i) => {
      const angle = Math.PI * 2 * i / sides;
      return vertex(frame, lateral + boltRadius * Math.cos(angle), height + boltRadius * Math.sin(angle), axial);
    }));
    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides;
      quad(boltFaces, ends[0][i], ends[0][next], ends[1][next], ends[1][i]);
    }
    for (const points of ends)
      for (let i = 1; i < sides - 1; i++) boltFaces.push(points[0], points[i], points[i + 1]);
  };
  for (const s of [centerS - (half - 1.4), centerS + (half - 1.4)]) {
    const frame = frameAt(s), flangeOuter = r * 1.3, flangeInner = r * 1.005, width = 1.7;
    // Separate rings for each face retain crisp flange edges with smooth barrels.
    join(greenFaces, ring(frame, flangeOuter, -width / 2), ring(frame, flangeOuter, width / 2));
    join(innerFaces, ring(frame, flangeInner, -width / 2), ring(frame, flangeInner, width / 2), true);
    for (const axial of [-width / 2, width / 2])
      join(greenFaces, ring(frame, flangeOuter, axial), ring(frame, flangeInner, axial));
    for (let i = 0; i < 12; i++) {
      const angle = Math.PI * 2 * (i + 0.5) / 12;
      const lateral = Math.cos(angle) * r * 1.16, height = Math.sin(angle) * r * 1.16;
      const size = r * 0.045;
      bolt(frame, lateral, height, -width / 2 - 0.25, width / 2 + 0.25, size * 0.52, 12);
      for (const side of [-1, 1]) {
        const axial = side * (width / 2 + 0.06);
        bolt(frame, lateral, height, axial - 0.055, axial + 0.055, size * 1.3, 16);
        const head = side * (width / 2 + 0.21);
        bolt(frame, lateral, height, head - 0.14, head + 0.14, size, 6);
      }
    }
  }
  const material = (color: string, metallic: number, roughness: number) =>
    new MeshMaterialMetallicRoughness({ color, alphaMode: "opaque", metallic, roughness, doubleSided: true });
  return new Graphic({
    geometry: new Mesh({
      spatialReference: { wkid: 3857 },
      vertexAttributes: { position: new Float64Array(positions) },
      components: [
        { faces: new Uint32Array(greenFaces), shading: "smooth", material: material("#246f4d", 0.2, 0.5) },
        { faces: new Uint32Array(innerFaces), shading: "smooth", material: material("#123b2f", 0.1, 0.65) },
        { faces: new Uint32Array(trimFaces), shading: "flat", material: material("#89a99b", 0.6, 0.38) },
        { faces: new Uint32Array(boltFaces), shading: "flat", material: material("#a9b8ad", 0.75, 0.32) },
      ],
    }),
    symbol: new MeshSymbol3D({ symbolLayers: [{ type: "fill", castShadows: false }] }),
  });
}
