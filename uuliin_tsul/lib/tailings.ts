import Graphic from "@arcgis/core/Graphic";
import Mesh from "@arcgis/core/geometry/Mesh";
import Polyline from "@arcgis/core/geometry/Polyline";
import MeshMaterialMetallicRoughness from "@arcgis/core/geometry/support/MeshMaterialMetallicRoughness";
import MeshTexture from "@arcgis/core/geometry/support/MeshTexture";
import MeshSymbol3D from "@arcgis/core/symbols/MeshSymbol3D";
import type GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import type SceneView from "@arcgis/core/views/SceneView";
import type { TailPt } from "./flow";

export interface TailingsFlow {
  /** A straight portion of the sampled pipe for the inspection camera. */
  readonly inspectionTarget: { lon: number; lat: number; z: number; heading: number; span: number } | null;
  /** dt is elapsed seconds; quantity is the selected month's reported quantity. */
  update(dt: number, quantity: number): void;
  /** 0..1 opacity of the complete pipe enclosure, including its couplings. */
  setPipeOpacity(opacity: number): void;
  /** Open/restore a longitudinal front/top section around inspectionTarget. */
  setCutaway(enabled: boolean): void;
  destroy(): void;
}

interface RoutePoint { lon: number; lat: number; z: number; s: number; nx: number; ny: number }
const DEG = Math.PI / 180;
const EARTH = 6378137;
const LAT_METERS = 111320;
const noop: TailingsFlow = { inspectionTarget: null, update() {}, setPipeOpacity() {}, setCutaway() {}, destroy() {} };

function distance(a: TailPt, b: TailPt) {
  return Math.hypot((b.lon - a.lon) * LAT_METERS * Math.cos((a.lat + b.lat) * DEG / 2),
    (b.lat - a.lat) * LAT_METERS);
}

function offset(p: RoutePoint, lateral: number, height = 0): number[] {
  return [p.lon + p.nx * lateral / (LAT_METERS * Math.cos(p.lat * DEG)),
    p.lat + p.ny * lateral / LAT_METERS, p.z + height];
}

/** An intact buried pipe with controllable transparency and an explicit cutaway.
 * Ground elevation is sampled once; every surface then shares absolute heights.
 * The first graphic spans the whole route, preserving the map's zoom-to behavior.
 * Diameter and flow speed are visual aids, not measured hydraulic quantities.
 */
