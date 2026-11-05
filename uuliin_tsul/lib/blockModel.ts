/* ==========================================================================
   Олборлосон блокийн загвар — хөтөч дээр мэш үүсгэх, зүсэх, блок хайх
   --------------------------------------------------------------------------
   tools/build_block_mesh.py нь сар бүрийн блокийг (байрлал, хэмжээ, Cu, Mo,
   нягт, геологийн код) blocks_NN.bin-д бичдэг. Энд тэдгээрийг 5×5×3.75 м-ийн
   нүдний торонд буулгаж, зөвхөн ХООСОН (эсвэл зүсэлтээр хасагдсан) нүдтэй
   хиллэсэн талуудыг зурна. Зүсэлт өөрчлөгдөх бүрт талуудыг дахин тооцдог
   тул зүссэн нүүр нь доторх блокуудын өнгөөр БҮТЭН харагдана — ArcGIS-ийн
   Slice шиг хөндий бүрхүүл үлдэхгүй.
   ========================================================================== */
import Mesh from "@arcgis/core/geometry/Mesh";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import MeshComponent from "@arcgis/core/geometry/support/MeshComponent";
import MeshLocalVertexSpace from "@arcgis/core/geometry/support/MeshLocalVertexSpace";
import type { Lang } from "./i18n";

export interface BlockClass { min: number; color: string }

export interface BlockMonthInfo {
  url: string; lon: number; lat: number; z: number;
  from: number; to: number; blocks: number;
  /** Торны хэмжээ (нүдээр): i, j, k */
  dims: [number, number, number];
  /** Торны (0,0,0) булан — эх цэгээс зүүн, хойд, дээш метрээр */
  base: [number, number, number];
  /** Нэг нүдний i / j алхам — зүүн, хойд метрээр (эргүүлсэн тор) */
  axisI: [number, number]; axisJ: [number, number];
  /** k = 0 нүдний доод өндөр (RL, м) */
  rl0: number;
  /** Торны (0,0,0) нүдний Micromine-ийн торны индекс */
  lo?: [number, number, number];
  /** Хуваарилалтын огноо (Assign2023), жишээ нь "20230203" */
  assign?: string | null;
  kt: number; km3: number; cu: number; mo: number; share: number[];
}

export interface BlockModelMeta {
  classes: BlockClass[];
  domains: string[]; types: string[]; rclass: string[];
  projects?: string[];
  cell: [number, number, number];
  /** Micromine-ийн локал тор: эх цэг, эргүүлэх тэнхлэг, өнцөг (локал → UTM) */
  grid?: { origin: [number, number, number]; pivot: [number, number]; rot: number };
  months: Record<string, BlockMonthInfo>;
}

export interface BlockData {
  info: BlockMonthInfo;
  n: number;
  cu: Float32Array; mo: Float32Array; bd: Float32Array;
  i: Uint16Array; j: Uint16Array; k: Uint16Array;
  di: Uint8Array; dj: Uint8Array; dk: Uint8Array;
  dom: Uint8Array; typ: Uint8Array; rc: Uint8Array;
  /** Нэмэлт талбарууд (хуучин .bin-д байхгүй бол null) */
  cui: Float32Array | null; cuo: Float32Array | null; cuoi: Float32Array | null;
  proj: Uint8Array | null;
  /** Cu агуулгын ангиллын индекс */
  cls: Uint8Array;
  /** Нүдний шугаман индекс -> блокийн индекс */
  cells: Map<number, number>;
}

/** Зүсэлт: `z` — хэвтээ (дээрээс нь хуулна), `i` — дагуу, `j` — хөндлөн.
 *  `pos` нь 0..1 (тэнхлэгийн дагуух байрлал), `slab` үед зөвхөн нэг үе. */
export type SliceMode = "off" | "z" | "i" | "j";
export interface BlockSlice { mode: SliceMode; pos: number; slab: boolean }
export const NO_SLICE: BlockSlice = { mode: "off", pos: 1, slab: false };
/** «Нэг үе»-ийн зузаан, нүдээр: шат 15 м (4 × 3.75), хөндлөн 20 м (4 × 5) */
export const SLAB_CELLS = 4;

