/* ==========================================================================
   Ил уурхайн сарын гадаргуугийн өнгө
   --------------------------------------------------------------------------
   · Байгалийн өнгө: хэвтээ шатны тавцан нь цайвар тоост саарал-шаргал,
     эгц хана нь бараан хүрэн-саарал (уурхайн агаарын зураг дээрх шиг).
     Налууг өндрийн тороос тооцно; бага зэргийн санамсаргүй хэлбэлзэл нь
     гадаргууг хуванцар мэт жигд харагдуулахгүй.
   · Өөрчлөлт: өмнөх сарын хэмжилтээс өндөр нь `CHANGE_M`-ээс илүү
     өөрчлөгдсөн (ухсан эсвэл асгасан) талбайг улаанаар будна. Хэмжилтийн
     шуугиан (шатны ирмэг дагуух 1–2 м-ийн зөрүү) худал толбо үүсгэдэг тул:
     нэг нүдний нүхийг бөглөж (closing), `MIN_CELLS`-ээс жижиг толбыг хасна.
   Бүх сарын мэш нэг эх цэг, нэг 5 м-ийн DEM тороос үүссэн тул оройнууд
   нь сар хооронд яг ижил (x, y) дээр байрладаг — шууд харьцуулна.
   ========================================================================== */
import type Mesh from "@arcgis/core/geometry/Mesh";

/** Үүнээс бага өндрийн зөрүүг хэмжилтийн алдаа гэж үзнэ (м) */
export const CHANGE_M = 2.0;
/** Үүнээс жижиг тусгаар толбыг хасна (5 м нүдээр — 40 нүд = 0.1 га) */
const MIN_CELLS = 40;

const BENCH = [192, 188, 179];   // тавцан — тоост цайвар саарал
const FACE = [124, 116, 106];    // хана — бараан хүрэн-саарал
const RED = [227, 52, 44];

/** «Нийт» горимд сар бүрийн өөрчлөлтийн өнгө — хуучнаас шинэ рүү шар → ягаан */
export const MONTH_COLORS: Record<number, [number, number, number]> = {
  2: [255, 210, 63],
  3: [255, 159, 28],
  4: [242, 92, 42],
  5: [215, 38, 61],
  6: [181, 23, 158],
};

export interface PitColors {
  /** Байгалийн өнгө */
  base: Uint8Array;
  /** Өөрчлөлтийг улаанаар тодруулсан өнгө (өмнөх сар байхгүй бол null) */
  change: Uint8Array | null;
  /** Өөрчлөгдсөн талбай, га */
  changedHa: number;
  /** Өөрчлөгдсөн нүднүүдийн түлхүүр (`key`) — «Нийт» горимд нэгтгэнэ */
  mask: Set<number> | null;
  /** Торны алхам, м */
  cell: number;
}

const key = (gx: number, gy: number) => (gx + 32768) * 65536 + (gy + 32768);

function gridStep(pos: ArrayLike<number>): number {
  let cell = Infinity;
  for (let i = 3; i < Math.min(pos.length, 30000); i += 3) {
    const d = Math.abs(pos[i] - pos[i - 3]);
    if (d > 0.01 && d < cell) cell = d;
  }
  return Number.isFinite(cell) ? cell : 5;
}

function heights(pos: ArrayLike<number>, cell: number): Map<number, number> {
  const h = new Map<number, number>();
  for (let i = 0; i < pos.length; i += 3) {
    h.set(key(Math.round(pos[i] / cell), Math.round(pos[i + 1] / cell)), pos[i + 2]);
  }
  return h;
}