export async function createTailings(
  view: SceneView,
  layer: GraphicsLayer,
  path: TailPt[],
  depth = 30,
  diameter = 2,
  signal?: AbortSignal,
): Promise<TailingsFlow> {
  const unavailable = () => signal?.aborted || view.destroyed || layer.destroyed;
  if (unavailable() || path.length < 2) return noop;
  const ground = view.map?.ground;
  if (!ground) return noop;

  const sampled: TailPt[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], length = distance(a, b);
    if (length < 0.05) continue;
    const steps = Math.ceil(length / 28);
    for (let j = 1; j <= steps; j++) {
      const f = j / steps;
      sampled.push({ lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f, z: 0 });
    }
  }
  if (sampled.length < 2) return noop;
  const result = await ground.queryElevation(new Polyline({
    spatialReference: { wkid: 4326 }, paths: [sampled.map(p => [p.lon, p.lat])],
  }), { demResolution: "finest-contiguous", noDataValue: -9999, signal });
  if (unavailable()) return noop;
  const elevations = (result.geometry as Polyline).paths[0];
  if (!elevations || elevations.length !== sampled.length || elevations.some(p => !Number.isFinite(p[2]) || p[2] === -9999)) {
    throw new Error("Tailings route elevation is unavailable");
  }

  const route: RoutePoint[] = [];
  let total = 0;
  for (let i = 0; i < sampled.length; i++) {
    if (i) total += distance(sampled[i - 1], sampled[i]);
    const before = sampled[Math.max(0, i - 1)], after = sampled[Math.min(sampled.length - 1, i + 1)];
    const dx = (after.lon - before.lon) * Math.cos(sampled[i].lat * DEG);
    const dy = after.lat - before.lat, magnitude = Math.hypot(dx, dy) || 1;
    route.push({ ...sampled[i], z: elevations[i][2] - depth, s: total, nx: -dy / magnitude, ny: dx / magnitude });
  }
  if (total < 1) return noop;
  const at = (s: number): RoutePoint => {
    s = Math.max(0, Math.min(total, s));
    let lo = 0, hi = route.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (route[mid].s < s) lo = mid; else hi = mid; }
    const a = route[lo], b = route[hi], f = (s - a.s) / Math.max(0.001, b.s - a.s);
    const nx = a.nx + (b.nx - a.nx) * f, ny = a.ny + (b.ny - a.ny) * f, norm = Math.hypot(nx, ny) || 1;
    return { lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f,
      z: a.z + (b.z - a.z) * f, nx: nx / norm, ny: ny / norm, s };
  };
  // Prefer a straight section near the first third of the route, away from its
  // endpoints. The height comes from the very same DEM sampling as the pipe.
  let inspection = at(total * 0.35), bestScore = Infinity;
  for (let s = total * 0.2; s <= total * 0.65; s += 28) {
    const p = at(s), a = at(s - 75), b = at(s + 75);
    const curvature = 1 - Math.max(-1, Math.min(1, a.nx * b.nx + a.ny * b.ny));
    const gradeChange = Math.abs((p.z - a.z) - (b.z - p.z)) / 75;
    const score = curvature + gradeChange * 0.7 + Math.abs(s / total - 0.35) * 0.1;
    if (score < bestScore) { inspection = p; bestScore = score; }
  }

  const radius = Math.max(0.1, Number.isFinite(diameter) && diameter > 0 ? diameter / 2 : 1);
  const inspectionSpan = Math.min(total, Math.max(18, radius * 14));
  const cutStart = Math.max(0, inspection.s - inspectionSpan / 2);
  const cutEnd = Math.min(total, inspection.s + inspectionSpan / 2);
  const inner = radius * 0.92;
  // The circular liquid segment occupies about 64% of the internal area.
  const waterHeight = inner * 0.22;
  const waterWidth = Math.sqrt(inner * inner - waterHeight * waterHeight);
  const positions: number[] = [], shellFaces: number[] = [], jointFaces: number[] = [];
  const cutShellFaces: number[] = [], cutJointFaces: number[] = [];
  // Exact -30° and +100° edges face the inspection camera (+route normal).
  const slices = 36, cutSlices = 13, angleStart = -Math.PI / 6;
  const vertex = (p: RoutePoint, lateral: number, height: number) => {
    const [lon, lat, z] = offset(p, lateral, height), index = positions.length / 3;
    positions.push(EARTH * lon * DEG, EARTH * Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2)), z);
    return index;
  };
  const quad = (faces: number[], a: number, b: number, c: number, d: number) => faces.push(a, b, c, a, c, d);
  // Include the cut's exact endpoints even when they fall between DEM samples.
  const shellStations = [...new Set([...route.map(p => p.s), cutStart, cutEnd])].sort((a, b) => a - b);
  const rings = shellStations.map(s => {
    const p = at(s);
    const outer: number[] = [];
    for (let j = 0; j <= slices; j++) {
      const angle = angleStart + 2 * Math.PI * j / slices;
      outer.push(vertex(p, radius * Math.cos(angle), radius * Math.sin(angle)));
    }
    return outer;
  });
  for (let i = 1; i < rings.length; i++) {
    const a = rings[i - 1], b = rings[i];
    const open = (shellStations[i - 1] + shellStations[i]) / 2 > cutStart
      && (shellStations[i - 1] + shellStations[i]) / 2 < cutEnd;
    for (let j = 0; j < slices; j++) {
      quad(shellFaces, a[j], a[j + 1], b[j + 1], b[j]);
      if (!open || j >= cutSlices) quad(cutShellFaces, a[j], a[j + 1], b[j + 1], b[j]);
    }
  }
  // A single double-sided enclosure avoids redundant alpha surfaces. Couplings
  // follow the same opacity and cutaway, so neither can conceal exposed water.
  const couplingRadius = radius * 1.07;
  const coupling = (s: number, halfWidth: number) => {
    const lo = Math.max(0, s - halfWidth), hi = Math.min(total, s + halfWidth);
    const stations = [lo, hi, ...[cutStart, cutEnd].filter(edge => edge > lo && edge < hi)].sort((a, b) => a - b);
    for (let i = 1; i < stations.length; i++) {
      const a: number[] = [], b: number[] = [];
      for (let j = 0; j <= slices; j++) {
        const angle = angleStart + 2 * Math.PI * j / slices;
        a.push(vertex(at(stations[i - 1]), couplingRadius * Math.cos(angle), couplingRadius * Math.sin(angle)));
        b.push(vertex(at(stations[i]), couplingRadius * Math.cos(angle), couplingRadius * Math.sin(angle)));
      }
      const open = (stations[i - 1] + stations[i]) / 2 > cutStart
        && (stations[i - 1] + stations[i]) / 2 < cutEnd;
      for (let j = 0; j < slices; j++) {
        quad(jointFaces, a[j], a[j + 1], b[j + 1], b[j]);
        if (!open || j >= cutSlices) quad(cutJointFaces, a[j], a[j + 1], b[j + 1], b[j]);
      }
    }
  };
  const couplingHalfWidth = Math.max(0.06, radius * 0.1);
  coupling(couplingHalfWidth, couplingHalfWidth);
  const couplingSpacing = Math.max(12, radius * 18);
  for (let s = couplingSpacing / 2; s < total - couplingHalfWidth * 2; s += couplingSpacing)
    coupling(s, couplingHalfWidth);
  coupling(total - couplingHalfWidth, couplingHalfWidth);

  const meshPositions = new Float64Array(positions);
  const enclosureFaces = {
    shell: new Uint32Array(shellFaces), cutShell: new Uint32Array(cutShellFaces),
    joints: new Uint32Array(jointFaces), cutJoints: new Uint32Array(cutJointFaces),
  };
  let pipeOpacity = 1, cutaway = false;
  const enclosureMesh = (faces: Uint32Array, joint: boolean) => new Mesh({
    spatialReference: { wkid: 3857 }, vertexAttributes: { position: meshPositions },
    components: [{ faces, shading: "smooth", material: new MeshMaterialMetallicRoughness({
      color: joint ? [29, 91, 64, pipeOpacity] : [36, 111, 77, pipeOpacity],
      alphaMode: pipeOpacity >= 0.999 ? "opaque" : "blend",
      metallic: 0.15, roughness: 0.52, doubleSided: true,
    }) }],
  });
  const pipe = new Graphic({
    geometry: enclosureMesh(enclosureFaces.shell, false),
    symbol: new MeshSymbol3D({ symbolLayers: [{ type: "fill", castShadows: false }] }),
  });
  const joints = new Graphic({
    geometry: enclosureMesh(enclosureFaces.joints, true),
    symbol: new MeshSymbol3D({ symbolLayers: [{ type: "fill", castShadows: false }] }),
  });
  const applyEnclosure = () => {
    pipe.geometry = enclosureMesh(cutaway ? enclosureFaces.cutShell : enclosureFaces.shell, false);
    joints.geometry = enclosureMesh(cutaway ? enclosureFaces.cutJoints : enclosureFaces.joints, true);
  };

  // SceneView uploads new HTMLVideoElement frames directly into its existing
  // GPU texture. Every surface chunk shares the same color loop.
  // No per-particle Graphics or animated direction symbols are involved.
  const makeVideo = (name: string) => {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.src = `/data/${name}.mp4?v=water-v4-window`;
    video.load();
    return video;
  };
  const colorVideo = makeVideo("tailings-water");
  const colorTexture = new MeshTexture({ data: colorVideo, transparent: false, wrap: "repeat" });
  // Keep animated media in the color slot. Simultaneous video normal/emissive
  // maps produced a blank surface in SceneView after camera/material changes.
  // Smooth mesh normals supply the relief and lighting of the actual waves.
  const surfaceMaterial = new MeshMaterialMetallicRoughness({
    color: "#ffffff", colorTexture, emissiveColor: [4, 14, 12],
    alphaMode: "opaque", metallic: 0, roughness: 0.52, doubleSided: true,
  });
  const bodyMaterial = new MeshMaterialMetallicRoughness({
    color: "#ffffff", colorTexture: "/data/tailings-water-body.png?v=water-v4-window",
    emissiveColor: [2, 16, 18],
    alphaMode: "opaque", metallic: 0, roughness: 0.5, doubleSided: true,
  });
  // With opaque liquid and one transparent enclosing wall, SceneView can sort
  // the surfaces consistently, including when viewed from the side.
  const water: { graphic: Graphic; mesh: Mesh; center: RoutePoint; vertices: {
    index: number; z: number; s: number; lane: number; weight: number;
  }[] }[] = [];
  // Preserve the foam's physical aspect ratio as the pipe diameter changes.
  // Texture and raised crests share this wavelength and the video's clock.
  const textureLength = radius * 40 / 7;
  const stationStep = Math.min(2.5, Math.max(0.5, textureLength / 8));
  const boundaryFade = Math.min(12, textureLength * 0.5);
  const wave = (s: number, lane: number, time: number) => {
    // Broad modes of the same height field used by build_tailings_water.py.
    // Smooth mesh normals provide lighting between these vertices.
    const tau = 2 * Math.PI, t = time / 6, u = s / textureLength - t, v = (lane + 1) / 2;
    const x = u + 0.045 * Math.sin(tau * (2 * u + v + t)) + 0.022 * Math.sin(tau * (-u + 3 * v - t));
    const y = v + 0.05 * Math.sin(tau * (u - 2 * v + t)) + 0.018 * Math.sin(tau * (3 * u + v + 2 * t));
    return radius * 0.025 * (
      0.39956469 * Math.sin(tau * (2 * x - y + t) + 4.50764937)
      + 0.67361679 * Math.sin(tau * (x - y - t) + 6.0932529)
      + 0.26915348 * Math.sin(tau * (3 * x + y + t) + 4.048388));
  };
  const chunkLength = 150, across = 8, liquidSlices = 16;
  const fillAngle = Math.asin(waterHeight / inner);
  for (let start = 0; start < total; start += chunkLength) {
    const end = Math.min(total, start + chunkLength);
    const stations = [start, end];
    for (let s = start + stationStep; s < end; s += stationStep) stations.push(s);
    for (const p of route) if (p.s > start && p.s < end) stations.push(p.s);
    stations.sort((a, b) => a - b);
    const xyz: number[] = [], uv: number[] = [], surfaceFaces: number[] = [], bodyFaces: number[] = [];
    const vertices: typeof water[number]["vertices"] = [];
    const add = (p: RoutePoint, lateral: number, height: number, lane: number, weight: number, v: number) => {
      const [lon, lat, z] = offset(p, lateral, height);
      const index = xyz.length / 3;
      // Fixed boundary rows meet even when only nearby chunks are animating.
      const blend = Math.min(1, Math.max(0, Math.min(p.s - start, end - p.s) / boundaryFade));
      weight *= blend * blend * (3 - 2 * blend);
      xyz.push(EARTH * lon * DEG, EARTH * Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2)),
        z + wave(p.s, lane, 0) * weight);
      uv.push(p.s / textureLength, v);
      if (weight > 0) vertices.push({ index, z, s: p.s, lane, weight });
      return index;
    };
    let previousTop: number[] | null = null, previousBottom: number[] | null = null;
    stations.forEach((s, row) => {
      const p = at(s), top: number[] = [], bottom: number[] = [];
      for (let j = 0; j <= across; j++) {
        const lane = -1 + 2 * j / across;
        // Leave a little room at the wall for raised crests.
        top.push(add(p, lane * waterWidth * 0.96, waterHeight, lane, 1, j / across));
      }
      for (let j = 0; j <= liquidSlices; j++) {
        const f = j / liquidSlices, angle = Math.PI - fillAngle + (Math.PI + 2 * fillAngle) * f;
        const lateral = inner * Math.cos(angle) * 0.96;
        // The top two side vertices follow the very same wave as the surface.
        const weight = Math.pow(Math.abs(2 * f - 1), 6);
        bottom.push(add(p, lateral, inner * Math.sin(angle), lateral / (waterWidth * 0.96),
          weight, (lateral / (waterWidth * 0.96) + 1) / 2));
      }
      if (previousTop && previousBottom) {
        for (let j = 0; j < across; j++) quad(surfaceFaces, previousTop[j], top[j], top[j + 1], previousTop[j + 1]);
        for (let j = 0; j < liquidSlices; j++) quad(bodyFaces, previousBottom[j], previousBottom[j + 1], bottom[j + 1], bottom[j]);
      }
      // Close only the route's real ends, never the internal chunk boundaries.
      if ((start === 0 && row === 0) || (end === total && row === stations.length - 1)) {
        const outline = [...top, ...bottom.slice(1, -1).reverse()];
        const middle = add(p, 0, -inner * 0.25, 0, 0, 0.5);
        for (let j = 0; j < outline.length; j++) bodyFaces.push(middle, outline[j], outline[(j + 1) % outline.length]);
      }
      previousTop = top;
      previousBottom = bottom;
    });
    const mesh = new Mesh({
      spatialReference: { wkid: 3857 },
      vertexAttributes: { position: new Float64Array(xyz), uv: new Float32Array(uv) },
      components: [
        { faces: new Uint32Array(surfaceFaces), shading: "smooth", material: surfaceMaterial },
        { faces: new Uint32Array(bodyFaces), shading: "smooth", material: bodyMaterial },
      ],
    });
    water.push({ mesh, center: at((start + end) / 2), vertices,
      graphic: new Graphic({ geometry: mesh,
        symbol: new MeshSymbol3D({ symbolLayers: [{ type: "fill", castShadows: false }] }) }) });
  }
  const owned = [pipe, joints, ...water.map(chunk => chunk.graphic)];
  if (unavailable()) return noop;
  layer.addMany(owned);

  let destroyed = false, elapsed = 0, playing = false, rate = 1, retryAt = 0;
  const syncPlayback = (active: boolean) => {
    if (!active) {
      colorVideo.pause();
      playing = false;
      return;
    }
    if (playing || performance.now() < retryAt || colorVideo.readyState < 2) return;
    playing = true;
    void colorVideo.play().catch(() => {
      colorVideo.pause();
      playing = false;
      retryAt = performance.now() + 2000;
    });
  };
  const onVisibility = () => { if (document.hidden) syncPlayback(false); };
  document.addEventListener("visibilitychange", onVisibility);
  const controller: TailingsFlow = {
    inspectionTarget: {
      lon: inspection.lon, lat: inspection.lat, z: inspection.z,
      heading: (Math.atan2(inspection.ny, -inspection.nx) / DEG + 360) % 360,
      span: inspectionSpan,
    },
    update(dt, quantity) {
      if (destroyed || unavailable()) return;
      const q = Math.max(0, Number.isFinite(quantity) ? quantity : 0);
      const active = q > 0 && layer.visible && !document.hidden;
      syncPlayback(active);
      const nextRate = 0.65 + Math.min(q / 260, 2) * 0.35;
      if (Math.abs(nextRate - rate) > 0.001) {
        rate = nextRate;
        colorVideo.playbackRate = rate;
      }
      if (!active || !playing) return;
      const seconds = Math.min(0.25, Math.max(0, Number.isFinite(dt) ? dt : 0));
      elapsed += seconds;
      if (elapsed < 1 / 20) return;
      elapsed %= 1 / 20;
      const time = colorVideo.currentTime;
      // Geometry and texture use one clock, including at the seamless loop.
      if (view.scale > 6000) return;
      const camera = view.camera.position;
      if (camera.longitude == null || camera.latitude == null) return;
      const reach = Math.max(260, view.scale * 0.2);
      for (const chunk of water) {
        if (distance(chunk.center, { lon: camera.longitude, lat: camera.latitude, z: 0 }) > reach) continue;
        const xyz = chunk.mesh.vertexAttributes.position;
        for (const v of chunk.vertices) xyz[v.index * 3 + 2] = v.z + wave(v.s, v.lane, time) * v.weight;
        chunk.mesh.vertexAttributesChanged();
      }
    },
    setPipeOpacity(opacity) {
      if (destroyed || unavailable() || !Number.isFinite(opacity)) return;
      const next = Math.max(0, Math.min(1, opacity));
      if (Math.abs(next - pipeOpacity) < 0.001) return;
      pipeOpacity = next;
      // Replaces the enclosure only; video and liquid geometry keep their state.
      applyEnclosure();
    },
    setCutaway(enabled) {
      if (destroyed || unavailable() || cutaway === enabled) return;
      cutaway = enabled;
      applyEnclosure();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      signal?.removeEventListener("abort", onAbort);
      document.removeEventListener("visibilitychange", onVisibility);
      if (!layer.destroyed) layer.removeMany(owned);
      colorVideo.pause();
      colorVideo.removeAttribute("src");
      colorVideo.load();
    },
  };
  const onAbort = () => controller.destroy();
  signal?.addEventListener("abort", onAbort, { once: true });
  return controller;
}