export async function loadBlockData(meta: BlockModelMeta, info: BlockMonthInfo): Promise<BlockData> {
  const buf = await fetch(info.url).then((r) => {
    if (!r.ok) throw new Error(`${info.url}: ${r.status}`);
    return r.arrayBuffer();
  });
  const n = info.blocks;
  let off = 0;
  const f32 = () => { const a = new Float32Array(buf, off, n); off += 4 * n; return a; };
  const u16 = () => { const a = new Uint16Array(buf, off, n); off += 2 * n; return a; };
  const u8 = () => { const a = new Uint8Array(buf, off, n); off += n; return a; };
  const cu = f32(), mo = f32(), bd = f32();
  const i = u16(), j = u16(), k = u16();
  const di = u8(), dj = u8(), dk = u8(), dom = u8(), typ = u8(), rc = u8();
  const extra = buf.byteLength >= off + 13 * n;
  const cui = extra ? f32() : null, cuo = extra ? f32() : null, cuoi = extra ? f32() : null;
  const proj = extra ? u8() : null;

  const mins = meta.classes.map((c) => c.min);
  const cls = new Uint8Array(n);
  for (let b = 0; b < n; b++) {
    let c = 0;
    while (c + 1 < mins.length && cu[b] >= mins[c + 1]) c++;
    cls[b] = c;
  }

  const [nx, ny] = info.dims;
  const cells = new Map<number, number>();
  for (let b = 0; b < n; b++) {
    for (let c = 0; c < dk[b]; c++)
      for (let bb = 0; bb < dj[b]; bb++)
        for (let a = 0; a < di[b]; a++)
          cells.set(((k[b] + c) * ny + (j[b] + bb)) * nx + (i[b] + a), b);
  }
  return { info, n, cu, mo, bd, i, j, k, di, dj, dk, dom, typ, rc, cui, cuo, cuoi, proj, cls, cells };
}

/** Зүсэлтийн хязгаар (нүдээр) — [lo, hi) мужид байгаа нүд л үлдэнэ */
function sliceRange(info: BlockMonthInfo, s: BlockSlice): { axis: number; lo: number; hi: number } | null {
  if (s.mode === "off") return null;
  const axis = s.mode === "i" ? 0 : s.mode === "j" ? 1 : 2;
  const hi = Math.round(Math.min(Math.max(s.pos, 0), 1) * info.dims[axis]);
  return { axis, lo: s.slab ? hi - SLAB_CELLS : -Infinity, hi };
}

