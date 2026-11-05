/* ==========================================================================
   Excel «Нийт орд arcgis» — асуулгууд
   Түлхүүр: "Сар|Түвшин|Блок",  утга: 15 баганын массив × 5 үзүүлэлт
   ========================================================================== */
import raw from "@/public/data/excel.json";
import { C } from "./config";

type Measure = "kt" | "cu" | "cut" | "mo" | "mot";
type Group = Record<Measure, number[]>;

const G = raw as unknown as Record<string, Group>;

const KEYS = Object.keys(G);

/** Тухайн сарын бүх түлхүүр */
function keysOf(m: number): string[] {
  return KEYS.filter((k) => parseInt(k, 10) === m);
}

export function grp(m: number, tuv: number, blk: string): Group | null {
  return G[`${m}|${tuv}|${blk}`] ?? null;
}

/** Тухайн сар + түвшинд байгаа «Блок»-ууд (БҮ эхэнд) */
export function blocksAt(m: number, tuv: number): string[] {
  const out: string[] = [];
  for (const k of KEYS) {
    const p = k.split("|");
    if (+p[0] === m && +p[1] === tuv) out.push(p[2]);
  }
  return out.sort((a, b) => (a === "БҮ" ? -1 : b === "БҮ" ? 1 : a.localeCompare(b)));
}

/** Тухайн сард хөдөлгөөнтэй байсан түвшингүүд — дээрээс доош */
export function benchesOf(m: number): number[] {
  const s = new Set<number>();
  for (const k of keysOf(m)) s.add(+k.split("|")[1]);
  return [...s].sort((a, b) => b - a);
}

/** Баганын нийлбэр. tuv өгвөл зөвхөн тэр түвшингээр. */
export function sumCol(m: number, ci: number, tuv?: number): number {
  let t = 0;
  for (const k of keysOf(m)) {
    if (tuv !== undefined && +k.split("|")[1] !== tuv) continue;
    t += G[k].kt[ci];
  }
  return t;
}

export function metalSum(m: number, which: Measure, ci: number, tuv?: number): number {
  let t = 0;
  for (const k of keysOf(m)) {
    if (tuv !== undefined && +k.split("|")[1] !== tuv) continue;
    t += G[k][which][ci];
  }
  return t;
}

/** Жигнэсэн Cu агуулга, % — металл / (тонн × 1000) */
export function cuOf(m: number, tuv?: number): number {
  const kt = sumCol(m, C.NIIT, tuv);
  return kt > 0 ? (metalSum(m, "cut", C.NIIT, tuv) / (kt * 1000)) * 100 : 0;
}

export function moOf(m: number, tuv?: number): number {
  const kt = sumCol(m, C.NIIT, tuv);
  return kt > 0 ? (metalSum(m, "mot", C.NIIT, tuv) / (kt * 1000)) * 100 : 0;
}

/** Доод зурвасын өгөгдөл: БҮ-т · овоолгод (балансын) · овоолгод (балансын бус) */
export function monthlyFlow(m: number, tuv?: number): [number, number, number] {
  return [
    sumCol(m, C.BU, tuv),
    sumCol(m, C.OV12, tuv) + sumCol(m, C.OV14, tuv) + sumCol(m, C.OV8A, tuv),
    sumCol(m, C.OV9A, tuv) + sumCol(m, C.OV9B, tuv),
  ];
}

/* ==========================================================================
   Cu агуулгын өнгөний ангилал — ӨГӨГДЛӨӨС тооцно
   --------------------------------------------------------------------------
   Урьд нь `gradeVar` дотор 0.15–0.50 гэсэн ГАРААР бичсэн шугаман муж байв.
   Excel-ийн бодит Cu муж 0.010–1.077: утгуудын 12.2 % нь 0.15-аас бага,
   8.5 % нь 0.50-аас их байсан тул тав тутмын нэг утга хамгийн цайвар эсвэл
   хамгийн бараан өнгөнд наалдаж, ялгаа нь бүрэн алдагдаж байсан.

   Тархалт нь баруун тийш хазайсан тул тэнцүү өргөнтэй муж биш КВАНТИЛИЙН
   ангилал ашиглана: 872 утгыг зургаан тэнцүү ТООТОЙ анги болгож хуваана
   (144–147 утга тус бүрд). Ямар ч утга хязгаарт наалдахгүй.
   ========================================================================== */
export const GRADE_BREAKS: number[] = (() => {
  const v: number[] = [];
  for (const k of KEYS) for (const c of G[k].cu) if (c > 0) v.push(c);
  v.sort((a, b) => a - b);
  if (v.length < 6) return [0.17, 0.24, 0.32, 0.38, 0.43];
  const q = (t: number) => v[Math.min(v.length - 1, Math.floor(t * v.length))];
  return [1, 2, 3, 4, 5].map((i) => q(i / 6));
})();

/** Хамгийн бага / их Cu утга — тайлбарын үзүүрт */
export const GRADE_RANGE: [number, number] = (() => {
  const v: number[] = [];
  for (const k of KEYS) for (const c of G[k].cu) if (c > 0) v.push(c);
  if (!v.length) return [0, 1];
  return [Math.min(...v), Math.max(...v)];
})();