export function pitColors(mesh: Mesh, prev: Mesh | null): PitColors {
  const pos = mesh.vertexAttributes.position;
  const nv = pos.length / 3;
  const cell = gridStep(pos);
  const cur = heights(pos, cell);
  const old = prev ? heights(prev.vertexAttributes.position, cell) : null;

  const mask = old ? changeMask(pos, cell, cur, old) : null;

  const base = new Uint8Array(nv * 4);
  const change = old ? new Uint8Array(nv * 4) : null;
  let changed = 0;
  for (let v = 0; v < nv; v++) {
    const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
    const gx = Math.round(x / cell), gy = Math.round(y / cell);
    /* Налуу — хөрш оройнуудын өндрийн ялгаагаар (ирмэг дээр нэг талын) */
    const e = cur.get(key(gx + 1, gy)), w = cur.get(key(gx - 1, gy));
    const n = cur.get(key(gx, gy + 1)), s = cur.get(key(gx, gy - 1));
    const dx = e !== undefined && w !== undefined ? (e - w) / 2 : e !== undefined ? e - z : w !== undefined ? z - w : 0;
    const dy = n !== undefined && s !== undefined ? (n - s) / 2 : n !== undefined ? n - z : s !== undefined ? z - s : 0;
    const slope = Math.hypot(dx, dy) / cell;              // tan(налуу)
    const f = Math.min(Math.max((slope - 0.35) / 1.0, 0), 1);
    /* Тогтвортой «санамсаргүй» хэлбэлзэл (±5 %) — байрлалаас хамаарна */
    const hv = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
    const noise = 1 + (hv - Math.floor(hv) - 0.5) * 0.1;
    for (let c = 0; c < 3; c++) {
      base[4 * v + c] = Math.min(255, (BENCH[c] * (1 - f) + FACE[c] * f) * noise);
    }
    base[4 * v + 3] = 255;

    if (!mask || !change) continue;
    const hit = mask.has(key(gx, gy));
    for (let c = 0; c < 3; c++) change[4 * v + c] = hit ? RED[c] : base[4 * v + c];
    change[4 * v + 3] = 255;
  }
  return { base, change, changedHa: mask ? (mask.size * cell * cell) / 10000 : 0, mask, cell };
}

/** Бүх сарын өөрчлөлтийг нэг гадаргуу дээр — нүд бүрийг хамгийн сүүлд
 *  өөрчлөгдсөн сарын өнгөөр будна */
export function paintMonths(mesh: Mesh, base: Uint8Array,
                            masks: { month: number; mask: Set<number> }[]): Uint8Array {
  const pos = mesh.vertexAttributes.position;
  const cell = gridStep(pos);
  const out = base.slice();
  for (let v = 0; v < pos.length / 3; v++) {
    const k = key(Math.round(pos[3 * v] / cell), Math.round(pos[3 * v + 1] / cell));
    for (let i = masks.length - 1; i >= 0; i--) {
      if (!masks[i].mask.has(k)) continue;
      const c = MONTH_COLORS[masks[i].month] ?? RED;
      out[4 * v] = c[0]; out[4 * v + 1] = c[1]; out[4 * v + 2] = c[2];
      break;
    }
  }
  return out;
}

/** Өөрчлөгдсөн нүднүүд: |dz| > CHANGE_M → closing (1 нүд) → жижиг толбыг хасах */
function changeMask(pos: ArrayLike<number>, cell: number,
                    cur: Map<number, number>, old: Map<number, number>): Set<number> {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const gx = Math.round(pos[i] / cell), gy = Math.round(pos[i + 1] / cell);
    if (gx < x0) x0 = gx; if (gx > x1) x1 = gx;
    if (gy < y0) y0 = gy; if (gy > y1) y1 = gy;
  }
  const W = x1 - x0 + 3, H = y1 - y0 + 3;           // 1 нүдний хүрээтэй
  const at = (gx: number, gy: number) => (gy - y0 + 1) * W + (gx - x0 + 1);
  let g = new Uint8Array(W * H);
  cur.forEach((z, k) => {
    const zp = old.get(k);
    if (zp === undefined || Math.abs(zp - z) <= CHANGE_M) return;
    const gx = Math.floor(k / 65536) - 32768, gy = (k % 65536) - 32768;
    g[at(gx, gy)] = 1;
  });
  /* 3×3 тэлэх, дараа нь агшаах — нэг нүдний нүх, ан цавыг бөглөнө */
  const morph = (src: Uint8Array, all: boolean) => {
    const out = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let n = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) n += src[(y + b) * W + x + a];
      out[y * W + x] = all ? +(n === 9) : +(n > 0);
    }
    return out;
  };
  g = morph(morph(g, false), true);
  /* Холбогдсон толбо бүрийн хэмжээ (4 хөрш) — жижгийг хасна */
  const out = new Set<number>();
  const seen = new Uint8Array(W * H);
  const stack: number[] = [], comp: number[] = [];
  for (let s = 0; s < g.length; s++) {
    if (!g[s] || seen[s]) continue;
    stack.push(s); seen[s] = 1; comp.length = 0;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      for (const d of [c - 1, c + 1, c - W, c + W]) {
        if (g[d] && !seen[d]) { seen[d] = 1; stack.push(d); }
      }
    }
    if (comp.length < MIN_CELLS) continue;
    for (const c of comp) out.add(key((c % W) - 1 + x0, Math.floor(c / W) - 1 + y0));
  }
  return out;
}
