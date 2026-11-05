/* ==========================================================================
   Ил уурхайн сарын гадаргуу — AGOL-ын 3D object давхаргаас
   --------------------------------------------------------------------------
   Маркшейдерийн DWG-ийн multipatch-ийг AGOL-д publish хийсэн (lib/config.ts
   → PIT_SVC). ArcGIS JS API нь энэ давхаргаас зөвхөн хавтгай хүрээ буцаадаг
   тул REST-ийн `query`-гоор (multipatchOption=externalizeTextures) бүтэн
   гадаргууг Esri-гийн шахсан бинар multipatch болгон авч, өөрсдөө задална:

     binaryPatches (base64) → 12 байт толгой + zlib → shapefile-ийн
     MultiPatch (parts, partTypes, XY, Z) → гурвалжнууд

   Гурвалжнуудыг 5 м-ийн торны оройнууд дээр уншиж (дээд гадаргуу) мэш
   үүсгэнэ. Давхаргыг ТАЙРАХГҮЙ — бүтэн хүрээгээр нь (≈680 га) харуулна.
   Тор, эх цэг нь (public/data/pit_grid.json) өмнөх GLB-тэй ЯГ ижил тул
   блок загвар, замын өндөр, сар хоорондын өөрчлөлт (lib/pitSurface.ts)
   хэвээр таарна.
   ========================================================================== */
import Mesh from "@arcgis/core/geometry/Mesh";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import MeshComponent from "@arcgis/core/geometry/support/MeshComponent";
import MeshMaterial from "@arcgis/core/geometry/support/MeshMaterial";
import MeshLocalVertexSpace from "@arcgis/core/geometry/support/MeshLocalVertexSpace";

/** Мэшийн эх цэг ба торны алхам */
export interface PitGrid {
  lon: number; lat: number; z: number;
  /** Эх цэгийн UTM 48N координат, м */
  x0: number; y0: number;
  cell: number;
}

/** Торны мөж: орой (i, j) нь эх цэгээс зүүн тийш (i0 + i)·cell, хойд тийш (j0 + j)·cell */
interface Frame extends PitGrid { i0: number; j0: number; w: number; h: number }

export async function loadPitGrid(url = "/data/pit_grid.json"): Promise<PitGrid> {
  const j = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  });
  return { lon: j.lon, lat: j.lat, z: j.z, x0: j.x0, y0: j.y0, cell: j.cell };
}

/** Сарын гадаргууг AGOL-оос татаж, 5 м-ийн торонд буулгасан мэш (бүтэн хүрээгээр) */
export async function fetchPitMesh(featureUrl: string, grid: PitGrid): Promise<Mesh> {
  const q = new URLSearchParams({
    where: "1=1", outFields: "FID", returnGeometry: "true", returnZ: "true",
    multipatchOption: "externalizeTextures", f: "json",
  });
  const res = await fetch(`${featureUrl}/query?${q}`);
  if (!res.ok) throw new Error(`${featureUrl}: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${featureUrl}: ${json.error.message ?? json.error.code}`);
  const geoms: string[] = (json.features ?? [])
    .map((f: any) => f.geometry?.binaryPatches).filter(Boolean);
  if (!geoms.length) throw new Error(`${featureUrl}: multipatch олдсонгүй`);

  const patches = await Promise.all(geoms.map(readMultipatch));
  /* Тор — давхаргын бүх цэгийг хамарсан, эх цэгийн 5 м-ийн торон дээр */
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const mp of patches) {
    for (let k = 0; k < mp.x.length; k++) {
      const u = (mp.x[k] - grid.x0) / grid.cell, v = (mp.y[k] - grid.y0) / grid.cell;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
  }
  const i0 = Math.ceil(u0), j0 = Math.ceil(v0);
  const g: Frame = { ...grid, i0, j0, w: Math.floor(u1) - i0 + 1, h: Math.floor(v1) - j0 + 1 };
  const zg = new Float64Array(g.w * g.h).fill(NaN);
  for (const mp of patches) rasterize(mp, g, zg);
  return buildMesh(g, zg);
}

interface Multipatch { parts: Int32Array; types: Int32Array; x: Float64Array; y: Float64Array; z: Float64Array }

