import { ComponentProps, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  Area,
  ComposedChart,
  LabelList,
  ReferenceArea,
  ReferenceLine,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "../components/ui";
import { ChartPrefsCtx, ChartKind, useDashboard, useWidgetData } from "./context";
import {
  ACCENT,
  MAX_SERIES,
  PALETTE,
  compact,
  displayValue,
  fillTemplate,
  formatDate,
  formatNumber,
  rgba,
  sanitizeHtml,
  stripHtml,
} from "./format";
import type { ChartSeries, Field, QueryResult, Widget } from "./types";

// ---------------------------------------------------------------- frame

export function Panel({
  widget,
  children,
  loading,
  error,
  filtered,
  tight,
  expandable = true,
}: {
  widget: Widget;
  children: React.ReactNode;
  loading?: boolean;
  error?: string;
  filtered?: boolean;
  tight?: boolean;
  expandable?: boolean;
}) {
  const title = stripHtml(widget.topCaption ?? widget.caption ?? widget.title);
  const bottom = stripHtml(widget.bottomCaption);
  const [max, setMax] = useState(false);

  // Томруулсан үед Esc дарахад буцна
  useLayoutEffect(() => {
    if (!max) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMax(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [max]);

  return (
    <>
      {max && <div className="dw-backdrop" onClick={() => setMax(false)} />}
      <section className={`dw-panel ${tight ? "tight" : ""} ${max ? "maxed" : ""}`}>
        {title && (
          <header className="dw-title">
            {title}
            {filtered && <span className="dw-filtered" title="Шүүлтүүр идэвхтэй">●</span>}
          </header>
        )}
        {expandable && (
          <button
            className="dw-expand"
            onClick={() => setMax(!max)}
            title={max ? "Жижигрүүлэх (Esc)" : "Дэлгэц дүүрэн томруулах"}
            aria-label={max ? "Жижигрүүлэх" : "Томруулах"}
          >
            {max ? "✕" : "⛶"}
          </button>
        )}
        <div className="dw-body">
          {error ? (
            /хаалттай/i.test(error) ? (
              <div className="dw-msg" title={error}>🔒 Хаалттай өгөгдөл — ArcGIS нэвтрэх эрх шаардлагатай</div>
            ) : (
              <div className="dw-msg error">{error}</div>
            )
          ) : (
            children
          )}
          {loading && <div className="dw-loading" />}
        </div>
        {bottom && <footer className="dw-bottom">{bottom}</footer>}
      </section>
    </>
  );
}

const axis = { stroke: "var(--axis)", tick: { fill: "var(--text-muted)", fontSize: 10 }, tickLine: false } as const;

/** Утгын тэнхлэгийн жигд алхам: 1, 2, 2.5, 5 × 10^n, 5 орчим хуваалттай */
function tickStep(lo: number, hi: number): number {
  const rough = (hi - lo) / 5 || 1;
  const mag = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5].map((k) => k * mag).find((s) => s >= rough * (1 - 1e-9)) ?? 10 * mag;
}

function fieldMap(data: QueryResult | null): Record<string, Field> {
  return Object.fromEntries((data?.fields ?? []).map((f) => [f.name, f]));
}

function categoryLabel(w: Widget, raw: unknown, field?: Field): string {
  const ov = w.category?.labelOverrides?.find((o) => String(o.key) === String(raw));
  if (ov) return ov.label;
  if (raw === null || raw === undefined) return !w.category?.nullLabel || w.category.nullLabel === "null" ? "Хоосон" : w.category.nullLabel;
  if (typeof raw === "string" && raw.trim() === "") return !w.category?.blankLabel || w.category.blankLabel === "blank" ? "Хоосон" : w.category.blankLabel;
  if (w.parseDates || field?.type === "esriFieldTypeDate") return formatDate(raw);
  // Он, дугаар зэрэг бүхэл тоон ангилалд мянгатын таслал тавихгүй (1978, 1,978 биш)
  if (typeof raw === "number" && Number.isInteger(raw) && !field?.domain) return String(raw);
  return displayValue(raw, field);
}

/** Графикийн сонголт: категори дээр дарахад бусад виджетийг шүүнэ */
function useCategorySelection(widget: Widget, field: string | undefined) {
  const { selections, setSelection } = useDashboard();
  const sel = selections[widget.id];
  const selected = new Set((sel?.values ?? []).map((v) => String(v)));
  const canSelect = Boolean(field && widget.events?.length);
  const toggle = (raw: unknown) => {
    if (!canSelect || !field) return;
    const key = String(raw);
    const values = selected.has(key)
      ? (sel?.values ?? []).filter((v) => String(v) !== key)
      : [...(sel?.values ?? []), raw];
    setSelection(widget.id, values.length ? { field, op: "in", values } : null);
  };
  return { selected, toggle, canSelect };
}

// ---------------------------------------------------------------- indicator

const KPI_ICON_VALUE = 22; // дүрстэй KPI-н тооны дээд хэмжээ, px
const KPI_ICONS: Record<string, string> = {
  holes: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  depth: "M4 4h16M12 8v12M7 15l5 5 5-5",
  average: "M5 20v-7M12 20V6M19 20v-9M3 12h18",
  deepest: "M12 3v13M6 10l6 6 6-6M4 21h16",
  sample: "M6 3h12M8 3v14a4 4 0 0 0 8 0V3M8 11h8",
  hours: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  worked: "M5 12l5 5 9-10",
  idle: "M9 6v12M15 6v12",
  records: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  gauge: "M4 18a9 9 0 1 1 16 0M12 14l4-5",
  ore: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  rock: "M3 20l6-11 4 6 3-4 5 9z",
  metal: "M6 4h12l3 6-9 10L3 10zM3 10h18",
  grade: "M19 5L5 19M7 7h.01M17 17h.01",
  drop: "M12 3s6.5 6.6 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3z",
  area: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
};

/** Хоёр нийлбэрийн харьцаа (жишээ нь металл ÷ хүдэр = агуулга). Хуваагч хоосон бол утгагүй */
function ratioOf(row: Record<string, unknown>, r: NonNullable<NonNullable<Widget["chartConfig"]>["ratio"]>): number | null {
  const den = Number(row[r.den]);
  return den > 0 ? (Number(row[r.num]) / den) * r.factor : null;
}

/** Нийт дүнгээс хэсгүүдэд задраагүй үлдэгдэл (1-ээс бага зөрүү нь бөөрөнхийлөлт) */
function remainderOf(row: Record<string, unknown>, r: NonNullable<NonNullable<Widget["chartConfig"]>["remainder"]>): number | null {
  const left = (Number(row[r.total]) || 0) - r.parts.reduce((a, p) => a + (Number(row[p]) || 0), 0);
  return left > 1 ? left : null;
}

export function IndicatorWidget({ widget }: { widget: Widget }) {
  const { data, loading, error, filtered } = useWidgetData(widget);
  const row = data?.rows[0] ?? {};
  const statName = widget.datasets?.[0]?.statisticDefinitions?.[0]?.outStatisticFieldName;
  const ratio = widget.chartConfig?.ratio;
  let value = ratio ? ratioOf(row, ratio) : statName ? row[statName] : Object.values(row).find((v) => typeof v === "number");
  if (typeof value === "number" && widget.valueConversion) {
    value = value * (widget.valueConversion.factor ?? 1) + (widget.valueConversion.offset ?? 0);
  }
  const formatted = formatNumber(value, widget.valueFormat);
  const fill = (tpl?: string) =>
    stripHtml(
      (tpl ?? "").replace(/\{([^{}]+)\}/g, (_, k: string) =>
        k === "value" || k === "calculated/value" ? formatted : k in row ? displayValue(row[k]) : "",
      ),
    );
  const s = widget.defaultSettings ?? {};
  const top = fill(s.topSection?.textInfo?.text) || stripHtml(widget.topCaption);
  const middle = fill(s.middleSection?.textInfo?.text ?? "{value}") || formatted;
  const bottom = fill(s.bottomSection?.textInfo?.text);
  // Намхан картанд (үзүүлэлтийн мөрийг багасгасан) утгын үсгийг өндөрт нь тааруулж багтаана
  const [boxRef, box] = useSize<HTMLDivElement>();
  const low = box.h > 0 && box.h < 96;
  const valueSize = Math.max(12, Math.min(32, (box.h - (top ? 16 : 0) - (bottom ? 14 : 0) - 6) * 0.82));
  // Үсгийн хэмжээ картын өргөнөөр (CSS, cqi) — ижил өргөнтэй картууд ижил хэмжээтэй.
  // Тэгсэн ч урт утга багтахгүй бол зөвхөн тэр утгыг багасгана.
  const sizeCss = widget.icon ? `min(${valueSize}px, ${KPI_ICON_VALUE}px)` : low ? `min(${valueSize}px, 22cqi)` : undefined;
  const midRef = useRef<HTMLDivElement>(null);
  const [shrink, setShrink] = useState(1);
  useLayoutEffect(() => {
    const el = midRef.current;
    if (!el) return;
    // Үндсэн хэмжээгээр хэмжинэ (өмнөх багасгалтгүйгээр)
    const prev = el.style.fontSize;
    el.style.fontSize = sizeCss ?? "";
    const ratio = el.scrollWidth > el.clientWidth + 1 ? (el.clientWidth / el.scrollWidth) * 0.98 : 1;
    el.style.fontSize = prev;
    setShrink(ratio);
  }, [middle, box.w, box.h, sizeCss]);
  return (
    <Panel widget={{ ...widget, topCaption: undefined }} loading={loading} error={error} tight expandable={false}>
      <div className={`dw-indicator ${low ? "low" : ""}`} ref={boxRef}>
        {top && <div className="top">{top}{filtered && <span className="dw-filtered"> ●</span>}</div>}
        <div className={widget.icon ? `dw-ind-row${widget.iconWide ? " icon-wide" : ""}` : "dw-ind-plain"} style={widget.icon ? { fontSize: sizeCss } : undefined}>
          {widget.icon && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={KPI_ICONS[widget.icon]} />
            </svg>
          )}
          <div
            className="middle"
            ref={midRef}
            style={{ fontSize: shrink < 1 ? `calc(${sizeCss ?? "clamp(10px, 22cqi, 32px)"} * ${shrink.toFixed(3)})` : sizeCss }}
          >
            {loading && !data ? "…" : middle}
            {widget.unit && data && <small className="dw-unit"> {widget.unit}</small>}
          </div>
        </div>
        {bottom && <div className="bottom">{bottom}</div>}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- serial chart

type SeriesSpec = { key: string; name: string; kind: "bar" | "line"; color: string; title?: string };

/** Элементийн хэмжээг ажиглана — тайлбарыг (legend) самбарт багтаахад хэрэглэнэ */
function useSize<T extends HTMLElement>() {
  // callback ref — элемент дараа нь (өгөгдөл ирсний дараа) гарч ирсэн ч ажиглана
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

/** Тайлбарын хэдэн зүйл 2 мөрөнд багтахыг тооцоолно (текстийн өргөнийг ойролцоогоор) */
function fitInLines(names: string[], width: number, lines = 2): number {
  if (!width) return names.length;
  const itemW = (n: string) => 26 + n.length * 6.2; // тэмдэг + зай + текст (11px)
  const moreW = 44; // «+N» шошго
  let line = 1;
  let x = 0;
  for (let i = 0; i < names.length; i++) {
    const w = itemW(names[i]);
    const reserve = line === lines && i < names.length - 1 ? moreW : 0;
    if (x + w + reserve > width && x > 0) {
      if (line === lines) return i;
      line += 1;
      x = 0;
    }
    x += w;
  }
  return names.length;
}

/**
 * splitBy-ээр хувааж нэгтгэсэн мөрүүдийг ангиллаар нь эрэмбэлнэ. Хуваасан цуваа бүр өөр онуудаас
 * эхэлдэг тул нэгтгэсний дараа дараалал алдагддаг (жишээ нь 2025-ийн дараа 1979 гарах).
 * Dashboard-д заасан эрэмбийг (orderByFields) дагана, заагаагүй бол тоон ангиллыг өсөхөөр нь.
 */
function sortCategories(rows: Record<string, unknown>[], orderBy: string[] | undefined, xField: string | undefined) {
  const rules = (orderBy ?? []).map((o) => o.trim()).filter(Boolean);
  const rule = rules.find((o) => xField && o.split(/\s+/)[0] === xField);
  // Өөр талбараар (жишээ нь статистикийн утгаар) эрэмбэлсэн бол серверийн дарааллыг хэвээр үлдээнэ
  if (!rule && rules.length) return rows;
  const desc = rule ? /\sdesc$/i.test(rule) : false;
  const collator = new Intl.Collator("mn", { numeric: true, sensitivity: "base" });
  return [...rows].sort((a, b) => {
    const x = a.__x;
    const y = b.__x;
    if (x === null || x === undefined) return -1; // «Хоосон» эхэнд
    if (y === null || y === undefined) return 1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
    return desc ? -c : c;
  });
}

// Графикийн дүүргэлт хагас тунгалаг, хүрээ нь бүтэн өнгөтэй — бүтэн дүүргэлт хэрэглэхгүй
const FILL_ALPHA = 0.22;
const PIE_ALPHA = 0.35;
const swatch = (color: string): React.CSSProperties => ({
  background: `color-mix(in srgb, ${color} ${Math.round(FILL_ALPHA * 100)}%, transparent)`,
  boxShadow: `inset 0 0 0 1px ${color}`,
});

/** Хэвтээ графикийн ангиллын шошго — нэг мөрт, багтахгүй бол «…»-ээр таслана (хулгана очиход бүтэн нэр) */
function CatTick(props: { x?: number; y?: number; payload?: { value: unknown }; width: number; fontSize?: number }) {
  const { x = 0, y = 0, payload, width, fontSize = 10 } = props;
  const full = String(payload?.value ?? "");
  const max = Math.max(4, Math.floor((width - 10) / (fontSize * 0.58)));
  const text = full.length > max ? full.slice(0, max - 1) + "…" : full;
  return (
    <text x={x - 4} y={y} textAnchor="end" dominantBaseline="middle" fontSize={fontSize} fill="var(--text-muted)">
      <title>{full}</title>
      {text}
    </text>
  );
}

const NO_SELECTION = new Set<string>();

type Guide = { start: number; end?: number; label: string; color: string; left: boolean };

/** Утгын тэнхлэгийн заагч (стандартын хязгаар гэх мэт) — ArcGIS-ийн chartConfig.axes[].guides */
function guidesOf(widget: Widget): Guide[] {
  const out: Guide[] = [];
  for (const ax of widget.chartConfig?.axes ?? []) {
    if (ax.valueFormat?.type !== "number") continue;
    for (const g of ax.guides ?? []) {
      if (g.visible === false || typeof g.start !== "number") continue;
      const c = g.style?.color;
      // Улаан заагч = хязгаар — системийн «аюултай» өнгөөр; бусад нь өөрийн өнгөөр
      const red = c && c[0] > 180 && c[1] < 90 && c[2] < 90;
      out.push({
        start: g.start,
        end: typeof g.end === "number" && g.end !== g.start ? g.end : undefined,
        label: stripHtml(g.label?.text ?? ""),
        color: !c || red ? "var(--status-critical)" : rgba([c[0], c[1], c[2]]) ?? "var(--status-critical)",
        left: g.label?.horizontalAlignment === "left",
      });
    }
  }
  return out;
}

/** Төлөвлөгөөний (хүрээтэй зам) өнгө — гүйцэтгэл нь үндсэн ногоон */
const PLAN_COLOR = "#9aa8a4";

/** «Төлөвлөсөн» ба «Биелсэн/Гүйцэтгэл» хос баганан цувааг таньна */
function planActualOf(series: SeriesSpec[]): { plan: SeriesSpec; actual: SeriesSpec } | null {
  if (series.length !== 2 || series.some((s) => s.kind !== "bar")) return null;
  // Нэр («Өрөмдсөн» гэх мэт) танигдахгүй бол талбарын нэрээр («Measured») шалгана
  const plan = series.find((s) => /төлөв|plan/i.test(`${s.name} ${s.key}`));
  const actual = series.find((s) => s !== plan && /биел|гүйцэт|measur|actual|done/i.test(`${s.name} ${s.key}`));
  return plan && actual ? { plan, actual } : null;
}

/**
 * Төлөвлөгөө / гүйцэтгэлийг ойлгомжтой жагсаалтаар: дээр нь нийт хувь, мөр бүрт
 * нэр, явцын зураас (бүтэн зам = төлөвлөгөө, ногоон = биелсэн хэсэг), «биелсэн / төлөвлөсөн», хувь.
 */
function PlanActualList({
  rows,
  planKey,
  actKey,
  planName,
  actName,
  fmt,
  selected,
  onPick,
}: {
  rows: Record<string, unknown>[];
  planKey: string;
  actKey: string;
  planName: string;
  actName: string;
  fmt: (v: unknown) => string;
  selected: Set<string>;
  onPick?: (x: unknown) => void;
}) {
  const num = (r: Record<string, unknown>, k: string) => Number(r[k]) || 0;
  const pct = (a: number, p: number) => (p > 0 ? Math.round((a / p) * 100) : null);
  const plan = rows.reduce((s, r) => s + num(r, planKey), 0);
  const act = rows.reduce((s, r) => s + num(r, actKey), 0);
  const total = pct(act, plan);
  // Ганц мөр бол нийт дүнтэйгээ давхардана — зөвхөн нийтийг харуулна
  const single = rows.length <= 1;
  return (
    <div className={`pa ${single ? "single" : ""}`}>
      <div className="pa-sum">
        <div className="pa-sum-head">
          <b>{total === null ? "—" : `${total}%`}</b>
          <span>
            {actName} {compact(act)} · {planName} {compact(plan)}
          </span>
        </div>
        <div className="pa-track">
          <i style={{ width: `${Math.min(100, total ?? 0)}%` }} />
        </div>
      </div>
      {!single && <div className="pa-rows">
        {rows.map((r, i) => {
          const p = num(r, planKey);
          const a = num(r, actKey);
          const pc = pct(a, p);
          const label = String(r.__label ?? "");
          const dim = selected.size > 0 && !selected.has(String(r.__x));
          return (
            <div
              key={i}
              className={`pa-row ${pc === null || pc === 0 ? "zero" : pc >= 100 ? "done" : ""} ${dim ? "dim" : ""} ${onPick ? "pick" : ""}`}
              title={`${label}\n${actName}: ${fmt(a)}\n${planName}: ${fmt(p)}${pc === null ? "" : `\n${pc}%`}`}
              onClick={onPick ? () => onPick(r.__x) : undefined}
            >
              <span className="pa-name">{label}</span>
              {/* Зам бүтэн = тухайн мөрийн төлөвлөгөө; дүүргэлт = биелэлтийн хувь */}
              <span className="pa-bar">
                <span className="pa-act" style={{ width: `${Math.min(100, pc ?? 0)}%` }} />
              </span>
              <span className="pa-num">
                {compact(a)} / {compact(p)}
              </span>
              <span className="pa-pct">{pc === null ? "—" : `${pc}%`}</span>
            </div>
          );
        })}
      </div>}
    </div>
  );
}

/** «Хоосон» (утгагүй) ангиллын өнгө — бусад өнгөнөөс тусдаа, бүдэг */
const EMPTY_COLOR = "#8a9a96";
/** Утгагүй ангилал: null, хоосон эсвэл зөвхөн зай */
const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Бүх баганан графикийн нэг ижил зузаан, px — босоо, хэвтээ аль алинд */
const BAR_SIZE = 14;
/** Хэвтээ баганан графикийн нэг мөрийн хамгийн их өндөр — бүх графикт ижил хэмнэл */
const ROW_H = 400; // мөр цөөн ч картын өндрийг дүүргэнэ (ганц мөртэй үед л хязгаарлана)

/** Гарчиггүй графикт ангиллын талбарын нэрийг гарчиг болгоно — бүх самбар гарчигтай байна */
function titled(widget: Widget, fields: Record<string, Field>, field?: string): Widget {
  if (stripHtml(widget.topCaption ?? widget.caption ?? widget.title)) return widget;
  const alias = field ? fields[field]?.alias ?? field : "";
  // «ID», «LICE_ID» зэрэг техникийн нэрийг гарчиг болгохгүй — зөвхөн жинхэнэ нэр (кирилл эсвэл талбарын нэрээс өөр)
  const useful = alias && (alias !== field || /[^\x00-\x7F]/.test(alias));
  return useful ? { ...widget, topCaption: alias } : widget;
}

/**
 * Дараалсан үеүд: дарааллаар нь. Tooltip-д богино нэр, графикийн доор бүтэн тайлбар.
 * Шинэ үеийн шугам өмнөх үеийн сүүлийн цэгээс эхэлж тасралтгүй болно. Тэр цэгийг tooltip-д давхар харуулахгүй.
 */
function stageSeries(series: SeriesSpec[], cfg: ChartSeries[], rows: Record<string, unknown>[]): SeriesSpec[] {
  const rank = (s: SeriesSpec) => (s.key === "s:null" ? Infinity : Number(s.key.slice(2)));
  const named = [...series].sort((a, b) => rank(a) - rank(b)).map((s) => {
    const full = cfg.find((c) => `s:${c.y}` === s.key)?.name;
    const roman = full?.match(/^([IVX]+)\./)?.[1];
    return roman ? { ...s, name: `${roman} үе`, title: full } : s;
  });
  const hasValue = (r: Record<string, unknown>, key: string) => r[key] !== null && r[key] !== undefined;
  named.forEach((s, i) => {
    const next = named[i + 1];
    if (!next) return;
    const last = rows.reduce((at, r, j) => (hasValue(r, s.key) ? j : at), -1);
    if (last >= 0 && rows[last + 1] && hasValue(rows[last + 1], next.key) && !hasValue(rows[last], next.key)) {
      rows[last][next.key] = rows[last][s.key];
      rows[last].__bridge = [next.key];
    }
  });
  return named;
}

const INTERNAL_NAMES = new Set(["groupByValues", "features", "fields", "main", "__split-by-template__"]);

/** Огноогоор бүлэглэсэн мөрийг он болгон нэгтгэнэ; бичлэггүй он 0 */
function binByYear(rows: Record<string, unknown>[], field: string, stat: string) {
  const sums = new Map<number, number>();
  for (const r of rows) {
    const time = Number(r[field]);
    if (!Number.isFinite(time)) continue;
    const year = new Date(time).getUTCFullYear();
    sums.set(year, (sums.get(year) ?? 0) + (Number(r[stat]) || 0));
  }
  if (!sums.size) return [];
  const years = [...sums.keys()];
  const out: Record<string, unknown>[] = [];
  for (let year = Math.min(...years); year <= Math.max(...years); year++) out.push({ [field]: year, [stat]: sums.get(year) ?? 0 });
  return out;
}

function buildSerial(widget: Widget, data: QueryResult | null) {
  const ds = widget.datasets?.[0];
  const fields = fieldMap(data);
  const ratio = widget.chartConfig?.ratio;
  const rest = widget.chartConfig?.remainder;
  const rows =
    ratio || rest
      ? (data?.rows ?? []).map((r) => ({
          ...r,
          ...(ratio ? { [ratio.key]: ratioOf(r, ratio) } : {}),
          ...(rest ? { [rest.key]: remainderOf(r, rest) } : {}),
        }))
      : data?.rows ?? [];
  const cfgSeries = (widget.chartConfig?.series ?? []).filter((s) => s.type !== "pieSeries");
  const kindOf = (t?: string): "bar" | "line" => (t === "lineSeries" || t === "areaSeries" ? "line" : "bar");
  const firstKind = kindOf(cfgSeries[0]?.type);
  let xField: string | undefined;
  let out: Record<string, unknown>[] = [];
  let series: SeriesSpec[] = [];
  let hidden = 0;
  let splitStack = false;

  if (widget.categoryType === "fields") {
    const r0 = rows[0] ?? {};
    out = (ds?.statisticDefinitions ?? []).map((sd) => ({
      __x: sd.onStatisticField,
      __label: categoryLabel(widget, sd.onStatisticField, undefined) || fields[sd.onStatisticField]?.alias,
      v: r0[sd.outStatisticFieldName],
    }));
    out.forEach((o) => {
      const alias = fields[String(o.__x)]?.alias;
      const ov = widget.category?.labelOverrides?.find((x) => x.key === o.__x);
      o.__label = ov?.label ?? alias ?? o.__x;
    });
    series = [{ key: "v", name: cfgSeries[0]?.name ?? "Утга", kind: firstKind, color: ACCENT }];
  } else if (widget.categoryType === "features") {
    xField = cfgSeries[0]?.x;
    out = rows.map((r) => ({ ...r, __x: xField ? r[xField] : "", __label: categoryLabel(widget, xField ? r[xField] : "", xField ? fields[xField] : undefined) }));
    series = cfgSeries
      .filter((s) => s.y)
      .slice(0, MAX_SERIES)
      .map((s, i) => ({ key: s.y!, name: s.name || fields[s.y!]?.alias || s.y!, kind: kindOf(s.type), color: s.color ?? PALETTE[i] }));
  } else {
    xField = ds?.groupByFields?.[0];
    const split = widget.splitBy?.fieldName;
    if (split && split !== xField) {
      // splitBy үед chartConfig.series[].y нь хуваасан утгын нэр байдаг — статистикийн талбарыг dataset-ээс авна
      const stat = ds?.statisticDefinitions?.[0]?.outStatisticFieldName ?? "";
      const byX = new Map<string, Record<string, unknown>>();
      const totals = new Map<string, number>();
      for (const r of rows) {
        const blankX = isBlank(r[xField!]);
        const xk = blankX ? "\u0000blank" : String(r[xField!]);
        const sk = isBlank(r[split]) ? "null" : String(r[split]);
        const row = byX.get(xk) ?? { __x: blankX ? null : r[xField!], __label: categoryLabel(widget, blankX ? null : r[xField!], fields[xField!]) };
        row[`s:${sk}`] = (Number(row[`s:${sk}`]) || 0) + (Number(r[stat]) || 0);
        byX.set(xk, row);
        totals.set(sk, (totals.get(sk) ?? 0) + Math.abs(Number(r[stat]) || 0));
      }
      out = sortCategories([...byX.values()], ds?.orderByFields, xField);
      // Нийлбэр/тоо ширхгийг хуваасан бол давхарлана — нэг ангилал нэг багана, нийт нь шошгон дээр
      const statType = ds?.statisticDefinitions?.[0]?.statisticType ?? "";
      splitStack = /^(sum|count)$/i.test(statType);
      const splitColors = widget.chartConfig?.splitColors;
      const splitOrder = widget.chartConfig?.splitOrder;
      const rank = (name: string) => {
        const i = splitOrder?.indexOf(name) ?? -1;
        return i < 0 ? Infinity : i;
      };
      const ranked = [...totals.entries()].sort((a, b) =>
        splitOrder ? rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]) : splitColors ? a[0].localeCompare(b[0]) : b[1] - a[1],
      );
      const limit = splitColors ? ranked.length : MAX_SERIES;
      hidden = Math.max(0, ranked.length - limit);
      // Өнгө нь утгын нэрээр тогтмол — шүүлтүүрээр цуваа цөөрөхөд өнгө солигдохгүй
      const order = [...totals.keys()].sort();
      series = ranked.slice(0, limit).map(([sk]) => ({
        key: `s:${sk}`,
        name: sk === "null" ? "Хоосон" : displayValue(sk, fields[split]),
        kind: firstKind,
        color: splitColors?.[sk] ?? PALETTE[order.indexOf(sk) % PALETTE.length],
      }));
      if (widget.chartConfig?.stagedSplit) series = stageSeries(series, cfgSeries, out);
    } else {
      const stat = cfgSeries[0]?.y ?? ds?.statisticDefinitions?.[0]?.outStatisticFieldName ?? "";
      const yearBin = widget.chartConfig?.yearBin;
      out = sortCategories(
        (yearBin ? binByYear(rows, xField!, stat) : rows).map((r) => ({
          ...r,
          __x: r[xField!],
          __label: yearBin ? String(r[xField!]) : categoryLabel(widget, r[xField!], xField ? fields[xField] : undefined),
        })),
        ds?.orderByFields,
        xField,
      );
      const specs = cfgSeries.length ? cfgSeries : [{ y: stat, name: "", type: "columnSeries" } as never];
      series = specs
        .filter((s: { y?: string }) => s.y)
        .slice(0, MAX_SERIES)
        .map((s: { y?: string; name?: string; type?: string; color?: string }, i: number) => ({
          key: s.y!,
          // ArcGIS дотоод нэрийг (uuid, "groupByValues", "main"...) хэрэглэгчид харуулахгүй
          name:
            s.name && !/^[0-9a-f-]{20,}$/i.test(s.name) && !INTERNAL_NAMES.has(s.name)
              ? s.name
              : stripHtml(widget.topCaption) || "Утга",
          kind: kindOf(s.type),
          color: s.color ?? (specs.length === 1 ? ACCENT : PALETTE[i]),
        }));
      const blanks = out.filter((r) => isBlank(r.__x));
      if (blanks.length > 1) {
        const merged: Record<string, unknown> = { ...blanks[0], __x: null, __label: categoryLabel(widget, null, xField ? fields[xField] : undefined) };
        for (const b of blanks.slice(1)) for (const sr of series) merged[sr.key] = (Number(merged[sr.key]) || 0) + (Number(b[sr.key]) || 0);
        out = [...out.filter((r) => !isBlank(r.__x)), merged];
      }
    }
  }
  return { rows: out, series, hidden, xField, splitStack };
}

export function SerialChartWidget({ widget }: { widget: Widget }) {
  const iv = intervalSpec(widget);
  return iv ? <IntervalChart widget={widget} spec={iv} /> : <SerialChart widget={widget} />;
}

function SerialChart({ widget }: { widget: Widget }) {
  // Бичлэг бүрийг ангилал болгосон график — ArcGIS-ээс утгаар нь эрэмбэлж авна (2000-ийн хязгаарт их нь орно)
  const sortField = widget.categoryType === "features" ? widget.chartConfig?.series?.find((sr) => sr.y)?.y : undefined;
  const { data, loading, error, filtered } = useWidgetData(widget, "main", sortField);
  const prefs = useContext(ChartPrefsCtx);
  const kindOverride = prefs.get(widget.id);
  const built = useMemo(() => buildSerial(widget, data), [widget, data]);
  const { rows: builtRows, hidden, xField } = built;
  // «Төлөвлөсөн / Биелсэн» хос багана — төлөвлөгөөг хүрээтэй зам, гүйцэтгэлийг түүн дотор дүүргэлтээр (нэг мөрөнд)
  const pa = useMemo(() => planActualOf(built.series), [built.series]);
  const series = useMemo(() => {
    if (kindOverride) return built.series.map((sr) => ({ ...sr, kind: kindOverride }));
    if (pa) return [{ ...pa.plan, color: PLAN_COLOR }, { ...pa.actual, color: ACCENT }];
    return built.series;
  }, [built, kindOverride, pa]);
  const baseKind: ChartKind = built.series.every((sr) => sr.kind === "line") ? "line" : "bar";
  const shownKind: ChartKind = kindOverride ?? baseKind;
  const groupBy = widget.categoryType === "groupByValues" || !widget.categoryType;
  const { selected, toggle, canSelect } = useCategorySelection(widget, groupBy ? xField : undefined);
  const [areaRef, area] = useSize<HTMLDivElement>();
  const [chartRef, chartBox] = useSize<HTMLDivElement>();
  // Нэгдсэн дүрэм: бүх баганан график хэвтээ (ангиллын нэр зүүн талд, багана баруун тийш).
  // Шугаман (эсвэл шугам+багана холимог) график ArcGIS-ийн тохиргоогоороо.
  const allBars = series.length > 0 && series.every((sr) => sr.kind === "bar");
  const horizontal = !widget.chartConfig?.columns && (allBars || Boolean(widget.chartConfig?.rotated));
  const stacked = widget.chartConfig?.stackedType?.startsWith("stacked") || built.splitStack ? "s" : undefined;
  const single = series.length === 1;
  const planActual = Boolean(pa) && !kindOverride && horizontal && !stacked;
  const planKey = series[0]?.key;
  const actKey = series[1]?.key;
  // Огноо, он, тоон ангилал дарааллаараа; текст ангилал утгаараа (их нь дээр), «Хоосон» хамгийн доор
  const ordinal = useMemo(
    () =>
      builtRows.every(
        (r) => r.__x === null || r.__x === undefined || typeof r.__x === "number" || /^\d{4}([-./]\d{1,2})*/.test(String(r.__x)),
      ),
    [builtRows],
  );
  const sortedRows = useMemo(() => {
    const total = (r: Record<string, unknown>) => series.reduce((a, sr) => a + (Number(r[sr.key]) || 0), 0);
    if (widget.chartConfig?.hideZero) {
      const kept = builtRows.filter((r) => total(r) > 0);
      return kept.sort((a, b) => total(b) - total(a));
    }
    if (!horizontal || !allBars || ordinal || builtRows.length < 3) return builtRows;
    const empty = (r: Record<string, unknown>) => !widget.chartConfig?.nullIsValue && isBlank(r.__x);
    return [...builtRows].sort((a, b) => Number(empty(a)) - Number(empty(b)) || total(b) - total(a));
  }, [builtRows, horizontal, allBars, series, ordinal]);
  // Олон ангилалтай (жишээ нь мянга мянган цооног) хэвтээ баганад картанд багтах хэмжээгээр хамгийн их утгатайг харуулна
  const MIN_ROW = 14;
  const topN =
    horizontal && allBars && !ordinal && !widget.chartConfig?.allRows && area.h > 0 && sortedRows.length * MIN_ROW > area.h - 8
      ? Math.max(3, Math.floor((area.h - 8) / MIN_ROW))
      : 0;
  const rows = useMemo(() => (topN ? sortedRows.slice(0, topN) : sortedRows), [sortedRows, topN]);
  const cutCount = sortedRows.length - rows.length;
  // Хэвтээ баганыг картын өндөрт тааруулна: мөр өндөр бол багана ч бага зэрэг зузаарна (14–26px)
  const rowSpace = horizontal && area.h && rows.length ? Math.min(ROW_H, (area.h - 8) / rows.length) : 0;
  // Хэсэг бүр дотроо утгатай багана: тоо багтахаар зузаан
  const segments = horizontal && Boolean(stacked) && Boolean(widget.chartConfig?.segmentLabels);
  const barSize = horizontal ? Math.round(segments ? Math.min(34, Math.max(BAR_SIZE, rowSpace * 0.68)) : Math.min(26, Math.max(BAR_SIZE, rowSpace * 0.42))) : BAR_SIZE;
  const showLabels = single && rows.length <= 24 && (widget.chartConfig?.series?.[0]?.dataLabels?.visible ?? false);
  const fmt = (v: unknown) => formatNumber(v, widget.valueFormat);
  const opacity = (x: unknown) => (selected.size === 0 || selected.has(String(x)) ? 1 : 0.3);
  const hasLine = series.some((s) => s.kind === "line");
  const gradId = (key: string) => `g-${widget.id}-${key}`.replace(/[^a-zA-Z0-9_-]/g, "_");

  // Шугамын шошго: нэг цуваатай бол цэг бүрт (олон цэгтэй бол давхцахгүйгээр сийрэгжүүлнэ),
  // олон цуваатай бол зөвхөн цуваа бүрийн сүүлийн утгад
  // Шошго хооронд дор хаяж ~60px зай — графикийн өргөнөөс хамаарч сийрэгжүүлнэ
  const labelStep = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor((area.w || 800) / 60))));
  const lastIndex = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of series) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i][s.key] !== null && rows[i][s.key] !== undefined) {
          out[s.key] = i;
          break;
        }
      }
    }
    return out;
  }, [rows, series]);
  const valueDigits = widget.chartConfig?.valueDigits;
  const axisValue = (v: number) => (valueDigits === undefined ? compact(v) : v.toFixed(valueDigits));
  const lineLabel =
    (key: string, color: string) =>
    (p: { x?: number | string; y?: number | string; value?: unknown; index?: number }) => {
      const i = p.index ?? 0;
      const value = Number(p.value);
      const peak = value > 0 && value >= (Number(rows[i - 1]?.[key]) || 0) && value > (Number(rows[i + 1]?.[key]) || 0);
      const show = widget.chartConfig?.peakLabels ? peak : single ? i % labelStep === 0 || i === lastIndex[key] : i === lastIndex[key] && !widget.chartConfig?.plainLines;
      if (!show || p.value === null || p.value === undefined) return null;
      return (
        <text
          x={Number(p.x)}
          y={Number(p.y) - 8}
          textAnchor={!single || (widget.chartConfig?.endLabelInside && i === lastIndex[key]) ? "end" : widget.chartConfig?.endLabelInside && i === 0 ? "start" : "middle"}
          fontSize={10}
          fill={single ? "var(--text-secondary)" : color}
          fontWeight={single ? 400 : 700}
          style={{ paintOrder: "stroke", stroke: "var(--surface-1)", strokeWidth: 3 }}
        >
          {axisValue(Number(p.value))}
        </text>
      );
    };

  // ---- Урт график: ангилал багтахгүй бол гүйлгэнэ, утгын тэнхлэг байрандаа үлдэнэ (ArcGIS-ийн адил)
  const [scrollRef, sc] = useSize<HTMLDivElement>();
  // Нэг ангилалд ногдох хамгийн бага зай, px — шугамд бага зай хангалттай, баганад илүү
  // Графикийг картандаа багтаана; зөвхөн нэг ангилалд 3px-ээс бага ногдох (мянга мянган ангилал) үед гүйлгэнэ
  const STEP = horizontal && widget.chartConfig?.allRows ? MIN_ROW : 3;
  const need = rows.length * STEP;
  const scroll = rows.length > 0 && area.w > 0 && (horizontal ? need > area.h : need > area.w);
  const VAL_W = 52; // босоо графикийн утгын тэнхлэг
  const AXIS_H = 30;
  const longest = useMemo(() => rows.reduce((m, r) => Math.max(m, String(r.__label ?? "").length), 0), [rows]);
  // Хэвтээ графикийн ангиллын тэнхлэг — шошгоны уртад тааруулна (NW, CEN бол нарийн, урт нэр бол 110px хүртэл)
  // нарийн самбарт баганад зай үлдээхийн тулд шошго самбарын 42%-иас хэтрэхгүй (урт нэр 2 мөрт орно)
  const CAT_W = Math.round(area.w ? Math.min(220, area.w * 0.5, Math.max(56, longest * 5.8 + 14)) : 120);
  const rotH = Math.min(110, 14 + longest * 5.6); // босоо бичсэн ангиллын шошгоны өндөр

  // Тогтмол тэнхлэг ба гүйлгэх график хоёр ижил утгын хүрээтэй байж яг таарна
  const lineOnly = series.length > 0 && series.every((sr) => sr.kind === "line");
  const guides = useMemo(() => guidesOf(widget), [widget]);
  const tightBars = Boolean(widget.chartConfig?.tightBars);
  const solidBars = tightBars || Boolean(widget.chartConfig?.solidBars);
  const evenTicks = Boolean(widget.chartConfig?.evenTicks);
  const axisTicks = useRef<number[]>([]);
  const valueDomain = useMemo<[number, number]>(() => {
    let lo = lineOnly || tightBars ? Infinity : 0;
    let hi = lineOnly || tightBars ? -Infinity : 0;
    for (const r of rows) {
      let pos = 0;
      let neg = 0;
      for (const sr of series) {
        const v = Number(r[sr.key]);
        if (!Number.isFinite(v) || r[sr.key] === null) continue;
        if (stacked && sr.kind === "bar") {
          if (v >= 0) pos += v;
          else neg += v;
        } else {
          hi = Math.max(hi, v);
          lo = Math.min(lo, v);
        }
      }
      if (!lineOnly && !tightBars) {
        hi = Math.max(hi, pos);
        lo = Math.min(lo, neg);
      }
    }
    // 0 зэрэг онцгой бага утга мужийг өргөсгөвөл бүх багана ижил болно: Тьюкийн хязгаараас доошхийг тооцохгүй
    if (tightBars) {
      const vals = rows.map((r) => Number(r[series[0]?.key])).filter(Number.isFinite).sort((a, b) => a - b);
      if (vals.length > 3) {
        const q1 = vals[Math.floor(vals.length / 4)];
        const q3 = vals[Math.floor((vals.length * 3) / 4)];
        lo = vals.find((v) => v >= q1 - 3 * (q3 - q1)) ?? lo;
      }
    }
    // Хязгаарын шугам үргэлж харагдана — утга түүнээс хэр хол байгааг харуулна
    if (rows.length) {
      for (const g of guides) {
        hi = Math.max(hi, g.start, g.end ?? g.start);
        lo = Math.min(lo, g.start, g.end ?? g.start);
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
    if (lineOnly || tightBars) {
      const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.02 || 1;
      const nonNegative = lo >= 0;
      lo -= pad;
      hi += pad;
      // Тоо ширхэг зэрэг сөрөг байж болохгүй утгад тэнхлэг 0-ээс доош орохгүй
      if (nonNegative) lo = Math.max(0, lo);
    }
    if (evenTicks) {
      const step = tickStep(lo, hi);
      const bottom = Math.floor(lo / step + 1e-9) * step;
      const top = Math.ceil(hi / step - 1e-9) * step;
      axisTicks.current = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) => +(bottom + i * step).toFixed(10));
      return [bottom, top];
    }
    // Тэнхлэгийн хязгаарыг бүхэл тоо руу тойруулна (1,617.1 биш 2,000)
    const nice = (v: number, up: boolean) => {
      if (v === 0) return 0;
      const mag = 10 ** Math.floor(Math.log10(Math.abs(v)));
      const step = mag / 2;
      return (up ? Math.ceil(v / step) : Math.floor(v / step)) * step;
    };
    // Шугаманд жижиг мужтай ч гэсэн тойруулалт хэт өргөн болохгүйн тулд мужийн хэмжээгээр тойруулна
    const niceStep = (v: number, up: boolean) => {
      const range = hi - lo;
      if ((!lineOnly && !tightBars) || range <= 0) return nice(v, up);
      const step = 10 ** Math.floor(Math.log10(range)) / 2;
      return (up ? Math.ceil(v / step) : Math.floor(v / step)) * step;
    };
    const top = niceStep(hi, true);
    const bottom = lo >= 0 ? Math.max(0, niceStep(lo, false)) : niceStep(lo, false);
    return [bottom, top === bottom ? bottom + 1 : top];
  }, [rows, series, stacked, lineOnly, guides, tightBars, evenTicks]);

  // Жижиг картанд (зөөврийн компьютер, олон давхар байрлал) шошгыг жижгэрүүлж бүгдийг нь харуулна:
  // хэвтээ графикт мөр бүрт 9.5px-ээс их (9px үсэг давхцахгүй), босоо графикт ангилал бүрт 28px-ээс их ногдвол бүх шошго
  const rowPx = area.h / Math.max(1, rows.length);
  const colPx = Math.max(0, area.w - VAL_W - 20) / Math.max(1, rows.length);
  const catFont = horizontal && rowPx < 11 ? 9 : 10;
  // Босоо графикт урт нэртэй олон ангилал (модны төрөл гэх мэт) багтахгүй бол шошгыг босоогоор бичнэ
  const rotateCats = !horizontal && !ordinal && colPx > 0 && colPx < longest * 5.8 + 8;
  const catAxis = {
    ...axis,
    dataKey: "__label",
    type: "category" as const,
    // Шошго багтвал бүгдийг, эс бөгөөс давхцахгүйгээр сийрэгжүүлнэ
    interval: (horizontal ? rowPx >= 9.5 || widget.chartConfig?.allRows : rotateCats ? colPx >= 12 : colPx >= Math.max(28, longest * 5.8 + 4) || (rows.length <= 12 && (!evenTicks || colPx >= longest * 5.8 + 4))) ? 0 : ("preserveStartEnd" as const),
  };
  const valAxis = {
    ...axis,
    type: "number" as const,
    tickFormatter: axisValue,
    axisLine: false,
    ...(scroll || lineOnly || tightBars || evenTicks || guides.length ? { domain: valueDomain } : {}),
    ...(evenTicks ? { ticks: axisTicks.current, interval: 0 as const } : {}),
    allowDataOverflow: tightBars,
  };
  // ---- Баганын утгын шошго (ArcGIS-д «утга харуулах» асаалттай үед)
  const barSeries = series.filter((sr) => sr.kind === "bar");
  const wantLabels = true; // нэгэн хэвийн байдлаар бүх баганан графикт утга харуулна (багтах үед)
  const stackedBars = Boolean(stacked) && barSeries.length > 1;
  const topBarKey = barSeries[barSeries.length - 1]?.key; // давхарласан баганын нийлбэрийг хамгийн дээд хэсэгт
  const totals = useMemo(
    () => rows.map((r) => barSeries.reduce((a, sr) => a + (Number(r[sr.key]) || 0), 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, series],
  );
  const plotLen = horizontal ? (scroll ? need : area.h) : scroll ? need : Math.max(0, area.w - VAL_W - 20);
  const slot = rows.length ? plotLen / rows.length : 0;
  // Хэвтээ баганан графикт утга баган дээрээ бичигдэх тул доорх тоон тэнхлэгийг нууж мөрөнд зай өгнө
  const hideValAxisH = !segments && horizontal && wantLabels && barSeries.length > 0 && (barSeries.length === 1 || stackedBars || planActual);
  const barLabelsOn =
    !segments && (!widget.chartConfig?.columns || rows.length <= 20) && wantLabels && barSeries.length > 0 && (barSeries.length === 1 || stackedBars) && slot >= (horizontal ? 12 : 11);
  const paLabelsOn = planActual && slot >= 12;
  const paFull = (r: Record<string, unknown>) => {
    const plan = Number(r[planKey]) || 0;
    const act = Number(r[actKey]) || 0;
    return `${compact(act)} / ${compact(plan)}${plan > 0 ? ` · ${Math.round((act / plan) * 100)}%` : ""}`;
  };
  // Нарийн картанд бүтэн шошго («665.9 / 5,293.4 · 13%») баганын зайг идэх тул зөвхөн хувь — бүтэн тоо tooltip-д
  const paLongest = planActual ? Math.max(0, ...rows.map((r) => paFull(r).length)) : 0;
  const paShort = planActual && area.w > 0 && area.w - CAT_W - (10 + paLongest * 6.2) < area.w * 0.4;
  const paText = (r: Record<string, unknown>) => {
    if (!paShort) return paFull(r);
    const plan = Number(r[planKey]) || 0;
    const act = Number(r[actKey]) || 0;
    return plan > 0 ? `${Math.round((act / plan) * 100)}%` : compact(act);
  };
  // Гүйцэтгэлийн шошго — төлөвлөгөө, гүйцэтгэлийн аль урт нь дуусах цэгийн ард
  const paLabel = (p: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number }) => {
    const r = rows[p.index ?? 0];
    if (!r) return null;
    const plan = Number(r[planKey]) || 0;
    const act = Number(r[actKey]) || 0;
    const x = Number(p.x), y = Number(p.y), w = Number(p.width), h = Number(p.height);
    const end = x + Math.max(w, plan > 0 ? (w * act) / plan : 0) + 4;
    return (
      <text x={end} y={y + h / 2} dominantBaseline="middle" fontSize={10} style={{ fill: "var(--text-secondary)", paintOrder: "stroke", stroke: "var(--surface-1)", strokeWidth: 3 }}>
        {paText(r)}
      </text>
    );
  };
  const rotateLabels = barLabelsOn && !horizontal && slot < 38; // нарийн баганад шошгыг босоогоор бичнэ
  const labelText = (i: number, v: unknown) => {
    const n = stackedBars ? totals[i] : Number(v);
    return Number.isFinite(n) && n !== 0 ? compact(n) : "";
  };
  const longestLabel = paLabelsOn
    ? Math.max(0, ...rows.map((r) => paText(r).length))
    : barLabelsOn
      ? Math.max(0, ...rows.map((_, i) => labelText(i, rows[i][barSeries[0]?.key]).length))
      : 0;
  const barLabel = (p: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown; index?: number }) => {
    const i = p.index ?? 0;
    const txt = labelText(i, p.value);
    if (!txt) return null;
    const x = Number(p.x), y = Number(p.y), w = Number(p.width), h = Number(p.height);
    const style = { fill: "var(--text-secondary)", paintOrder: "stroke" as const, stroke: "var(--surface-1)", strokeWidth: 3 };
    if (horizontal) {
      return <text x={x + w + 4} y={y + h / 2} dominantBaseline="middle" fontSize={10} style={style}>{txt}</text>;
    }
    const cx = x + w / 2;
    if (rotateLabels) {
      return (
        <text transform={`translate(${cx},${y - 4}) rotate(-90)`} dominantBaseline="middle" fontSize={9.5} style={style}>
          {txt}
        </text>
      );
    }
    return <text x={cx} y={y - 5} textAnchor="middle" fontSize={10} style={style}>{txt}</text>;
  };
  // Хэсгийн дотор утга. Багтахгүй бол нууна (tooltip-д бий)
  const segmentLabel = (p: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) => {
    const value = Number(p.value);
    if (!Number.isFinite(value) || value === 0) return null;
    const txt = formatNumber(value, widget.labelFormat ?? widget.valueFormat);
    const x = Number(p.x), y = Number(p.y), w = Number(p.width), h = Number(p.height);
    if (w < txt.length * 5.2 + 2 || h < 11) return null;
    return (
      <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central" fontSize={10.5} fontWeight={500} style={{ fill: "var(--text-primary)", paintOrder: "stroke", stroke: "var(--surface-1)", strokeWidth: 2.5, pointerEvents: "none" }}>
        {txt}
      </text>
    );
  };

  const margin = {
    top: segments && guides.length ? 18 : horizontal ? 4 : rotateLabels ? Math.round(10 + longestLabel * 5.6) : showLabels || hasLine || barLabelsOn ? 18 : 6,
    right: horizontal && (showLabels || barLabelsOn || paLabelsOn) ? Math.max(24, Math.round(10 + longestLabel * 6.2)) : hasLine ? 16 : 10,
    left: 0,
    bottom: 0,
  };
  const scrollLabels = (scroll && !horizontal) || rotateCats; // босоо графикт ангиллыг босоогоор бичнэ

  const chart = (hideValueAxis: boolean) => (
    <ComposedChart
      data={rows}
      layout={horizontal ? "vertical" : "horizontal"}
      margin={hideValueAxis && !horizontal ? { ...margin, left: 0 } : margin}
      barGap={planActual ? -barSize : undefined}
      onClick={(st) => {
        const pl = (st as { activePayload?: { payload: Record<string, unknown> }[] })?.activePayload?.[0]?.payload;
        if (pl && canSelect) toggle(pl.__x);
      }}
      style={{ cursor: canSelect ? "pointer" : undefined }}
    >
      <defs>
        {series
          .filter((sr) => sr.kind === "line")
          .map((sr) => (
            <linearGradient key={sr.key} id={gradId(sr.key)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sr.color} stopOpacity={single ? 0.22 : widget.chartConfig?.plainLines ? 0 : 0.1} />
              <stop offset="100%" stopColor={sr.color} stopOpacity={0} />
            </linearGradient>
          ))}
      </defs>
      <CartesianGrid stroke="var(--grid)" vertical={horizontal && !hideValAxisH} horizontal={!horizontal} />
      {horizontal ? (
        <>
          <XAxis {...valAxis} hide={hideValueAxis || hideValAxisH} />
          <YAxis {...catAxis} width={CAT_W} tick={<CatTick width={CAT_W} fontSize={catFont} />} />
        </>
      ) : (
        <>
          <XAxis
            {...catAxis}
            {...(scrollLabels ? { angle: -90, textAnchor: "end", height: rotH, dx: -3, dy: 2 } : {})}
          />
          <YAxis {...valAxis} width={VAL_W} hide={hideValueAxis} />
        </>
      )}
      <Tooltip
        content={(props: ComponentProps<typeof ChartTooltip>) => (
          <ChartTooltip {...props} payload={props.payload?.filter((p) => !((p as { payload?: { __bridge?: unknown[] } }).payload?.__bridge ?? []).includes(p.dataKey))} />
        )}
        cursor={{ fill: "rgba(255,255,255,0.04)", stroke: "var(--axis)" }}
        formatter={(v: unknown) => fmt(v)}
      />
      {series.map((sr) =>
        sr.kind === "bar" ? (
          <Bar
            key={sr.key}
            dataKey={sr.key}
            name={sr.name}
            fill={sr.color}
            stroke={solidBars ? "none" : sr.color}
            strokeWidth={1}
            strokeDasharray={planActual && sr.key === planKey ? "3 2" : undefined}
            radius={segments ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
            maxBarSize={barSize}
            barSize={planActual ? barSize : undefined}
            stackId={stacked}
            isAnimationActive={false}
          >
            {rows.map((r, i) => (
              <Cell
                key={i}
                fillOpacity={(planActual ? (sr.key === planKey ? 0.08 : 0.5) : solidBars ? 0.55 : segments ? 0.32 : FILL_ALPHA) * opacity(r.__x)}
                strokeOpacity={opacity(r.__x)}
                {...(single && isBlank(r.__x) && !widget.chartConfig?.nullIsValue ? { fill: EMPTY_COLOR, stroke: EMPTY_COLOR } : {})}
              />
            ))}
            {barLabelsOn && (!stackedBars || sr.key === topBarKey) && <LabelList dataKey={sr.key} content={barLabel} />}
            {segments && <LabelList dataKey={sr.key} content={segmentLabel} />}
            {paLabelsOn && sr.key === planKey && <LabelList dataKey={sr.key} content={paLabel} />}
          </Bar>
        ) : (
          // Шугаман график: гөлгөр муруй, доор нь бүдэг дүүргэлт, утгын шошго
          <Area
            key={sr.key}
            type="monotone"
            dataKey={sr.key}
            name={sr.name}
            stroke={sr.color}
            strokeWidth={single ? 1.4 : 1.2}
            fill={`url(#${gradId(sr.key)})`}
            dot={rows.length <= 40 ? { r: 2.2, strokeWidth: 1, stroke: sr.color, fill: "var(--surface-1)" } : false}
            activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 1.5 }}
            connectNulls
            isAnimationActive={false}
          >
            <LabelList dataKey={sr.key} content={lineLabel(sr.key, sr.color)} />
          </Area>
        ),
      )}
      {/* Стандартын хязгаар — тасархай шугам (муж бол бүдэг дэвсгэр), нэр нь шугамын дээр */}
      {guides.map((g, i) => {
        // Хэвтээ графикт шугам зүүн захад ойр бол шошго баруун талд нь: ангиллын нэртэй давхцаж, тасрахгүй
        const span = Number(valueDomain[1]) - Number(valueDomain[0]);
        const nearStart = horizontal && span > 0 && (g.start - Number(valueDomain[0])) / span < 0.35;
        // Хэсэг бүр утгатай графикт шошго баганын дээр: тоотой давхцахгүй
        const aboveBars = (p: { viewBox?: { x?: number; y?: number } }) => (
          <text x={p.viewBox?.x} y={(p.viewBox?.y ?? 0) - 5} textAnchor={nearStart ? "start" : "end"} fontSize={10} style={{ fill: g.color }}>
            {g.label}
          </text>
        );
        const label = g.label && !widget.chartConfig?.allRows
          ? segments ? aboveBars : {
              value: g.label,
              position: (horizontal ? (nearStart ? "insideTopLeft" : "insideTopRight") : g.left ? "insideTopLeft" : "insideTopRight") as "insideTopRight",
              fill: g.color,
              fontSize: 10,
              style: { paintOrder: "stroke", stroke: "var(--surface-1)", strokeWidth: 3 },
            }
          : undefined;
        return g.end !== undefined ? (
          <ReferenceArea
            key={`guide-${i}`}
            {...(horizontal ? { x1: g.start, x2: g.end } : { y1: g.start, y2: g.end })}
            fill={g.color}
            fillOpacity={0.08}
            stroke="none"
            label={label}
          />
        ) : (
          <ReferenceLine
            key={`guide-${i}`}
            {...(horizontal ? { x: g.start } : { y: g.start })}
            stroke={g.color}
            strokeWidth={1.2}
            strokeDasharray="5 3"
            label={label}
          />
        );
      })}
    </ComposedChart>
  );

  // Тогтмол утгын тэнхлэг (гүйлгэх үед) — цуваагүй, зөвхөн тэнхлэг
  const fixedAxis = horizontal ? (
    <ComposedChart data={rows} layout="vertical" margin={{ ...margin, top: 0, bottom: 0 }}>
      <XAxis {...valAxis} height={AXIS_H} />
      <YAxis dataKey="__label" type="category" width={CAT_W} tick={false} axisLine={false} tickLine={false} />
    </ComposedChart>
  ) : (
    <ComposedChart data={rows} margin={{ ...margin, right: 0 }}>
      <XAxis dataKey="__label" height={rotH} tick={false} axisLine={false} tickLine={false} />
      <YAxis {...valAxis} width={VAL_W} />
    </ComposedChart>
  );

  if (planActual && pa && sortedRows.length) {
    return (
      <Panel widget={titled(widget, fieldMap(data), xField)} loading={loading} error={error} filtered={filtered}>
        <PlanActualList
          rows={sortedRows}
          planKey={pa.plan.key}
          actKey={pa.actual.key}
          planName={pa.plan.name}
          actName={pa.actual.name}
          fmt={fmt}
          selected={selected}
          onPick={canSelect ? toggle : undefined}
        />
      </Panel>
    );
  }

  return (
    <Panel widget={titled(widget, fieldMap(data), xField)} loading={loading} error={error} filtered={filtered}>
      {!rows.length && !loading ? (
        <div className="dw-msg">Өгөгдөл алга</div>
      ) : (
        <div className="dw-chart" ref={chartRef}>
          <button
            className="dw-kind"
            onClick={() => prefs.set(widget.id, shownKind === "bar" ? "line" : "bar")}
            title={shownKind === "bar" ? "Шугаман график болгох" : "Баганан график болгох"}
            aria-label="Графикийн төрөл солих"
          >
            {shownKind === "bar" ? "📈" : "📊"}
          </button>
          {/* Намхан картанд тайлбар нэг мөрт — графикт зай үлдээнэ */}
          {widget.chartConfig?.stagedSplit ? (
            <ul className="dw-stage-notes">
              {series.map((s) => (
                <li key={s.key}>
                  <i style={{ background: s.color }} />
                  <span>{s.title ?? s.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            !single && <SeriesLegend series={series} hidden={hidden} lines={widget.chartConfig?.legendLines ?? (widget.chartConfig?.plainLines ? 3 : chartBox.h > 0 && chartBox.h < 240 ? 1 : 2)} />
          )}
          {cutCount > 0 && (
            <div className="dw-topn" title="Шүүлтүүр (төсөл, огноо…) хэрэглэвэл цөөн ангилал үлдэж бүгд харагдана">
              Их утгатай {rows.length} нь · нийт {(data?.total ?? sortedRows.length).toLocaleString("mn-MN")}
            </div>
          )}
          {widget.chartConfig?.allRows &&
            guides.map((g) => (
              <div className="dw-guide-note" key={g.start}>
                <i style={{ borderColor: g.color }} />
                {g.label} {g.start.toLocaleString("en-US")} · давсан {rows.filter((r) => Number(r[series[0]?.key]) > g.start).length} / {rows.length}
              </div>
            ))}
          <div className="dw-chart-area" ref={areaRef}>
            {!scroll ? (
              <div
                style={{
                  height: horizontal && area.h ? Math.min(area.h, rows.length * ROW_H + 8) : "100%",
                  marginTop: horizontal && area.h ? Math.max(0, (area.h - (rows.length * ROW_H + 8)) / 2) : 0,
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  {chart(false)}
                </ResponsiveContainer>
              </div>
            ) : horizontal ? (
              <div className="dw-scroll-y">
                <div className="dw-scroll" ref={scrollRef}>
                  <div style={{ height: need, width: sc.w || "100%" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      {chart(true)}
                    </ResponsiveContainer>
                  </div>
                </div>
                {!hideValAxisH && (
                <div style={{ height: AXIS_H, width: sc.w || "100%", flex: "none" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {fixedAxis}
                  </ResponsiveContainer>
                </div>
                )}
              </div>
            ) : (
              <div className="dw-scroll-x">
                <div style={{ width: VAL_W, height: sc.h || "100%", flex: "none" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {fixedAxis}
                  </ResponsiveContainer>
                </div>
                <div className="dw-scroll" ref={scrollRef}>
                  <div style={{ width: need, height: sc.h || "100%" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      {chart(true)}
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- interval

type IntervalSpec = { x: string; from: string; to: string };

/** «Эхлэх гүн / Дуусах гүн» хос цуваатай (бичлэг бүр нэг интервал) графикийг таньна */
function intervalSpec(widget: Widget): IntervalSpec | null {
  if (widget.categoryType !== "features") return null;
  const s = (widget.chartConfig?.series ?? []).filter((x) => x.y);
  if (s.length !== 2) return null;
  const find = (re: RegExp) => s.find((x) => re.test(x.y!) || re.test(x.name ?? ""));
  const from = find(/эхл|ehleh|^from|start/i);
  const to = find(/дуус|duusah|^to$|end/i);
  if (!from || !to || from === to || !from.x) return null;
  return { x: from.x, from: from.y!, to: to.y! };
}

type Run = { from: number; to: number; count: number; r: Record<string, unknown> };

/** Цооног, голч бүрийн нэгтгэл: эхэлсэн гүнийх нь дарааллаар уртыг залгаж зурна. Голч солигдож орсон ч давхцахгүй */
function stackedRuns(segs: Record<string, unknown>[], spec: IntervalSpec, lengthField: string): Run[] {
  let at = 0;
  return [...segs]
    .sort((p, q) => Number(p[spec.from]) - Number(q[spec.from]))
    .map((r) => {
      const from = at;
      at += Number(r[lengthField]) || 0;
      return { from, to: at, count: 1, r };
    })
    .filter((run) => run.to > run.from);
}

/** Ижил өнгөтэй (керн диаметр), залгаа интервалуудыг нэг хэсэг болгоно — олон жижиг судал биш, PQ → HQ → NQ гэж уншигдана */
function toRuns(segs: Record<string, unknown>[], spec: IntervalSpec, colorField?: string): Run[] {
  const sorted = [...segs].sort((p, q) => Math.min(Number(p[spec.from]), Number(p[spec.to])) - Math.min(Number(q[spec.from]), Number(q[spec.to])));
  const runs: Run[] = [];
  for (const s of sorted) {
    const a = Math.min(Number(s[spec.from]), Number(s[spec.to]));
    const b = Math.max(Number(s[spec.from]), Number(s[spec.to]));
    const last = runs[runs.length - 1];
    const same = last && (!colorField || String(last.r[colorField]) === String(s[colorField]));
    if (last && same && a <= last.to + 0.05) {
      last.to = Math.max(last.to, b);
      last.count += 1;
    } else {
      runs.push({ from: a, to: b, count: 1, r: s });
    }
  }
  return runs;
}

const IV_AXIS = 18; // дээд талын гүний тэнхлэг, px
const IV_MIN_ROW = 14; // цооногийн мөрийн хамгийн бага өндөр — үүнээс бага бол гүйлгэнэ
const IV_MAX_ROW = 26;
// alignBars: олон өнгө холихгүй — нэг ногооны түвшнүүд, үлдсэн нь саарал
const IV_MONO = ["#34d0ae", "#a8e6d6", "#1f8f78", "#d6f5ec", "#5fb8a3"];
const IV_MONO_REST = "#7d8f8a";

/** Гүний тэнхлэг: төгсгөл нь хамгийн их гүнд ойр (665 → 700), шошго нь 1·2·2.5·5 × 10ⁿ алхмаар, count-оос ихгүй */
function depthScale(max: number, count: number): { end: number; ticks: number[] } {
  if (!(max > 0)) return { end: 1, ticks: [0, 1] };
  const mag = 10 ** Math.floor(Math.log10(max));
  const end = Math.ceil(max / (mag / 2)) * (mag / 2);
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map((m) => m * mag);
  const step = steps.find((s) => Math.floor(end / s + 1e-9) <= Math.max(1, count)) ?? end;
  const ticks: number[] = [];
  for (let v = 0; v <= end + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { end, ticks };
}

/**
 * Цооногийн интервалын график. Цооног бүрийн өрөмдсөн интервалуудыг эхлэх–дуусах гүнийхээ хооронд
 * хэсэг болгон зурна (ижил керн диаметртэй залгаа интервалууд нэг хэсэг). Өндөр нарийн картанд
 * цооногийн зүсэлт шиг босоо (гүн доошоо), өргөн картанд хэвтээ мөрөөр.
 */
function IntervalChart({ widget, spec }: { widget: Widget; spec: IntervalSpec }) {
  const { data, loading, error, filtered } = useWidgetData(widget);
  const fields = useMemo(() => fieldMap(data), [data]);
  const [areaRef, area] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; y: number; hole: string; run: Run } | null>(null);
  const { selected, toggle, canSelect } = useCategorySelection(widget, spec.x);

  // Өнгөлөх талбар — керн диаметр (HQ, NQ, PQ…) байвал
  const colorField = useMemo(
    () => Object.keys(fields).find((f) => /core.?size|диаметр/i.test(f) || /core|диаметр|керн/i.test(fields[f]?.alias ?? "")),
    [fields],
  );
  const alignBars = Boolean(widget.chartConfig?.alignBars);
  const stackRuns = widget.chartConfig?.stackRuns;
  const allHoles = useMemo(() => {
    const by = new Map<string, Record<string, unknown>[]>();
    for (const r of data?.rows ?? []) {
      if (r[spec.x] === null || r[spec.x] === undefined || r[spec.from] === null || r[spec.to] === null) continue;
      if (!Number.isFinite(Number(r[spec.from])) || !Number.isFinite(Number(r[spec.to]))) continue;
      const k = String(r[spec.x]);
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(r);
    }
    const collator = new Intl.Collator("mn", { numeric: true, sensitivity: "base" });
    const list = [...by.entries()]
      .sort((p, q) => collator.compare(p[0], q[0]))
      .map(([, segs]) => ({
        raw: segs[0][spec.x],
        name: categoryLabel(widget, segs[0][spec.x], fields[spec.x]),
        runs: stackRuns ? stackedRuns(segs, spec, stackRuns) : toRuns(segs, spec, colorField),
        depth: stackRuns
          ? segs.reduce((a, s) => a + (Number(s[stackRuns]) || 0), 0)
          : Math.max(...segs.map((s) => Math.max(Number(s[spec.from]), Number(s[spec.to])))),
      }));
    return alignBars ? list.sort((p, q) => q.depth - p.depth) : list;
  }, [data, spec, widget, fields, colorField, alignBars, stackRuns]);
  // Зэргэлдээ баганатай адил: картанд багтах хэмжээгээр хамгийн гүн цооногууд
  const cap =
    alignBars && area.h > 0 && allHoles.length * IV_MIN_ROW > area.h - 8
      ? Math.max(3, Math.floor((area.h - 8) / IV_MIN_ROW))
      : allHoles.length;
  const holes = allHoles.slice(0, Math.min(cap, widget.chartConfig?.maxRows ?? cap));

  const colors = useMemo(() => {
    const vals = colorField ? [...new Set((data?.rows ?? []).map((r) => String(r[colorField] ?? "null")))].sort() : [];
    if (!alignBars) return new Map(vals.map((v, i) => [v, PALETTE[i % PALETTE.length]]));
    // Нийт уртаар эрэмбэлнэ: хамгийн их нь тод ногоон
    const totals = new Map<string, number>();
    for (const r of data?.rows ?? []) {
      const key = String(r[colorField ?? ""] ?? "null");
      totals.set(key, (totals.get(key) ?? 0) + Math.abs(Number(r[spec.to]) - Number(r[spec.from])));
    }
    const ranked = [...vals].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
    return new Map(ranked.map((v, i) => [v, IV_MONO[i] ?? IV_MONO_REST]));
  }, [data, colorField, alignBars, spec]);
  const colorOf = (r: Record<string, unknown>) => (colorField ? colors.get(String(r[colorField] ?? "null")) ?? ACCENT : ACCENT);
  const legendAll: SeriesSpec[] = [...colors.entries()].map(([v, color]) => ({
    key: v,
    name: v === "null" ? "Хоосон" : displayValue(v, colorField ? fields[colorField] : undefined),
    kind: "bar",
    color,
  }));
  const restKeys = alignBars ? legendAll.filter((s) => s.color === IV_MONO_REST) : [];
  const legend: SeriesSpec[] = restKeys.length
    ? [...legendAll.filter((s) => s.color !== IV_MONO_REST), { key: "__rest__", name: "Бусад", kind: "bar", color: IV_MONO_REST }]
    : legendAll;

  const n = holes.length;
  const vertical = !alignBars && area.h > area.w * 1.5; // өндөр нарийн карт — цооногийн зүсэлт шиг
  const maxDepth = Math.max(0, ...holes.map((h) => h.depth));
  const longest = holes.reduce((m, h) => Math.max(m, h.name.length), 0);
  const depthLabelW = compact(maxDepth).length * 6 + 6;
  const fmtM = (v: unknown) => formatNumber(v, widget.valueFormat);
  const dim = (raw: unknown) => (selected.size === 0 || selected.has(String(raw)) ? 1 : 0.3);
  const textBg = { paintOrder: "stroke" as const, stroke: "var(--surface-1)", strokeWidth: 3 };

  const onHover = (e: React.MouseEvent, hole: string, run: Run) => {
    const box = ((e.currentTarget as Element).closest(".dw-iv") as HTMLElement).getBoundingClientRect();
    setHover({ x: e.clientX - box.left, y: e.clientY - box.top, hole, run });
  };
  const segment = (h: (typeof holes)[number], run: Run, j: number, rect: { x: number; y: number; width: number; height: number }) => {
    const c = colorOf(run.r);
    return (
      <rect
        key={j}
        {...rect}
        rx={2}
        fill={c}
        fillOpacity={alignBars ? 0.55 : FILL_ALPHA}
        stroke={alignBars ? "var(--surface-1)" : c}
        strokeWidth={1}
        onMouseMove={(e) => onHover(e, h.name, run)}
      />
    );
  };

  let body: React.ReactNode = null;
  if (area.w > 0 && n) {
    if (vertical) {
      // ---- Босоо: зүүн талд гүний тэнхлэг, дээр цооногийн нэр (босоо бичвэр), гүн доошоо
      const AXIS_W = 34;
      const NAME_H = Math.min(78, longest * 5.8 + 10);
      const BOTTOM = depthLabelW + 4;
      const plotH = Math.max(40, area.h - NAME_H - BOTTOM);
      const { end, ticks } = depthScale(maxDepth, Math.max(2, Math.min(8, Math.floor(plotH / 60))));
      const sy = (v: number) => NAME_H + (Math.max(0, v) / end) * plotH;
      const colW = Math.max(12, Math.min(40, (area.w - AXIS_W - 4) / n));
      const barW = Math.max(6, Math.min(BAR_SIZE, colW - 4));
      body = (
        <div className="dw-iv-v">
          <svg width={AXIS_W} height={area.h} className="dw-iv-axis">
            {ticks.map((t) => (
              <text key={t} x={AXIS_W - 6} y={sy(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--text-muted)">
                {compact(t)}
              </text>
            ))}
          </svg>
          <div className="dw-iv-cols">
            <svg width={Math.max(n * colW, area.w - AXIS_W - 4)} height={area.h}>
              {ticks.map((t) => (
                <line key={t} x1={0} x2={n * colW} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
              ))}
              {holes.map((h, i) => {
                const cx = i * colW + colW / 2;
                return (
                  <g key={h.name} opacity={dim(h.raw)} onClick={() => toggle(h.raw)} style={{ cursor: canSelect ? "pointer" : undefined }}>
                    <rect x={i * colW} y={0} width={colW} height={area.h} fill="transparent" />
                    <text transform={`translate(${cx},${NAME_H - 6}) rotate(-90)`} dominantBaseline="middle" fontSize={10} fill="var(--text-muted)">
                      <title>{h.name}</title>
                      {h.name}
                    </text>
                    {h.runs.map((run, j) => {
                      const y0 = sy(run.from);
                      return segment(h, run, j, { x: cx - barW / 2, y: y0, width: barW, height: Math.max(1.5, sy(run.to) - y0 - 1) });
                    })}
                    <text transform={`translate(${cx},${sy(h.depth) + 4}) rotate(90)`} dominantBaseline="middle" fontSize={10} style={{ fill: "var(--text-secondary)", ...textBg }}>
                      {compact(h.depth)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      );
    } else {
      // ---- Хэвтээ: мөр бүр нэг цооног, дээр гүний тэнхлэг; мөр олон бол гүйлгэнэ
      const bodyH = Math.max(0, area.h - (alignBars ? 0 : IV_AXIS));
      // alignBars: Recharts-ийн хэвтээ баганатай ижил — дээд зай 4px, багана мөрийн 80%, зузаан нь 14–26px
      const topGap = alignBars ? 4 : 0;
      const rowH = alignBars ? (bodyH - topGap) / n : Math.max(IV_MIN_ROW, Math.min(IV_MAX_ROW, bodyH / n));
      const barH = alignBars ? Math.min(rowH * 0.8, Math.min(26, Math.max(BAR_SIZE, rowH * 0.42))) : Math.max(6, Math.min(BAR_SIZE, rowH - 5));
      const LABEL_W = Math.round(Math.min(110, Math.max(48, longest * 6 + 12)));
      const plotW = Math.max(10, area.w - LABEL_W - depthLabelW - 4);
      const { end, ticks } = depthScale(maxDepth, Math.max(1, Math.min(6, Math.floor(plotW / 56))));
      const sx = (v: number) => LABEL_W + (Math.max(0, v) / end) * plotW;
      const short = (s: string) => {
        const max = Math.max(4, Math.floor((LABEL_W - 10) / 5.8));
        return s.length > max ? s.slice(0, max - 1) + "…" : s;
      };
      body = (
        <>
          {!alignBars && (
            <svg width={area.w} height={IV_AXIS} className="dw-iv-axis">
              {ticks.map((t, i) => (
                <text key={t} x={sx(t)} y={IV_AXIS - 6} textAnchor={i === 0 ? "start" : "middle"} fontSize={10} fill="var(--text-muted)">
                  {compact(t)}
                </text>
              ))}
            </svg>
          )}
          <div className="dw-iv-rows" style={{ height: bodyH }}>
            <svg width={area.w} height={n * rowH + topGap}>
              {!alignBars &&
                ticks.map((t) => <line key={t} x1={sx(t)} x2={sx(t)} y1={0} y2={n * rowH} stroke="var(--grid)" />)}
              {holes.map((h, i) => (
                <g
                  key={h.name}
                  transform={`translate(0,${i * rowH + topGap})`}
                  opacity={dim(h.raw)}
                  onClick={() => toggle(h.raw)}
                  style={{ cursor: canSelect ? "pointer" : undefined }}
                >
                  <rect x={0} y={0} width={area.w} height={rowH} fill="transparent" />
                  <text x={LABEL_W - 6} y={rowH / 2} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--text-muted)">
                    <title>{h.name}</title>
                    {short(h.name)}
                  </text>
                  {h.runs.map((run, j) => {
                    const x0 = sx(run.from);
                    return segment(h, run, j, { x: x0, y: (rowH - barH) / 2, width: Math.max(1.5, sx(run.to) - x0 - 1), height: barH });
                  })}
                  <text x={sx(h.depth) + 4} y={rowH / 2} dominantBaseline="middle" fontSize={10} style={{ fill: "var(--text-secondary)", ...textBg }}>
                    {compact(h.depth)}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </>
      );
    }
  }

  const title = stripHtml(widget.topCaption ?? widget.caption ?? widget.title);
  return (
    <Panel
      widget={title ? widget : { ...widget, topCaption: "Өрөмдсөн интервал — гүн, м" }}
      loading={loading}
      error={error}
      filtered={filtered}
    >
      {!n && !loading ? (
        <div className="dw-msg">Өгөгдөл алга</div>
      ) : (
        <div className="dw-chart">
          {alignBars ? (
            <div className="dw-iv-head">
              <ul title={legendAll.map((s) => s.name).join(", ")}>
                {legend.map((s) => (
                  <li key={s.key}>
                    <i style={{ background: `${s.color}59`, borderColor: s.color }} />
                    {s.name}
                  </li>
                ))}
              </ul>
              {allHoles.length > holes.length && (
                <span>
                  {stackRuns ? "Хамгийн их" : "Хамгийн гүн"} {holes.length} нь · нийт {allHoles.length}
                </span>
              )}
            </div>
          ) : (
            legend.length > 1 && <SeriesLegend series={legend} hidden={0} />
          )}
          <div className="dw-chart-area dw-iv" ref={areaRef} onMouseLeave={() => setHover(null)}>
            {body}
            {hover && (
              <div className="chart-tooltip dw-iv-tip" style={{ left: Math.max(0, Math.min(hover.x + 12, area.w - 180)), top: hover.y + 14 }}>
                <div className="t">{hover.hole}</div>
                <div className="row">
                  <span className="nm">Интервал</span>
                  <b>
                    {fmtM(stackRuns ? hover.run.r[spec.from] : hover.run.from)} – {fmtM(stackRuns ? hover.run.r[spec.to] : hover.run.to)} м
                  </b>
                </div>
                <div className="row">
                  <span className="nm">{stackRuns ? "Өрөмдсөн" : "Урт"}</span>
                  <b>{fmtM(hover.run.to - hover.run.from)} м</b>
                </div>
                {colorField && (
                  <div className="row">
                    <span className="dot" style={{ background: colorOf(hover.run.r) }} />
                    <span className="nm">{fields[colorField]?.alias ?? colorField}</span>
                    <b>{displayValue(hover.run.r[colorField], fields[colorField])}</b>
                  </div>
                )}
                {hover.run.count > 1 && (
                  <div className="row">
                    <span className="nm">Бичлэг</span>
                    <b>{hover.run.count}</b>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- pie

/** Олон цуваатай графикийн тайлбар — дээд тал нь 2 мөр (намхан картанд 1), багтахгүйг «+N» болгоно (гүйлгэхгүй) */
function SeriesLegend({ series, hidden, lines = 2 }: { series: SeriesSpec[]; hidden: number; lines?: number }) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const fit = fitInLines(series.map((s) => s.name), w, lines);
  const shown = series.slice(0, fit);
  const rest = series.length - shown.length + hidden;
  const restNames = series.slice(fit).map((s) => s.name);
  return (
    <div className="legend dw-legend" ref={ref}>
      {shown.map((s) => (
        <span key={s.key}>
          <i className={s.kind === "bar" ? "sq" : ""} style={s.kind === "bar" ? swatch(s.color) : { background: s.color }} />
          {s.name}
        </span>
      ))}
      {rest > 0 && (
        <span
          className="dw-more"
          title={[...restNames, hidden ? `${hidden} цуваа зурагдаагүй — шүүлтүүрээр сонгоно уу` : ""].filter(Boolean).join("\n")}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

const PIE_ROW = 20; // тайлбарын нэг мөрийн өндөр, px

const RANK_ROW = 34;

/** Хүн бүрээр эрэмбэлсэн жагсаалт — нэрийн эхний үсэг, нэр, урт зураас, тоо. Дарахад тухайн хүнээр шүүнэ. */
function RankList({ widget, field, items }: { widget: Widget; field: string; items: [string, number][] }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const { selections, setSelection } = useDashboard();
  const sel = selections[widget.id];
  const chosen = new Set((sel?.values ?? []).map(String));
  const canSelect = Boolean(widget.events?.length);
  const max = Math.max(1, ...items.map(([, v]) => v));
  const fit = size.h ? Math.max(1, Math.floor(size.h / RANK_ROW)) : items.length;
  const shown = items.length > fit ? items.slice(0, fit - 1) : items;
  const rest = items.slice(shown.length);
  const toggle = (name: string) => {
    if (!canSelect) return;
    const values = chosen.has(name) ? (sel?.values ?? []).filter((v) => String(v) !== name) : [...(sel?.values ?? []), name];
    setSelection(widget.id, values.length ? { field, op: "contains", values } : null);
  };
  return (
    <div className="dw-rank" ref={ref}>
      {shown.map(([name, v], i) => (
        <button
          key={name}
          className={`dw-rank-row ${chosen.size && !chosen.has(name) ? "dim" : ""} ${chosen.has(name) ? "on" : ""}`}
          onClick={() => toggle(name)}
          title={canSelect ? `${name} — дарж шүүх` : name}
          style={{ ["--c" as string]: PALETTE[i % PALETTE.length] }}
        >
          <span className="av">{name.slice(0, 1).toUpperCase()}</span>
          <span className="nm">{name}</span>
          <span className="tr">
            <i style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <b>{formatNumber(v, widget.valueFormat)}</b>
        </button>
      ))}
      {rest.length > 0 && (
        <div className="dw-rank-more" title={rest.map(([n, v]) => `${n}: ${v}`).join("\n")}>
          +{rest.length} хүн
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- share list

/** Эзлэх хувь: дээр нэг зурвас, доор бүх ангилал нэр, тоо, хувьтай. Дарахад бусад график шүүгдэнэ */
export function ShareListWidget({ widget }: { widget: Widget }) {
  const { data, loading, error, filtered } = useWidgetData(widget);
  const ds = widget.datasets?.[0];
  const byFields = widget.categoryType === "fields";
  const field = byFields ? undefined : ds?.groupByFields?.[0];
  const stat = ds?.statisticDefinitions?.[0]?.outStatisticFieldName ?? "";
  const { selected, toggle, canSelect } = useCategorySelection(widget, field);
  const fmt = (v: number) => (widget.valueFormat ? formatNumber(v, widget.valueFormat) : v.toLocaleString("en-US"));
  type Item = { key: string; raw: unknown; name: string; value: number; note?: string; rest?: boolean };
  const rows = data?.rows ?? [];
  let items: Item[] = byFields
    ? (ds?.statisticDefinitions ?? []).map((sd) => {
        const name = widget.category?.labelOverrides?.find((o) => o.key === sd.onStatisticField)?.label ?? sd.onStatisticField;
        return { key: sd.onStatisticField, raw: sd.onStatisticField, name, value: Number(rows[0]?.[sd.outStatisticFieldName]) || 0 };
      })
    : rows.map((r) => {
        const raw = r[field ?? ""];
        return { key: String(raw), raw, name: isBlank(raw) ? "Хоосон" : String(raw), value: Number(r[stat]) || 0 };
      });
  items = items.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const max = widget.maxItems;
  if (max && items.length > max + 1) {
    const rest = items.slice(max);
    items = [
      ...items.slice(0, max),
      { key: "__rest__", raw: null, name: `Бусад (${rest.length})`, value: rest.reduce((a, r) => a + r.value, 0), note: rest.map((r) => `${r.name}: ${fmt(r.value)}`).join(", "), rest: true },
    ];
  }
  const total = items.reduce((a, r) => a + r.value, 0);
  const shade = (i: number) => Math.max(0.14, 0.72 - i * 0.1);
  const pct = (v: number) => (v / total) * 100;
  const off = (it: Item) => selected.size > 0 && !selected.has(it.key);
  if (widget.leadRow && items.length > 2) {
    const [top, ...others] = items;
    const restSum = others.reduce((a, r) => a + r.value, 0);
    return (
      <Panel widget={widget} loading={loading} error={error} filtered={filtered}>
        <div className="dw-share lead">
          <div className="dw-lead">
            <span>{top.name}</span>
            <b>{fmt(top.value)}</b>
            <small>{pct(top.value).toFixed(0)}%</small>
          </div>
          <div className="dw-lead-rest">
            Бусад {pct(restSum) < 1 ? pct(restSum).toFixed(1) : pct(restSum).toFixed(0)}% · {fmt(restSum)}
          </div>
          <div className="dw-lead-rows">
            {others.map((r) => (
              <div key={r.key} title={`${r.name}: ${fmt(r.value)} (${pct(r.value).toFixed(1)}%)`}>
                <span>{r.name}</span>
                <i>
                  <em style={{ width: `${(r.value / others[0].value) * 100}%` }} />
                </i>
                <b>{fmt(r.value)}</b>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    );
  }
  return (
    <Panel widget={widget} loading={loading} error={error} filtered={filtered}>
      <div className="dw-share">
        <div className="dw-share-bar">
          {items.map((r, i) => (
            <i key={r.key} style={{ flexGrow: r.value, background: `color-mix(in srgb, ${ACCENT} ${shade(i) * 100}%, transparent)`, opacity: off(r) ? 0.3 : 1 }} title={`${r.name}: ${pct(r.value).toFixed(1)}%`} />
          ))}
        </div>
        <div className="dw-share-rows">
          {items.map((r, i) => (
            <button
              key={r.key}
              className={`${selected.has(r.key) ? "on" : ""} ${off(r) ? "off" : ""}`}
              disabled={!canSelect || r.rest}
              title={r.note ?? r.name}
              aria-pressed={selected.has(r.key)}
              onClick={() => toggle(r.raw)}
            >
              <i style={{ background: `color-mix(in srgb, ${ACCENT} ${shade(i) * 100}%, transparent)` }} />
              <span>{r.name}</span>
              <b>{fmt(r.value)}</b>
              <small>{pct(r.value) < 1 ? pct(r.value).toFixed(1) : Math.round(pct(r.value))}%</small>
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- stat list

function StatRow({ stat }: { stat: NonNullable<Widget["statRows"]>[number] }) {
  const { data, loading, error } = useWidgetData(stat.widget);
  const name = stat.widget.datasets?.[0]?.statisticDefinitions?.[0]?.outStatisticFieldName ?? "";
  const raw = data?.rows[0]?.[name];
  return (
    <li title={error || (stat.note ? `${stat.label}, ${stat.note}` : stat.label)}>
      <span>
        {stat.label}
        {stat.note && <small> {stat.note}</small>}
      </span>
      <b>{loading && !data ? "…" : typeof raw === "number" ? formatNumber(raw, stat.widget.valueFormat) : "—"}</b>
      <em>{stat.unit}</em>
    </li>
  );
}

/** Нэг сэдвийн, нэгж нь өөр өөр үзүүлэлтүүд: мөр бүрт нэр, утга, нэгж */
export function StatListWidget({ widget }: { widget: Widget }) {
  return (
    <Panel widget={widget} expandable={false}>
      <ul className="dw-statlist">
        {(widget.statRows ?? []).map((s) => (
          <StatRow key={s.widget.id} stat={s} />
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------- project mix

const MIX_OTHER_LABEL = "Бусад";

/** Нэг давхаргын мөр: гол төслүүдийн эзлэх хувь, үлдсэн нь «Бусад». Нийт тоо баруун талд */
function MixRow({ label, source, colors, other }: { label: string; source: Widget; colors: Record<string, string>; other: string }) {
  const { data, loading, error } = useWidgetData(source);
  const ds = source.datasets?.[0];
  const key = ds?.groupByFields?.[0] ?? "";
  const stat = ds?.statisticDefinitions?.[0]?.outStatisticFieldName ?? "";
  const rows = (data?.rows ?? []).map((r) => ({ name: String(r[key]), value: Number(r[stat]) || 0 })).filter((r) => r.value > 0);
  const rest = rows.filter((r) => !(r.name in colors)).sort((a, b) => b.value - a.value);
  const parts = [
    ...rows.filter((r) => r.name in colors).sort((a, b) => Object.keys(colors).indexOf(a.name) - Object.keys(colors).indexOf(b.name)).map((r) => ({ ...r, color: colors[r.name], note: "" })),
    ...(rest.length
      ? [{ name: MIX_OTHER_LABEL, value: rest.reduce((a, r) => a + r.value, 0), color: other, note: ` — ${rest.map((r) => `${r.name} ${r.value.toLocaleString("en-US")}`).join(", ")}` }]
      : []),
  ];
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div className="dw-mix-row" title={error || undefined}>
      <span className="dw-mix-name">{label}</span>
      {error ? (
        <span className="dw-mix-none">🔒 хаалттай</span>
      ) : (
        <div className="dw-mix-bar">
          {parts.map((p) => (
            <i key={p.name} style={{ flexGrow: p.value, background: `${p.color}59`, borderColor: p.color }} title={`${p.name}: ${p.value.toLocaleString("en-US")} (${((p.value / total) * 100).toFixed(1)}%)${p.note}`}>
              {p.value / total >= 0.14 && <b>{Math.round((p.value / total) * 100)}%</b>}
            </i>
          ))}
        </div>
      )}
      <span className="dw-mix-total">{loading && !data ? "…" : error ? "" : compact(total)}</span>
    </div>
  );
}

export function ProjectMixWidget({ widget }: { widget: Widget }) {
  const colors = widget.colors ?? {};
  const other = widget.otherColor ?? EMPTY_COLOR;
  return (
    <Panel widget={widget}>
      <div className="dw-mix">
        <div className="dw-mix-rows">
          {(widget.sources ?? []).map((s) => (
            <MixRow key={s.label} label={s.label} source={s.widget} colors={colors} other={other} />
          ))}
        </div>
        <ul className="dw-mix-legend">
          {[...Object.entries(colors), [MIX_OTHER_LABEL, other]].map(([name, c]) => (
            <li key={name}>
              <i style={{ background: `${c}80`, borderColor: c }} />
              {name}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

// fullLegend нь «Бусад»-д нэгтгэхгүй: 8-аас олон утга өнгөө давтахгүй
const FULL_LEGEND_PALETTE = [...PALETTE, "#2fb5c9", "#b7814a", "#a7c636", "#9aa7b0"];

export function PieChartWidget({ widget }: { widget: Widget }) {
  const [legendRef, legendSize] = useSize<HTMLUListElement>();
  // Самбар өргөн бол тайлбар баруун талд, өндөр бол доор — хэлбэрээс нь хамааруулна
  const [pieRef, pieSize] = useSize<HTMLDivElement>();
  const fullLegend = Boolean(widget.chartConfig?.fullLegend);
  const pieRow = fullLegend || !pieSize.w || pieSize.w >= pieSize.h * 1.25;
  const { data, loading, error, filtered } = useWidgetData(widget);
  const ds = widget.datasets?.[0];
  const fields = fieldMap(data);
  const xField = widget.categoryType === "groupByValues" || !widget.categoryType ? ds?.groupByFields?.[0] : undefined;
  const { selected, toggle, canSelect } = useCategorySelection(widget, xField);
  const pieSeries = widget.chartConfig?.series?.[0];
  const infos = widget.chartConfig?.chartRenderer?.uniqueValueInfos ?? [];
  const mono = Boolean(widget.monoShades);

  const slices = useMemo(() => {
    const rows = data?.rows ?? [];
    let raw: { x: unknown; label: string; value: number }[];
    if (widget.categoryType === "fields") {
      const r0 = rows[0] ?? {};
      raw = (ds?.statisticDefinitions ?? []).map((sd) => ({
        x: sd.onStatisticField,
        label:
          widget.category?.labelOverrides?.find((o) => o.key === sd.onStatisticField)?.label ??
          fields[sd.onStatisticField]?.alias ??
          sd.onStatisticField,
        value: Number(r0[sd.outStatisticFieldName]) || 0,
      }));
    } else {
      const x = xField ?? pieSeries?.x ?? "";
      const y = pieSeries?.y ?? ds?.statisticDefinitions?.[0]?.outStatisticFieldName ?? "";
      raw = rows.map((r) => ({ x: r[x], label: categoryLabel(widget, r[x], fields[x]), value: Number(r[y]) || 0 }));
    }
    raw = raw.filter((s) => s.value > 0 && !(mono && isBlank(s.x))).sort((a, b) => b.value - a.value);
    const limit = fullLegend ? Infinity : mono ? (widget.maxItems ?? 5) + 1 : MAX_SERIES;
    if (raw.length > limit) {
      const rest = raw.slice(limit - 1);
      raw = [...raw.slice(0, limit - 1), { x: "__other__", label: `Бусад (${rest.length})`, value: rest.reduce((a, s) => a + s.value, 0) }];
    }
    const total = raw.reduce((a, s) => a + s.value, 0);
    // ArcGIS-ийн өнгийг зөвхөн зүсэм бүрт өөр өөр өнгө оноосон, хангалттай тод үед хэрэглэнэ.
    // Давхардсан, дутуу эсвэл бараан бол системийн (өнгө ялгах чадвар сул хүмүүст шалгагдсан) палитр.
    const lum = (c: number[]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    const own = raw.filter((sl) => sl.x !== "__other__").map((sl) => infos.find((u) => String(u.value) === String(sl.x))?.symbol?.color);
    const keys = own.map((c) => (c ? c.slice(0, 3).join(",") : ""));
    const useArcgis = own.length > 0 && own.every((c) => c && lum(c) >= 0.4) && new Set(keys).size === keys.length;
    const darkColors = !useArcgis;
    const palette = fullLegend ? FULL_LEGEND_PALETTE : PALETTE;
    let slot = 0;
    return raw.map((s) => {
      // Нэрийг ArcGIS-ийн тохиргооноос үргэлж авна; өнгийг зөвхөн тохирох үед
      const named = infos.find((u) => String(u.value) === String(s.x));
      const info = darkColors ? undefined : named;
      const label = named?.label && named.label !== "null" && named.label !== "blank" ? named.label.trim() : s.label;
      const c = info?.symbol?.color;
      const color = mono
        ? s.x === "__other__"
          ? IV_MONO_REST
          : IV_MONO[slot++ % IV_MONO.length]
        : c
        ? rgba([c[0], c[1], c[2]]) ?? ""
        : s.x === "__other__"
          ? "#5b6b74"
          : isBlank(s.x)
            ? EMPTY_COLOR
            : palette[slot++ % palette.length];
      return { ...s, label, pct: total ? s.value / total : 0, color };
    });
  }, [data, widget, ds, xField, pieSeries, infos, fields, mono, fullLegend]);
  // Бөглөөгүй мөр: зүсэм биш, тайлбарын доор
  const blank = useMemo(() => {
    if (!mono) return null;
    const x = xField ?? pieSeries?.x ?? "";
    const y = pieSeries?.y ?? ds?.statisticDefinitions?.[0]?.outStatisticFieldName ?? "";
    const rows = (data?.rows ?? []).filter((r) => isBlank(r[x]) && Number(r[y]) > 0);
    return rows.length ? { raw: rows[0][x], value: rows.reduce((a, r) => a + Number(r[y]), 0) } : null;
  }, [mono, data, xField, pieSeries, ds]);

  // Нэг утгад олон нэр («Нэр1,Нэр2») агуулсан ангилал бол дугуй графикийн оронд хүн бүрээр эрэмбэлнэ
  const people = useMemo(() => {
    if (mono) return null;
    const rows = data?.rows ?? [];
    const x = xField ?? pieSeries?.x ?? "";
    const y = pieSeries?.y ?? ds?.statisticDefinitions?.[0]?.outStatisticFieldName ?? "";
    const labels = rows.map((r) => r[x]).filter((v): v is string => typeof v === "string" && v.trim() !== "");
    if (labels.length < 3 || labels.filter((l) => /[,;]/.test(l)).length < labels.length * 0.25) return null;
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = Number(r[y]) || 0;
      String(r[x] ?? "")
        .split(/[,;]/)
        .map((n) => n.trim())
        .filter(Boolean)
        .forEach((n) => m.set(n, (m.get(n) ?? 0) + v));
    }
    return { field: x, items: [...m.entries()].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0], "mn")) };
  }, [data, xField, pieSeries, ds, mono]);

  if (people) {
    return (
      <Panel widget={titled(widget, fields, people.field)} loading={loading} error={error} filtered={filtered}>
        <RankList widget={widget} field={people.field} items={people.items} />
      </Panel>
    );
  }

  // «Төлөвлөсөн» ба гүйцэтгэлийн нэг талбар — хоёулаа нэг бүхлийн хэсэг биш тул дугуйгаар биш, явцаар
  const stats = ds?.statisticDefinitions ?? [];
  const planStat = widget.categoryType === "fields" && stats.length === 2 ? stats.find((sd) => /төлөв|plan/i.test(sd.onStatisticField)) : undefined;
  if (planStat) {
    const actStat = stats.find((sd) => sd !== planStat)!;
    // Латин техникийн нэрийг («Planned», «Rasp») монгол ерөнхий нэрээр сольно
    const nameOf = (f: string, fallback: string) => {
      const n = widget.category?.labelOverrides?.find((o) => o.key === f)?.label ?? fields[f]?.alias ?? f;
      return n === f && /^[\x00-\x7F]+$/.test(n) ? fallback : n;
    };
    return (
      <Panel widget={titled(widget, fields)} loading={loading} error={error} filtered={filtered}>
        <PlanActualList
          rows={(data?.rows ?? []).slice(0, 1)}
          planKey={planStat.outStatisticFieldName}
          actKey={actStat.outStatisticFieldName}
          planName={nameOf(planStat.onStatisticField, "Төлөвлөсөн")}
          actName={nameOf(actStat.onStatisticField, "Гүйцэтгэл")}
          fmt={(v) => formatNumber(v, widget.valueFormat)}
          selected={NO_SELECTION}
        />
      </Panel>
    );
  }

  return (
    <Panel widget={titled(widget, fields, xField ?? pieSeries?.x)} loading={loading} error={error} filtered={filtered}>
      {!slices.length && !loading ? (
        <div className="dw-msg">Өгөгдөл алга</div>
      ) : (
        <div className={`dw-pie ${pieRow ? "row" : "col"} ${fullLegend ? "full" : ""}`} ref={pieRef}>
          <div className="dw-pie-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip content={<ChartTooltip />} formatter={(v: unknown) => formatNumber(v, widget.valueFormat)} />
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="58%"
                  outerRadius="92%"
                  startAngle={90}
                  endAngle={-270}
                  stroke="var(--surface-1)"
                  strokeWidth={1}
                  isAnimationActive={false}
                  onClick={(s: { x?: unknown }) => s.x !== "__other__" && toggle(s.x)}
                  style={{ cursor: canSelect ? "pointer" : undefined }}
                >
                  {slices.map((s, i) => (
                    <Cell
                      key={i}
                      fill={s.color}
                      fillOpacity={(selected.size === 0 || selected.has(String(s.x)) ? 1 : 0.35) * PIE_ALPHA}
                      stroke={s.color}
                      strokeWidth={1.2}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className={`dw-pie-legend ${mono ? "mono" : ""}`} ref={legendRef}>
            {(() => {
              // Самбарт багтах мөрийн тоогоор харуулж, үлдсэнийг «+N бусад» болгоно — гүйлгэхгүй.
              // fullLegend: бүх утга харагдана, мөрийн өндөр нь самбарт багтахаар багасна
              const rows = fullLegend || !legendSize.h ? slices.length : Math.max(1, Math.floor(legendSize.h / PIE_ROW) - (blank ? 1 : 0));
              const shown = slices.length > rows ? slices.slice(0, rows - 1) : slices;
              const rest = slices.slice(shown.length);
              const rowStyle = fullLegend && pieSize.h ? { height: Math.min(PIE_ROW, pieSize.h / slices.length) } : undefined;
              return (
                <>
                  {shown.map((s) => (
                    <li key={String(s.x)} onClick={() => s.x !== "__other__" && toggle(s.x)} className={canSelect ? "clickable" : ""} style={rowStyle}>
                      <i style={swatch(s.color)} />
                      <span className="name" title={s.label}>
                        {s.label}
                      </span>
                      <span className="val">
                        <b title={formatNumber(s.value, widget.valueFormat)}>
                          {Math.abs(Number(s.value)) >= 1e6 ? compact(Number(s.value)) : formatNumber(s.value, widget.valueFormat)}
                        </b>
                        {(fullLegend ? pieSize.w >= 240 : legendSize.w >= 190) && ` ${(s.pct * 100).toFixed(1)}%`}
                      </span>
                    </li>
                  ))}
                  {rest.length > 0 && (
                    <li className="more" title={rest.map((s) => `${s.label}: ${(s.pct * 100).toFixed(1)}%`).join("\n")}>
                      <i style={{ background: "transparent" }} />
                      <span className="name">+{rest.length} бусад</span>
                      <span className="val">{(rest.reduce((a, s) => a + s.pct, 0) * 100).toFixed(1)}%</span>
                    </li>
                  )}
  {blank && (
                    <li className={`blank ${canSelect ? "clickable" : ""}`} title="Энэ талбарыг бөглөөгүй мөрүүд. Дээрх хувьд ороогүй" onClick={() => toggle(blank.raw)}>
                      <i />
                      <span className="name">Бөглөөгүй</span>
                      <span className="val">
                        <b>{formatNumber(blank.value, widget.valueFormat)}</b>
                      </span>
                    </li>
                  )}
                </>
              );
            })()}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- list / table / details

export function ListWidget({ widget }: { widget: Widget }) {
  const { data, loading, error, filtered } = useWidgetData(widget);
  const rows = (data?.rows ?? []).slice(0, widget.maxItems ?? 100);
  const tpl = widget.itemText ?? widget.text;
  return (
    <Panel widget={widget} loading={loading} error={error} filtered={filtered}>
      <div className="dw-list">
        {rows.map((r, i) =>
          tpl ? (
            <div key={i} className="item" dangerouslySetInnerHTML={{ __html: sanitizeHtml(fillTemplate(tpl, r, data?.fields ?? [])) }} />
          ) : (
            <div key={i} className="item">
              {Object.entries(r)
                .slice(0, 3)
                .map(([k, v]) => displayValue(v, fieldMap(data)[k]))
                .join(" · ")}
            </div>
          ),
        )}
        {!rows.length && !loading && <div className="dw-msg">Өгөгдөл алга</div>}
      </div>
    </Panel>
  );
}

const HIDDEN_FIELDS = /^(objectid|fid|globalid|shape__|shape_|creationdate|creator|editdate|editor)/i;

type TableCol = { key: string; title: string; field?: Field; format?: Widget["valueFormat"] };

/** Хүснэгт бүх баганаа картандаа багтаана: эхлээд үсгээ жижгэрүүлж, тэгсэн ч багтахгүй бол үгийг хуваана */
function useFitTable(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.classList.remove("squeeze");
      for (const size of [11, 10.5, 10, 9.5, 9, 8.5]) {
        el.style.setProperty("--tf", `${size}px`);
        if (el.scrollWidth <= el.clientWidth + 1) return;
      }
      el.classList.add("squeeze");
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export function TableWidget({ widget }: { widget: Widget }) {
  const { data, loading, error, filtered } = useWidgetData(widget);
  const fields = data?.fields ?? [];
  const byName = (name?: string) => fields.find((x) => x.name === name);
  // ArcGIS-д тохируулсан баганууд: нэр, дараалал, статистикийн (SUM_...) гаралт, тооны формат
  const fromSettings: TableCol[] = (widget.columnSettings ?? [])
    .filter((c) => c.fieldName || c.outStatisticFieldName)
    .map((c) => {
      const field = byName(c.fieldName);
      return { key: c.outStatisticFieldName ?? c.fieldName!, title: stripHtml(c.title) || field?.alias || c.fieldName!, field: c.outStatisticFieldName ? undefined : field, format: c.valueFormat };
    });
  const fallback = (
    widget.fieldsToDisplay?.length
      ? widget.fieldsToDisplay.map((f) => byName(f.field ?? f.name)).filter(Boolean)
      : fields.filter((f) => !HIDDEN_FIELDS.test(f.name)).slice(0, 12)
  ) as Field[];
  const cols: TableCol[] = fromSettings.length
    ? fromSettings
    : fallback.length
      ? fallback.map((f) => ({ key: f.name, title: f.alias, field: f }))
      : Object.keys(data?.rows[0] ?? {}).map((k) => ({ key: k, title: k }));
  const rows = data?.rows ?? [];
  const box = useFitTable([cols.length, rows.length]);
  // Гарчиг, тоо, «—» нэг багананд нэг талдаа. Эхний багана (машин, цооногийн дугаар гэх мэт) үргэлж зүүн талд
  const isNum = cols.map((c, i) => i > 0 && (Boolean(c.format) || rows.some((r) => typeof r[c.key] === "number")));
  return (
    <Panel widget={widget} loading={loading} error={error} filtered={filtered}>
      <div className="dw-table" ref={box}>
        <table>
          <thead>
            <tr>{cols.map((c, j) => <th key={c.key} className={isNum[j] ? "num" : undefined} title={c.title}>{c.title}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((r, i) => (
              <tr key={i}>
                {cols.map((c, j) => (
                  <td
                    key={c.key}
                    className={`${isNum[j] ? "num" : ""} ${isBlank(r[c.key]) ? "nil" : ""}`}
                    title={typeof r[c.key] === "string" ? String(r[c.key]) : undefined}
                  >
                    {c.format && typeof r[c.key] === "number" ? formatNumber(r[c.key], c.format) : displayValue(r[c.key], c.field)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function DetailsWidget({ widget }: { widget: Widget }) {
  const { data, loading, error, filtered } = useWidgetData(widget);
  const row = data?.rows[0];
  // Утгагүй (хоосон, «—») талбарыг харуулахгүй — зөвхөн бөглөгдсөн мэдээлэл
  const fields = (data?.fields ?? []).filter((f) => !HIDDEN_FIELDS.test(f.name) && row && !isBlank(row[f.name]));
  return (
    <Panel widget={widget} loading={loading} error={error} filtered={filtered}>
      {row ? (
        <dl className="kv dw-details">
          {fields.slice(0, 40).map((f) => (
            <div key={f.name} style={{ display: "contents" }}>
              <dt>{f.alias}</dt>
              <dd>{displayValue(row[f.name], f)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        !loading && <div className="dw-msg">Өгөгдөл алга</div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- gauge

const numOf = (v: unknown, dflt: number) =>
  typeof v === "number" ? v : typeof v === "object" && v && "value" in v ? Number((v as { value: number }).value) : dflt;

export function GaugeWidget({ widget }: { widget: Widget }) {
  const { data, loading, error, filtered } = useWidgetData(widget);
  const stat = widget.datasets?.[0]?.statisticDefinitions?.[0]?.outStatisticFieldName;
  const value = Number(stat ? data?.rows[0]?.[stat] : 0) || 0;
  const min = numOf(widget.minValue, 0);
  const max = numOf(widget.maxValue, Math.max(100, value));
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const arc = (frac: number) => {
    const a = Math.PI * (1 - frac);
    return `${50 + 40 * Math.cos(a)} ${55 - 40 * Math.sin(a)}`;
  };
  return (
    <Panel widget={widget} loading={loading} error={error} filtered={filtered}>
      <div className="dw-gauge">
        <svg viewBox="0 0 100 62" role="img" aria-label={`${value}`}>
          <path d={`M ${arc(0)} A 40 40 0 0 1 ${arc(1)}`} stroke="var(--surface-3)" strokeWidth="9" fill="none" />
          {t > 0 && <path d={`M ${arc(0)} A 40 40 0 0 1 ${arc(t)}`} stroke={ACCENT} strokeWidth="9" fill="none" />}
          <text x="50" y="52" textAnchor="middle" fill="var(--text-primary)" fontSize="12" fontWeight="800">
            {formatNumber(value, widget.valueFormat)}
          </text>
          <text x="10" y="61" textAnchor="middle" fill="var(--text-muted)" fontSize="5">{compact(min)}</text>
          <text x="90" y="61" textAnchor="middle" fill="var(--text-muted)" fontSize="5">{compact(max)}</text>
        </svg>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- rich text / unsupported

export function RichTextWidget({ widget }: { widget: Widget }) {
  return (
    <Panel widget={widget}>
      <div className="dw-rich" dangerouslySetInnerHTML={{ __html: sanitizeHtml(widget.text) }} />
    </Panel>
  );
}

export function UnsupportedWidget({ widget }: { widget: Widget }) {
  return (
    <Panel widget={widget}>
      <div className="dw-msg">«{widget.type}» төрлийн виджет хараахан дэмжигдээгүй</div>
    </Panel>
  );
}