/** Зүсэлтийн байрлалын хүний уншихуйц утга: RL (м) эсвэл тэнхлэгийн дагуух зай (м) */
export function sliceValue(info: BlockMonthInfo, meta: BlockModelMeta, s: BlockSlice): number {
  const r = sliceRange(info, s);
  if (!r) return 0;
  return r.axis === 2 ? info.rl0 + r.hi * meta.cell[2] : r.hi * meta.cell[r.axis];
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/* Нүдний тал бүрийн 4 булан (нүдний нэгжээр), гадагшаа харсан CCW эрэмбээр.
   Тэнхлэг: 0 = i, 1 = j, 2 = k (дээш) */
const FACES: [[number, number, number], [number, number, number][]][] = [
  [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
];

/** Зүсэлтийг тооцож гадна талын мэш үүсгэнэ. Харагдах нүд байхгүй бол null. */
export function buildBlockMesh(data: BlockData, meta: BlockModelMeta, slice: BlockSlice): Mesh | null {
  const { info, cells, cls } = data;
  const [nx, ny, nz] = info.dims;
  const [bE, bN, bU] = info.base;
  const [iE, iN] = info.axisI, [jE, jN] = info.axisJ;
  const cz = meta.cell[2];
  const r = sliceRange(info, slice);
  const inside = (c: number[]) => !r || (c[r.axis] >= r.lo && c[r.axis] < r.hi);
  const palette = meta.classes.map((c) => rgb(c.color));

  /* Талын нормаль — эргүүлсэн торны тэнхлэгүүдийн нэгж вектор */
  const li = Math.hypot(iE, iN), lj = Math.hypot(jE, jN);
  const axisN = [[iE / li, iN / li, 0], [jE / lj, jN / lj, 0], [0, 0, 1]];

  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  const c = [0, 0, 0], nb = [0, 0, 0];
  cells.forEach((b, key) => {
    c[0] = key % nx;
    const rest = (key - c[0]) / nx;
    c[1] = rest % ny;
    c[2] = (rest - c[1]) / ny;
    if (!inside(c)) return;
    const [cr, cg, cb] = palette[cls[b]];
    for (const [d, corners] of FACES) {
      nb[0] = c[0] + d[0]; nb[1] = c[1] + d[1]; nb[2] = c[2] + d[2];
      const inGrid = nb[0] >= 0 && nb[1] >= 0 && nb[2] >= 0 && nb[0] < nx && nb[1] < ny && nb[2] < nz;
      if (inGrid && inside(nb) && cells.has((nb[2] * ny + nb[1]) * nx + nb[0])) continue;
      const ax = d[0] ? 0 : d[1] ? 1 : 2, sg = d[ax];
      const v0 = pos.length / 3;
      for (const [a, bb, cc] of corners) {
        const fi = c[0] + a, fj = c[1] + bb;
        pos.push(bE + fi * iE + fj * jE, bN + fi * iN + fj * jN, bU + (c[2] + cc) * cz);
        nrm.push(axisN[ax][0] * sg, axisN[ax][1] * sg, axisN[ax][2] * sg);
        col.push(cr, cg, cb, 255);
      }
      idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
  });
  if (!idx.length) return null;

  return new Mesh({
    spatialReference: SpatialReference.WGS84,
    vertexSpace: new MeshLocalVertexSpace({ origin: [info.lon, info.lat, info.z] }),
    vertexAttributes: {
      position: new Float64Array(pos),
      normal: new Float32Array(nrm),
      color: new Uint8Array(col),
    },
    components: [new MeshComponent({ faces: new Uint32Array(idx), shading: "flat" })],
  });
}

/** Эх цэгээс зүүн/хойд/дээш метрээр өгсөн цэгт байгаа блок (зүсэлтээр
 *  хасагдсаныг тооцохгүй). Олдохгүй бол -1. */
export function blockAt(data: BlockData, meta: BlockModelMeta, slice: BlockSlice,
                        e: number, n: number, u: number): number {
  const { info } = data;
  const [nx, ny, nz] = info.dims;
  const de = e - info.base[0], dn = n - info.base[1];
  const [iE, iN] = info.axisI, [jE, jN] = info.axisJ;
  const ci = Math.floor((de * iE + dn * iN) / (iE * iE + iN * iN));
  const cj = Math.floor((de * jE + dn * jN) / (jE * jE + jN * jN));
  const ck = Math.floor((u - info.base[2]) / meta.cell[2]);
  if (ci < 0 || cj < 0 || ck < 0 || ci >= nx || cj >= ny || ck >= nz) return -1;
  const r = sliceRange(info, slice);
  if (r) {
    const v = [ci, cj, ck][r.axis];
    if (v < r.lo || v >= r.hi) return -1;
  }
  return data.cells.get((ck * ny + cj) * nx + ci) ?? -1;
}

/* ------------------------------------------------------------ нэршил */
export const BLOCK_TEXT = {
  mn: {
    classes: ["Хоосон чулуулаг", "Бага агуулгатай хүдэр", "Дунд агуулгатай хүдэр",
              "Өндөр агуулгатай хүдэр", "Маш өндөр агуулгатай хүдэр"],
    domains: { diss_cu: "Тархмал Cu", stw_cu: "Штокверк Cu", mixed_cu: "Холимог Cu",
               mixed_py: "Холимог пирит", py: "Пирит", leach_cap: "Уусгалтын малгай" } as Record<string, string>,
    types: { fr: "Анхдагч", tr: "Шилжилтийн", ox: "Исэлдсэн" } as Record<string, string>,
    rclass: { mea: "Батлагдсан", ind: "Тодорхойлсон", inf: "Таамагласан", min_pot: "Боломжит" } as Record<string, string>,
    zone: "Исэлдлийн бүс", domain: "Геологийн домэйн", rclassL: "Нөөцийн ангилал",
    density: "Нягт", densityU: "т/м³", mass: "Масс", massU: "т", size: "Хэмжээ",
    hint: "Cu ≥ 0.25 % — хүдэр, < 0.25 % — хоосон чулуулаг",
    clickHint: "Дарж бүх мэдээллийг харна",
    projects: { NW: "Баруун хойд", CEN: "Төв" } as Record<string, string>,
    gGeneral: "Ерөнхий", gGrade: "Агуулга", gGeology: "Геологи", gMass: "Хэмжээ, масс", gPos: "Байрлал",
    period: "Хугацаа", assign: "Хуваарилсан огноо", project: "Уурхайн хэсэг", cuClass: "Cu ангилал",
    cu: "Cu агуулга", mo: "Mo агуулга", cuo: "Исэлдсэн Cu", cuoi: "Исэлдлийн индекс", cui: "CUI",
    volume: "Эзлэхүүн", cuMetal: "Cu металл", moMetal: "Mo металл",
    local: "Micromine тор", utm: "UTM 48N", rl: "Өндөр (RL)",
  },
  en: {
    classes: ["Waste rock", "Low-grade ore", "Medium-grade ore", "High-grade ore", "Very high-grade ore"],
    domains: { diss_cu: "Disseminated Cu", stw_cu: "Stockwork Cu", mixed_cu: "Mixed Cu",
               mixed_py: "Mixed pyrite", py: "Pyrite", leach_cap: "Leach cap" } as Record<string, string>,
    types: { fr: "Fresh", tr: "Transitional", ox: "Oxide" } as Record<string, string>,
    rclass: { mea: "Measured", ind: "Indicated", inf: "Inferred", min_pot: "Mineral potential" } as Record<string, string>,
    zone: "Oxidation zone", domain: "Geological domain", rclassL: "Resource class",
    density: "Density", densityU: "t/m³", mass: "Mass", massU: "t", size: "Size",
    hint: "Cu ≥ 0.25 % is ore, < 0.25 % is waste rock",
    clickHint: "Click for all attributes",
    projects: { NW: "North-west", CEN: "Central" } as Record<string, string>,
    gGeneral: "General", gGrade: "Grade", gGeology: "Geology", gMass: "Size & mass", gPos: "Position",
    period: "Period", assign: "Assigned", project: "Pit area", cuClass: "Cu class",
    cu: "Cu grade", mo: "Mo grade", cuo: "Oxide Cu", cuoi: "Oxidation index", cui: "CUI",
    volume: "Volume", cuMetal: "Cu metal", moMetal: "Mo metal",
    local: "Micromine grid", utm: "UTM 48N", rl: "Elevation (RL)",
  },
} satisfies Record<Lang, unknown>;

export interface BlockDetailRow { label: string; code?: string; value: string; color?: string }
export interface BlockDetail {
  /** Сонголтыг ялгах түлхүүр — ижил блок дээр дахин дарахад цуцлагдана */
  id: string;
  title: string;
  color: string;
  sub: string;
  groups: { title: string; rows: BlockDetailRow[] }[];
}

/** Нэг блокийн БҮХ талбар — блок дээр дарахад зүүн талын картад харуулна */
export function blockDetail(data: BlockData, meta: BlockModelMeta, b: number, lang: Lang,
                            roman: string[], fmt: (v: number, d?: number) => string): BlockDetail {
  const tx = BLOCK_TEXT[lang];
  const info = data.info, cell = meta.cell, c = data.cls[b];
  const sx = data.di[b] * cell[0], sy = data.dj[b] * cell[1], sz = data.dk[b] * cell[2];
  const vol = sx * sy * sz, mass = vol * data.bd[b];
  const rl = info.rl0 + data.k[b] * cell[2];
  const pct = (v: number, d: number) => `${v.toFixed(d)} %`;
  const color = meta.classes[c]?.color ?? "#888";
  const period = `${roman[info.from] ?? info.from} → ${roman[info.to] ?? info.to}`;

  const general: BlockDetailRow[] = [
    { label: tx.period, value: period },
    { label: tx.cuClass, value: tx.classes[c] ?? "—", color },
  ];
  if (info.assign) {
    const a = info.assign;
    general.push({ label: tx.assign, code: "Assign2023", value: `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}` });
  }
  if (data.proj && meta.projects) {
    const p = meta.projects[data.proj[b]];
    general.push({ label: tx.project, code: "Project", value: p ? `${tx.projects[p] ?? p} (${p})` : "—" });
  }

  const grade: BlockDetailRow[] = [
    { label: tx.cu, code: "CU_OK", value: pct(data.cu[b], 3), color },
    { label: tx.mo, code: "MO_OK", value: pct(data.mo[b], 4) },
  ];
  if (data.cuo) grade.push({ label: tx.cuo, code: "CUO", value: pct(data.cuo[b], 4) });
  if (data.cuoi) grade.push({ label: tx.cuoi, code: "CUOI", value: pct(data.cuoi[b], 2) });
  if (data.cui) grade.push({ label: tx.cui, code: "CUI", value: pct(data.cui[b], 4) });

  const code = (list: string[], v: number) => list[v] ?? "";
  const geology: BlockDetailRow[] = [
    { label: tx.zone, code: "TYPE", value: named(tx.types, code(meta.types, data.typ[b])) },
    { label: tx.domain, code: "DOMAIN", value: named(tx.domains, code(meta.domains, data.dom[b])) },
    { label: tx.rclassL, code: "CLASS", value: named(tx.rclass, code(meta.rclass, data.rc[b])) },
  ];

  const massRows: BlockDetailRow[] = [
    { label: tx.size, code: "_EAST × _NORTH × _RL", value: `${sx} × ${sy} × ${sz} м` },
    { label: tx.volume, value: `${fmt(vol, 0)} м³` },
    { label: tx.density, code: "BD", value: `${data.bd[b].toFixed(3)} ${tx.densityU}` },
    { label: tx.mass, value: `${fmt(mass, 0)} ${tx.massU}` },
    { label: tx.cuMetal, value: `${fmt(mass * data.cu[b] / 100, 1)} ${tx.massU}` },
    { label: tx.moMetal, value: `${fmt(mass * data.mo[b] / 100 * 1000, 0)} кг` },
  ];

  const pos: BlockDetailRow[] = [{ label: tx.rl, code: "RL", value: `${fmt(rl, 2)}–${fmt(rl + sz, 2)} м` }];
  if (meta.grid && info.lo) {
    const g = meta.grid;
    const e = g.origin[0] + (info.lo[0] + data.i[b]) * cell[0] + sx / 2;
    const n = g.origin[1] + (info.lo[1] + data.j[b]) * cell[1] + sy / 2;
    const r = (g.rot * Math.PI) / 180, dx = e - g.pivot[0], dy = n - g.pivot[1];
    const ue = g.pivot[0] + dx * Math.cos(r) - dy * Math.sin(r);
    const un = g.pivot[1] + dx * Math.sin(r) + dy * Math.cos(r);
    pos.push(
      { label: tx.local, code: "EAST / NORTH", value: `${e.toFixed(1)} / ${n.toFixed(1)}` },
      { label: tx.utm, code: "E / N", value: `${ue.toFixed(1)} / ${un.toFixed(1)}` },
    );
  }

  return {
    id: `${info.to}:${b}`,
    title: tx.classes[c] ?? "—",
    color,
    sub: `${period} · RL ${fmt(rl, 0)}–${fmt(rl + sz, 0)} м · Cu ${data.cu[b].toFixed(3)} %`,
    groups: [
      { title: tx.gGeneral, rows: general },
      { title: tx.gGrade, rows: grade },
      { title: tx.gGeology, rows: geology },
      { title: tx.gMass, rows: massRows },
      { title: tx.gPos, rows: pos },
    ],
  };
}

function named(dict: Record<string, string>, key: string): string {
  if (!key) return "—";
  return dict[key] ? `${dict[key]} (${key})` : key;
}