async function readMultipatch(b64: string): Promise<Multipatch> {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  /* Толгойн дараах zlib урсгалын эхлэл (CMF 0x78, FCHECK-ээр шалгана) */
  let s = -1;
  for (let i = 0; i < Math.min(raw.length - 1, 64); i++) {
    if (raw[i] === 0x78 && ((raw[i] << 8) | raw[i + 1]) % 31 === 0) { s = i; break; }
  }
  if (s < 0) throw new Error("multipatch: zlib урсгал олдсонгүй");
  const stream = new Blob([raw.subarray(s)]).stream().pipeThrough(new DecompressionStream("deflate"));
  const dv = new DataView(await new Response(stream).arrayBuffer());

  /* shapefile-ийн MultiPatch: төрөл, хүрээ (4 double), nParts, nPoints,
     parts[], partTypes[], XY[], Z-ийн муж (2 double), Z[] */
  const nParts = dv.getInt32(36, true), nPts = dv.getInt32(40, true);
  let o = 44;
  const parts = new Int32Array(nParts), types = new Int32Array(nParts);
  for (let k = 0; k < nParts; k++, o += 4) parts[k] = dv.getInt32(o, true);
  for (let k = 0; k < nParts; k++, o += 4) types[k] = dv.getInt32(o, true);
  const x = new Float64Array(nPts), y = new Float64Array(nPts), z = new Float64Array(nPts);
  for (let k = 0; k < nPts; k++, o += 16) { x[k] = dv.getFloat64(o, true); y[k] = dv.getFloat64(o + 8, true); }
  o += 16;
  for (let k = 0; k < nPts; k++, o += 8) z[k] = dv.getFloat64(o, true);
  return { parts, types, x, y, z };
}

/** Гурвалжин бүрийн дотор орших торны оройд өндрийг (дээд гадаргуу) бичнэ */
function rasterize(mp: Multipatch, g: Frame, zg: Float64Array) {
  const n = mp.z.length;
  /* UTM → торны нэгж (i, j) */
  const u = new Float64Array(n), v = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    u[k] = (mp.x[k] - g.x0) / g.cell - g.i0;
    v[k] = (mp.y[k] - g.y0) / g.cell - g.j0;
  }
  const tri = (a: number, b: number, c: number) => {
    const ua = u[a], va = v[a], ub = u[b], vb = v[b], uc = u[c], vc = v[c];
    const den = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc);
    if (Math.abs(den) < 1e-12) return;
    const i0 = Math.max(0, Math.ceil(Math.min(ua, ub, uc)));
    const i1 = Math.min(g.w - 1, Math.floor(Math.max(ua, ub, uc)));
    const j0 = Math.max(0, Math.ceil(Math.min(va, vb, vc)));
    const j1 = Math.min(g.h - 1, Math.floor(Math.max(va, vb, vc)));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const idx = j * g.w + i;
        const l1 = ((vb - vc) * (i - uc) + (uc - ub) * (j - vc)) / den;
        const l2 = ((vc - va) * (i - uc) + (ua - uc) * (j - vc)) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const zz = l1 * mp.z[a] + l2 * mp.z[b] + l3 * mp.z[c];
        if (!(zg[idx] >= zz)) zg[idx] = zz;
      }
    }
  };
  const { parts, types } = mp;
  for (let p = 0; p < parts.length; p++) {
    const s = parts[p], e = p + 1 < parts.length ? parts[p + 1] : n;
    switch (types[p] & 0xf) {
      case 0: for (let k = s; k + 2 < e; k++) tri(k, k + 1, k + 2); break;     // strip
      case 1: for (let k = s + 1; k + 1 < e; k++) tri(s, k, k + 1); break;     // fan
      case 5: for (let k = s; k + 2 < e; k += 3) tri(k, k + 1, k + 2); break;  // triangles
      default: break;                                                         // цагираг — гадаргуу биш
    }
  }
}

/** Утгатай оройнуудаас 5 м-ийн нүд бүрт 2 гурвалжин (дөрвөн булан нь утгатай үед) */
function buildMesh(g: Frame, zg: Float64Array): Mesh {
  const vid = new Int32Array(zg.length).fill(-1);
  const pos: number[] = [];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i;
      if (!Number.isFinite(zg[k])) continue;
      vid[k] = pos.length / 3;
      pos.push((g.i0 + i) * g.cell, (g.j0 + j) * g.cell, zg[k] - g.z);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j + 1 < g.h; j++) {
    for (let i = 0; i + 1 < g.w; i++) {
      const a = vid[j * g.w + i], b = vid[j * g.w + i + 1];
      const c = vid[(j + 1) * g.w + i + 1], d = vid[(j + 1) * g.w + i];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      idx.push(a, b, c, a, c, d);                    // дээрээс харахад цагийн зүүний эсрэг
    }
  }
  if (!idx.length) throw new Error("multipatch-аас гадаргуу үүссэнгүй");
  return new Mesh({
    spatialReference: SpatialReference.WGS84,
    vertexSpace: new MeshLocalVertexSpace({ origin: [g.lon, g.lat, g.z] }),
    vertexAttributes: { position: new Float64Array(pos) },
    /* GLB-ийн материалтай ижил шаргал өнгө (baseColorFactor 0.78, 0.62, 0.44) —
       оройн өнгөтэй (lib/pitSurface.ts) үржигдэж байгалийн өнгө өгнө */
    components: [new MeshComponent({
      faces: new Uint32Array(idx), shading: "flat",
      material: new MeshMaterial({ color: [199, 158, 112, 1] }),
    })],
  });
}
