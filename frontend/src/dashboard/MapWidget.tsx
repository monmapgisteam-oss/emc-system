import { useContext, useEffect, useRef, useState } from "react";
import L from "leaflet";
import * as esri from "esri-leaflet";
import "esri-leaflet-renderers"; // featureLayer-д service/webmap-ын тэмдэглэгээг хэрэглэнэ
import { api } from "../api";
import { PrefsCtx, useDashboard } from "./context";
import { escapeHtml, formatDate, PALETTE } from "./format";
import { Panel } from "./widgets";
import { addBasemapGallery, basemapKeyFor } from "../components/basemaps";
import type { RuntimeFilter, Widget } from "./types";

export type MapLayer = {
  id: string;
  title: string;
  kind: "feature" | "tiled" | "dynamic" | "imagery";
  url: string;
  visible: boolean;
  opacity: number;
  definitionExpression?: string | null;
  drawingInfo?: unknown;
  labelField?: string | null;
  popup?: PopupSpec;
};

const ERDENET: L.LatLngExpression = [49.021, 104.122];

// esri-leaflet-renderers-ийн дөрвөлжин, ромбо цэгт энэ функц байхгүй тул setStyle алдаа заадаг (Leaflet 1.9)
const pathProto = L.Path.prototype as unknown as { _updateBounds?: () => void };
pathProto._updateBounds ??= () => {};

/**
 * esri-leaflet тэмдэглэгээг сервисээс татаж дуустал давхаргаа эхлүүлдэггүй ч газрын зургийн үйл явдлыг аль хэдийн
 * сонсдог. Тэр хооронд зураг хөдөлбөл алдаа шидэж, бусад давхаргын шинэчлэл ч тасардаг тул хоосон торыг бэлдэнэ.
 */
export function guardEarlyMove(fl: esri.FeatureLayer) {
  const grid = fl as unknown as { _cells: object; _activeCells: object };
  grid._cells = {};
  grid._activeCells = {};
}

const sqlLit = (v: unknown) => (typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

export function whereOf(base: string | null | undefined, filters: RuntimeFilter[]): string {
  const parts = base ? [`(${base})`] : [];
  for (const f of filters) {
    if (f.op === "contains" && f.values.length) {
      parts.push(`(${f.values.map((v) => `${f.field} LIKE ${sqlLit(`%${v}%`)}`).join(" OR ")})`);
      continue;
    }
    if (f.op !== "in" || !f.values.length) continue;
    const vals = f.values.filter((v) => v !== null);
    const sub = [vals.length ? `${f.field} IN (${vals.map(sqlLit).join(", ")})` : "", vals.length < f.values.length ? `${f.field} IS NULL` : ""].filter(Boolean);
    parts.push(`(${sub.join(" OR ")})`);
  }
  return parts.join(" AND ") || "1=1";
}

type PopupSpec = { title?: string | null; fields?: { name: string; label: string }[] } | null;
/** Webmap-ын тохиргоонд тэмдэглэгээ байгаа эсэх (зарим нь зөвхөн шошготой) — байхгүй бол сервисийнх хэрэглэгдэнэ */
export const hasRenderer = (drawingInfo: unknown) => Boolean((drawingInfo as { renderer?: unknown } | null | undefined)?.renderer);

export type PopupMeta = { layerTitle: string; popup?: PopupSpec; fields: Map<string, LayerField>; labelField?: string };

const fmtValue = (v: unknown, f?: LayerField, label = "") => {
  if (f?.type === "esriFieldTypeDate" || (typeof v === "number" && v > 6e11 && v < 4e12 && /date|огноо/i.test(f?.name ?? ""))) return formatDate(v);
  // Дугаар, код, он зэрэг бүхэл тоонд мянгатын таслал тавихгүй (6104600135, 2028)
  if (typeof v === "number" && Number.isInteger(v) && (Math.abs(v) < 10000 || /дугаар|код|code|id|№/i.test(`${f?.name} ${f?.alias} ${label}`))) return String(v);
  if (typeof v === "number") return v.toLocaleString("mn-MN", { maximumFractionDigits: 2 });
  return String(v).trim();
};

/** Объект дээр дарахад гарах мэдээлэл: webmap-ын popup тохиргоогоор (гарчиг, талбарын нэр, дараалал) */
export function popupHtml(props: Record<string, unknown>, meta: PopupMeta): string {
  const fill = (tpl: string) => tpl.replace(/\{([^{}]+)\}/g, (_, k: string) => (props[k] === null || props[k] === undefined ? "" : fmtValue(props[k], meta.fields.get(k))));
  // Гарчиг — объектын нэр (шошгоны талбар), доор нь webmap-ын popup гарчиг (жишээ нь байршил)
  const rawName = meta.labelField && props[meta.labelField] ? String(props[meta.labelField]).trim() : "";
  const name = /^\d{1,3}$/.test(rawName) ? "" : rawName; // «0», «1» нэр биш
  const wmTitle = meta.popup?.title ? fill(meta.popup.title).trim() : "";
  const title = name || wmTitle || meta.layerTitle;
  const sub = name && wmTitle && wmTitle !== name ? wmTitle : "";
  // Систем, KML-ээс импортлогдсон техникийн талбарууд (SymbolID, AltMode, Extruded…) харуулахгүй
  const technical = /^(objectid|fid|globalid|shape|creat|edit|f_$|symbolid$|altmode$|base$|clamped$|extruded$|snippet$|popupinfo$|timestamp$|begin$|end$|folderpath$)/i;
  const spec = meta.popup?.fields?.length
    ? meta.popup.fields
    : Object.keys(props).map((k) => ({ name: k, label: meta.fields.get(k)?.alias || k }));
  const rows = spec
    .filter((f) => !technical.test(f.name) && f.name !== meta.labelField)
    .filter((f) => props[f.name] !== null && props[f.name] !== undefined && String(props[f.name]).trim() !== "")
    .slice(0, 20)
    .map((f) => `<tr><th>${escapeHtml(f.label)}</th><td>${escapeHtml(fmtValue(props[f.name], meta.fields.get(f.name), f.label))}</td></tr>`)
    .join("");
  const body = rows ? `<table class="dw-popup">${rows}</table>` : `<div class="dw-popup-empty">Мэдээлэл бүртгэгдээгүй</div>`;
  return `<div class="dw-popup-t">${escapeHtml(title)}${sub ? `<small>${escapeHtml(sub)}</small>` : ""}</div>${body}`;
}

/** Хил (аймаг, сумын хил г.м.) давхарга — хулганад хариу үйлдэл үзүүлэхгүй, зөвхөн харагдана */
export function isBoundaryLayer(lyr: MapLayer): boolean {
  if (/хил|(^|_)hil(_|$)|boundar|хязгаар|border/i.test(lyr.title)) return true;
  const r = (lyr.drawingInfo as { renderer?: { type?: string; symbol?: { type?: string; style?: string } } } | undefined)?.renderer;
  return r?.type === "simple" && r.symbol?.type === "esriSFS" && r.symbol.style === "esriSFSNull";
}

/** Мэдээлэлгүй объект (нэр, ангилал бүртгэгдээгүй — ихэвчлэн хүрээ, хил) — сонгогдохгүй */
export function noData(props?: Record<string, unknown>): boolean {
  if (!props) return true;
  const filled = Object.entries(props).filter(
    ([k, v]) => !/^(objectid|fid|globalid|shape|creat|edit)/i.test(k) && v !== null && v !== undefined && String(v).trim() !== "" && v !== 0,
  );
  return filled.length <= 1;
}

/** Webmap-ын тэмдэглэгээ талбай эсвэл шугамынх эсэх */
function isPolyRenderer(drawingInfo: unknown): boolean {
  const r = (drawingInfo as { renderer?: Renderer } | undefined)?.renderer;
  const sym = r?.symbol ?? r?.uniqueValueInfos?.[0]?.symbol ?? r?.defaultSymbol ?? r?.classBreakInfos?.[0]?.symbol;
  const t = sym?.type === "CIMSymbolReference" ? sym.symbol?.type : sym?.type;
  return Boolean(t && /^(esriSFS|esriSLS|CIMPolygonSymbol|CIMLineSymbol)$/.test(t));
}

type LegendItem = { value: string; color: string; n?: number; stroke?: string; shape?: "dot" | "poly" | "line" };

/** Webmap-ын ангиллын тэмдэглэгээнээс (uniqueValue/classBreaks) тайлбар */
function rendererLegend(drawingInfo: unknown): LegendItem[] {
  type S = { type?: string; color?: number[]; outline?: { color?: number[] } };
  const r = (drawingInfo as { renderer?: { type?: string; uniqueValueInfos?: { label?: string; value?: unknown; symbol?: S }[]; classBreakInfos?: { label?: string; classMaxValue?: number; symbol?: S }[]; defaultSymbol?: S; defaultLabel?: string } } | undefined)?.renderer;
  // Тайлбарын дөрвөлжин бараан дэвсгэр дээр харагдах хэмжээний тодтой (тунгалаг дүүргэлт ч гэсэн)
  const rgba = (c?: number[]) =>
    c && c.length >= 3 ? `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0.45, (c[3] ?? 255) / 255).toFixed(2)})` : "transparent";
  const item = (label: string, s?: S): LegendItem => ({
    value: label,
    color: rgba(s?.color),
    stroke: rgba(s?.outline?.color ?? s?.color),
    shape: s?.type === "esriSFS" ? "poly" : s?.type === "esriSLS" ? "line" : "dot",
  });
  const infos = r?.type === "uniqueValue" ? r.uniqueValueInfos ?? [] : r?.type === "classBreaks" ? r.classBreakInfos ?? [] : [];
  const items = infos.map((i) => item(i.label || String((i as { value?: unknown }).value ?? (i as { classMaxValue?: number }).classMaxValue ?? ""), i.symbol));
  if (items.length && r?.defaultSymbol) items.push(item(r.defaultLabel && r.defaultLabel !== "Other" ? r.defaultLabel : "Бусад", r.defaultSymbol));
  return items.length >= 2 ? items : [];
}

export type LayerField = { name: string; alias: string; type: string };

/** Цэгийн хэмжээ (радиус, px) — масштабаас хамаарч томорч/жижгэрнэ */
/**
 * Цэг хамгийн их төвлөрсөн хэсэг: цэгүүдийг 16×16 торонд хувааж, нийт цэгийн 60%-ийг агуулах хамгийн
 * жижиг дөрвөлжин цонхыг олно. Цөөн алс цэг (outlier) харагдах хүрээг томруулахгүй.
 */
type ExtentItem = { c: [number, number]; b: L.LatLngBounds };

const unionBounds = (items: ExtentItem[]) => items.reduce((acc, it) => acc.extend(it.b), L.latLngBounds(items[0].b.getSouthWest(), items[0].b.getNorthEast()));

function denseBounds(items: ExtentItem[]): L.LatLngBounds | null {
  if (!items.length) return null;
  // Цөөн объекттой (жишээ нь 14 лиценз) бол бүгдийг нь харуулна; олон бол хамгийн төвлөрсөн хэсгийг
  if (items.length < 30) return unionBounds(items);
  const pts = items.map((it) => it.c);
  const G = 16;
  const lats = pts.map((p) => p[0]).sort((a, b) => a - b);
  const lngs = pts.map((p) => p[1]).sort((a, b) => a - b);
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(f * (arr.length - 1))))];
  const [la0, la1, lo0, lo1] = [q(lats, 0.01), q(lats, 0.99), q(lngs, 0.01), q(lngs, 0.99)];
  if (la1 - la0 < 1e-9 || lo1 - lo0 < 1e-9) return unionBounds(items);
  const cell = (v: number, a: number, b: number) => Math.min(G - 1, Math.max(0, Math.floor(((v - a) / (b - a)) * G)));
  // 2D хуримтлагдсан нийлбэр — цонхны цэгийн тоог шууд олно
  const S = Array.from({ length: G + 1 }, () => new Array<number>(G + 1).fill(0));
  for (const [la, lo] of pts) {
    if (la < la0 || la > la1 || lo < lo0 || lo > lo1) continue;
    S[cell(la, la0, la1) + 1][cell(lo, lo0, lo1) + 1] += 1;
  }
  for (let i = 1; i <= G; i++) for (let j = 1; j <= G; j++) S[i][j] += S[i - 1][j] + S[i][j - 1] - S[i - 1][j - 1];
  const need = pts.length * 0.6;
  for (let k = 2; k <= G; k++) {
    let best = -1;
    let bi = 0;
    let bj = 0;
    for (let i = 0; i + k <= G; i++) {
      for (let j = 0; j + k <= G; j++) {
        const n = S[i + k][j + k] - S[i][j + k] - S[i + k][j] + S[i][j];
        if (n > best) [best, bi, bj] = [n, i, j];
      }
    }
    if (best >= need) {
      const inside = items.filter(({ c: [la, lo] }) => {
        const ci = cell(la, la0, la1);
        const cj = cell(lo, lo0, lo1);
        return la >= la0 && la <= la1 && lo >= lo0 && lo <= lo1 && ci >= bi && ci < bi + k && cj >= bj && cj < bj + k;
      });
      return unionBounds(inside);
    }
  }
  return L.latLngBounds([la0, lo0], [la1, lo1]);
}

type Sym = { type?: string; symbol?: { type?: string } };
type Renderer = { type?: string; field1?: string; symbol?: Sym; defaultSymbol?: Sym; uniqueValueInfos?: { symbol?: Sym }[]; classBreakInfos?: { symbol?: Sym }[] };

/**
 * Webmap-ын тэмдэглэгээ цэгийнх эсэх (зураг, энгийн тэмдэг, CIM цэг). Webmap-ын цэгийн зураг ихэвчлэн
 * 2–3px болж бараг харагддаггүй тул ийм давхаргыг өөрийн тод дугуй тэмдгээр, webmap-ын ангиллын
 * талбараар (байвал) өнгөлж зурна.
 */
function pointRenderer(drawingInfo: unknown): { field?: string } | null {
  const r = (drawingInfo as { renderer?: Renderer } | undefined)?.renderer;
  const sym = r?.symbol ?? r?.uniqueValueInfos?.[0]?.symbol ?? r?.defaultSymbol ?? r?.classBreakInfos?.[0]?.symbol;
  const t = sym?.type === "CIMSymbolReference" ? sym.symbol?.type : sym?.type;
  if (!t || !/^(esriSMS|esriPMS|CIMPointSymbol)$/.test(t)) return null;
  return { field: r?.type === "uniqueValue" ? r.field1 : undefined };
}

/** «Өнгө» сонгогчийн утга: нэг өнгөөр зурах */
const ONE_COLOR = "__one";
/** «Шошго» сонгогчийн утга: шошгогүй */
const NO_LABEL = "__none";

type LabelLayer = L.Layer & {
  feature?: { properties: Record<string, unknown> };
  getBounds?: () => L.LatLngBounds;
  getTooltip?: () => L.Tooltip | undefined;
  bindTooltip: L.Layer["bindTooltip"];
  openTooltip: L.Layer["openTooltip"];
  closeTooltip: L.Layer["closeTooltip"];
};

/** Шошгоны талбар: нэр гэсэн талбар → текстэн «ID» → давхаргын үндсэн (display) талбар */
function pickLabelField(fields: LayerField[], displayField?: string): string | undefined {
  const text = fields.filter((f) => f.type === "esriFieldTypeString");
  return (
    text.find((f) => /^(name|ner|нэр)$/i.test(f.name) || /нэр|name/i.test(f.alias ?? ""))?.name ??
    text.find((f) => /^id$/i.test(f.name))?.name ??
    (displayField && text.some((f) => f.name === displayField) ? displayField : undefined)
  );
}

/** GUID, урт hex код — хүнд уншигдах нэр биш */
const ID_LIKE = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-|^[0-9a-f]{16,}$/i;

/**
 * Талбай, шугам, цэгийн шошго. Дэлгэц дээр бие биентэйгээ давхцахгүй шошгыг л харуулна:
 * том объектын шошго эхэлж байрлана, давхцсан нь нуугдаж томруулахад гарч ирнэ.
 */
type PlacedLabel = { x: number; y: number; w: number; text: string };
/** Газрын зураг бүрийн давхарга тус бүрийн байрласан шошго — нэг цэг хоёр давхаргад (цэг + бүс) байвал нэг л шошго */
const placedByMap = new WeakMap<L.Map, Map<esri.FeatureLayer, PlacedLabel[]>>();

export function attachLabels(map: L.Map, fl: esri.FeatureLayer, field: string, pane?: string) {
  if (!placedByMap.has(map)) placedByMap.set(map, new Map());
  const registry = placedByMap.get(map)!;
  const update = () => {
    if (!map.hasLayer(fl)) return;
    // Бусад давхаргын (өмнө байрласан) шошго — ижил нэр ойрхон эсвэл давхцвал энэ давхаргынхыг нууна
    const others = [...registry.entries()].filter(([k]) => k !== fl).flatMap(([, v]) => v);
    const size = map.getSize();
    const cands: { lay: LabelLayer; x: number; y: number; w: number; area: number; text: string; point: boolean }[] = [];
    // Цэгийн нэр цөөн төрөл бол (хяналтын цэг, «Овоолго 3» гэх мэт байршил — олон цэг нэг нэртэй) нэрийг үргэлж;
    // олон янзын нэртэй (мянган цооног) бол ойртуулсан үед л
    const names = new Set<string>();
    fl.eachFeature((l: L.Layer) => {
      const lay = l as LabelLayer;
      if (!lay.getBounds) names.add(String(lay.feature?.properties[field] ?? "").trim());
    });
    const fewPoints = names.size <= 50;
    fl.eachFeature((l: L.Layer) => {
      const lay = l as LabelLayer;
      const raw = lay.feature?.properties[field];
      const text = raw === null || raw === undefined ? "" : String(raw).trim();
      // «0», «1», GUID — нэр биш, газрын зургийг бөглөнө
      if (!text || /^\d{1,3}$/.test(text) || ID_LIKE.test(text)) return;
      const w = Math.min(160, text.length * 6.2 + 10);
      let x: number, y: number, area: number;
      if (lay.getBounds) {
        const b = lay.getBounds();
        const a = map.latLngToContainerPoint(b.getNorthWest());
        const c = map.latLngToContainerPoint(b.getSouthEast());
        const bw = Math.abs(c.x - a.x), bh = Math.abs(c.y - a.y);
        if (bw < Math.min(120, w * 0.9) || bh < 14) return lay.closeTooltip();
        x = (a.x + c.x) / 2; y = (a.y + c.y) / 2; area = bw * bh;
      } else {
        const ll = (lay as unknown as { getLatLng?: () => L.LatLng }).getLatLng?.();
        if (!ll || (!fewPoints && map.getZoom() < 16)) return lay.closeTooltip();
        ({ x, y } = map.latLngToContainerPoint(ll));
        y -= 14; // шошго цэгийн дээр
        area = 0;
      }
      if (x < 0 || y < 0 || x > size.x || y > size.y) return lay.closeTooltip();
      if (!lay.getTooltip?.()) {
        const point = !lay.getBounds;
        lay.bindTooltip(escapeHtml(text), {
          permanent: true,
          direction: point ? "top" : "center",
          offset: point ? L.point(0, -4) : L.point(0, 0),
          className: "dw-map-label",
          interactive: false,
          opacity: 1,
          ...(pane ? { pane } : {}),
        });
      }
      cands.push({ lay, x, y, w, area, text, point: !lay.getBounds });
    });
    // Том объект эхэнд; давхцах шошгыг нуух
    cands.sort((a, b) => b.area - a.area);
    const placed: PlacedLabel[] = [];
    const MAX = 60;
    const overlaps = (p: PlacedLabel, c: PlacedLabel) => Math.abs(p.x - c.x) < (p.w + c.w) / 2 + 4 && Math.abs(p.y - c.y) < 18;
    for (const c of cands) {
      // Ойрхон байгаа ижил нэртэй цэгүүдэд нэг л шошго (энэ давхаргад эсвэл өөр давхаргад)
      const twin =
        (c.point && placed.some((p) => p.text === c.text && Math.hypot(p.x - c.x, p.y - c.y) < 220)) ||
        others.some((p) => p.text === c.text && Math.hypot(p.x - c.x, p.y - c.y) < 60);
      const hit = twin || placed.length >= MAX || placed.some((p) => overlaps(p, c)) || others.some((p) => overlaps(p, c));
      if (hit) c.lay.closeTooltip();
      else {
        placed.push(c);
        c.lay.openTooltip();
      }
    }
    registry.set(fl, placed);
  };
  fl.on("load", update);
  // Шүүлтүүр солиход буцаж нэмэгдсэн цэгийн байнгын шошго өөрөө нээгддэг тул дахин байрлуулна
  // Эхний ачаалалтын дараа л — түүнээс өмнө сүлжээ (grid) бэлэн биш байж болно
  let again: ReturnType<typeof setTimeout> | undefined;
  fl.once("load", () =>
    fl.on("addfeature createfeature", () => {
      clearTimeout(again);
      again = setTimeout(update, 120);
    }),
  );
  // Давхаргыг унтраавал түүний шошго бусад давхаргын шошгыг нуухаа болино
  fl.on("remove", () => registry.delete(fl));
  map.on("zoomend moveend", update);
}

const POINT_SIZES: Record<string, number> = { s: 4, m: 6, l: 9 };
const zoomFactor = (z: number) => Math.min(1.4, Math.max(0.6, 0.6 + (z - 10) * 0.12));

const COLORABLE = new Set(["esriFieldTypeString", "esriFieldTypeSmallInteger", "esriFieldTypeInteger"]);
export const SYSTEM_FIELD = /^(objectid|fid|globalid|shape|creat|edit)/i;

/** Давхаргын мэдээлэл (талбарууд, геометрийн төрөл) — esri REST-ээс */
export type LayerInfo = {
  geometryType?: string;
  fields?: LayerField[];
  displayField?: string;
  drawingInfo?: { renderer?: unknown; labelingInfo?: { labelExpression?: string; labelExpressionInfo?: { expression?: string } }[] };
};

/** Давхаргын өөрийн шошгоны илэрхийллээс талбар: $feature.NAME, $feature["NAME"], [NAME] (webmap-д тохируулаагүй үед) */
export function serviceLabelField(info: LayerInfo): string | undefined {
  for (const li of info.drawingInfo?.labelingInfo ?? []) {
    const expr = li.labelExpressionInfo?.expression ?? li.labelExpression ?? "";
    const m = expr.match(/\$feature(?:\.([\p{L}\p{N}_]+)|\[\s*["']([^"']+)["']\s*\])/u) ?? expr.match(/\[([^\]]+)\]/);
    const f = m?.slice(1).find(Boolean);
    if (f) return f;
  }
  return undefined;
}
export function layerInfo(url: string, token: string | null): Promise<LayerInfo> {
  return new Promise((resolve) =>
    (esri as unknown as { request: (u: string, p: object, cb: (e: unknown, r: LayerInfo) => void) => void }).request(
      url,
      token ? { token } : {},
      (err, res) => resolve(err ? {} : res),
    ),
  );
}

/** Талбарын утгуудыг тоолж (их нь эхэнд) өнгө оноох — 7 хүртэл утга, үлдсэн нь «Бусад» */
function colorScale(url: string, token: string | null, where: string, field: string): Promise<{ value: string; color: string; n: number }[]> {
  const toScale = (counts: Map<string, number>) =>
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, n], i) => ({ value, n, color: i < 7 ? PALETTE[i] : "#8a9a96" }));
  // Утга бүрийн тоог ArcGIS дээр бүлэглэж тоолно (бичлэгийн 2000-ийн хязгаарт баригдахгүй)
  const params = new URLSearchParams({
    where,
    groupByFieldsForStatistics: field,
    outStatistics: JSON.stringify([{ statisticType: "count", onStatisticField: field, outStatisticFieldName: "n_" }]),
    f: "json",
    ...(token ? { token } : {}),
  });
  return fetch(`${url}/query`, { method: "POST", body: params })
    .then((r) => r.json())
    .then((res: { error?: unknown; features?: { attributes: Record<string, unknown> }[] }) => {
      if (res.error || !res.features?.length) throw new Error("stats");
      const counts = new Map<string, number>();
      for (const f of res.features) {
        const v = f.attributes[field];
        const k = v === null || v === undefined || v === "" ? "Хоосон" : String(v);
        counts.set(k, (counts.get(k) ?? 0) + (Number(f.attributes.n_ ?? f.attributes.N_) || 0));
      }
      return toScale(counts);
    })
    .catch(() => colorScaleFromFeatures(url, token, where, field).then(toScale));
}

function colorScaleFromFeatures(url: string, token: string | null, where: string, field: string): Promise<Map<string, number>> {
  return new Promise((resolve) => {
    let q = esri.query({ url, ...(token ? { token } : {}) } as never).where(where).fields([field]).returnGeometry(false);
    q = q.limit?.(5000) ?? q;
    q.run((err: unknown, fc: { features?: { properties: Record<string, unknown> }[] }) => {
      const counts = new Map<string, number>();
      for (const f of err ? [] : fc?.features ?? []) {
        const v = f.properties[field];
        const k = v === null || v === undefined || v === "" ? "Хоосон" : String(v);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      resolve(counts);
    });
  });
}

export default function MapWidget({ widget }: { widget: Widget }) {
  const prefs = useContext(PrefsCtx);
  const [styleOpen, setStyleOpen] = useState(false);
  const [pickers, setPickers] = useState<
    { id: string; title: string; point: boolean; fields: LayerField[]; def?: string; labelFields: LayerField[]; labelDef?: string }[]
  >([]);
  const [legends, setLegends] = useState<{ id: string; field: string; items: LegendItem[] }[]>([]);
  const home = useRef<L.LatLngBounds | null>(null);
  const colorKey = (layerId: string) => `color:${widget.id}:${layerId}`;
  const sizeKey = (layerId: string) => `size:${widget.id}:${layerId}`;
  const labelKey = (layerId: string) => `label:${widget.id}:${layerId}`;
  const { filtersFor } = useDashboard();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const featureLayers = useRef<Map<string, { layer: esri.FeatureLayer; base?: string | null }>>(new Map());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Давхарга тус бүрийн шүүлтүүр (targetId = "<mapId>#<layerId>")
  const filterKey = JSON.stringify(
    [...featureLayers.current.keys()].map((id) => [id, filtersFor(`${widget.id}#${id}`, widget.id)]),
  );

  useEffect(() => {
    if (!el.current || !widget.itemId) return;
    // zoomSnap 0.25 — анхны харагдац объектуудад бүхэл түвшингээс илүү нягт таарна
    const map = L.map(el.current, { zoomControl: true, attributionControl: true, zoomSnap: 0.25 }).setView(ERDENET, 13);
    mapRef.current = map;
    // Масштабын шугам, «анхны харагдац руу буцах» товч (томруулах товчны доор)
    L.control.scale({ imperial: false, position: "bottomright", maxWidth: 110 }).addTo(map);
    const homeBtn = L.DomUtil.create("a", "dw-map-home", map.zoomControl.getContainer());
    homeBtn.href = "#";
    homeBtn.title = "Анхны харагдац";
    homeBtn.setAttribute("role", "button");
    homeBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    L.DomEvent.on(homeBtn, "click", (e) => {
      L.DomEvent.preventDefault(e);
      if (home.current) map.fitBounds(home.current, { padding: [24, 24], maxZoom: 17 });
    });
    let cancelled = false;
    let removeGallery: (() => void) | undefined;

    api
      .webmapLayers<{ layers: MapLayer[]; basemap: string[]; basemap_title: string | null; token: string | null }>(widget.itemId)
      .then(({ layers, basemap, basemap_title, token }) => {
        if (cancelled) return;
        // Webmap-д тохируулсан Esri суурь зургаар эхэлж, хэрэглэгч gallery-ээс сольж болно
        removeGallery = addBasemapGallery(map, basemapKeyFor(basemap_title, basemap));

        const overlays: Record<string, L.Layer> = {};
        // Анхны харагдац: харагдах давхаргуудын цэг хамгийн их төвлөрсөн хэсэг рүү томруулна
        // Хил (аймаг, сум, стратегийн хил) давхаргыг тооцохгүй — өгөгдлийн давхарга (лиценз, цооног…) руу томруулна
        const extents: Promise<{ items: ExtentItem[]; bounds: L.LatLngBounds | null; boundary: boolean }>[] = [];
        for (const lyr of layers) {
          const opts = { url: lyr.url, opacity: lyr.opacity, token: token ?? undefined };
          let layer: L.Layer;
          if (lyr.kind === "feature") {
            const pr = pointRenderer(lyr.drawingInfo);
            const boundary = isBoundaryLayer(lyr);
            const pref = prefs.get(colorKey(lyr.id));
            const colorBy = pref === ONE_COLOR ? undefined : pref ?? pr?.field;
            // Webmap-ын тэмдэглэгээгээр талбай/шугам эсэх — тэдгээрийг талбараар өнгөлөх үед дүүргэлтээр будна
            const polyLike = isPolyRenderer(lyr.drawingInfo);
            const polyColor = polyLike && Boolean(pref && pref !== ONE_COLOR);
            const ownPoints = !polyLike && Boolean(pr || (pref && pref !== ONE_COLOR));
            const baseR = POINT_SIZES[prefs.get(sizeKey(lyr.id)) ?? (pref ? "m" : "s")] ?? POINT_SIZES.m;
            const radius = () => baseR * zoomFactor(map.getZoom());
            const colors = new Map<string, string>();
            const keyOf = (v: unknown) => (v === null || v === undefined || v === "" ? "Хоосон" : String(v));
            // Талбайг ангиллаар: хагас тунгалаг дүүргэлт + ижил өнгийн нарийн хүрээ; мэдээлэлгүй хүрээ бүдэг тасархай
            const polyStyle = (f?: { properties?: Record<string, unknown> }) => {
              const props = f?.properties ?? {};
              if (noData(props)) return { color: "#7d8a87", weight: 1, dashArray: "4 3", fillColor: "#7d8a87", fillOpacity: 0.05 };
              const c = colors.get(keyOf(colorBy ? props[colorBy] : undefined)) ?? "#8a9a96";
              return { color: c, weight: 1.2, opacity: 0.95, fillColor: c, fillOpacity: 0.32, dashArray: undefined };
            };
            const fl = esri.featureLayer({
              ...opts,
              where: whereOf(lyr.definitionExpression, filtersFor(`${widget.id}#${lyr.id}`, widget.id)),
              // Хил, мэдээлэлгүй хүрээ хулгана очиход тодрохгүй, дарахад сонгогдохгүй
              onEachFeature: (f: { properties?: Record<string, unknown> }, l: L.Layer) => {
                if (boundary || noData(f.properties)) (l as L.Path).options.interactive = false;
              },
              ...(hasRenderer(lyr.drawingInfo) && !ownPoints && !polyColor ? { drawingInfo: lyr.drawingInfo } : {}),
              ...(polyColor ? { ignoreRenderer: true, style: polyStyle } : {}),
              // Цэгэн давхаргад webmap-ын тэмдэглэгээний оронд өөрийн тод дугуй тэмдэг
              ...(ownPoints
                ? {
                    ignoreRenderer: true,
                    pointToLayer: (f: { properties: Record<string, unknown> }, latlng: L.LatLng) => {
                      const v = colorBy ? f.properties[colorBy] : undefined;
                      const c = !colorBy ? PALETTE[0] : colors.get(v === null || v === undefined || v === "" ? "Хоосон" : String(v)) ?? "#8a9a96";
                      return L.circleMarker(latlng, { radius: radius(), color: "#ffffff", weight: baseR >= 6 ? 1.5 : 1, fillColor: c, fillOpacity: 0.95 });
                    },
                  }
                : {}),
            } as esri.FeatureLayerOptions);
            guardEarlyMove(fl);
            if (ownPoints) {
              map.on("zoomend", () => fl.eachFeature?.((m: L.Layer) => (m as L.CircleMarker).setRadius?.(radius())));
            }
            // Тохиргоо: цэгэн давхаргад «Өнгө, хэмжээ», бүх давхаргад «Шошго»
            layerInfo(lyr.url, token).then((info) => {
              if (cancelled || !lyr.visible) return;
              const point = /point/i.test(info.geometryType ?? "");
              // Сонгогчид webmap-ын popup дахь ойлгомжтой нэрийг («Бүс» биш «Газар ашиглалтын бүс») харуулна
              const nice = (f: LayerField) => ({ ...f, alias: lyr.popup?.fields?.find((x) => x.name === f.name)?.label || f.alias });
              const fields = (info.fields ?? []).filter((f) => COLORABLE.has(f.type) && !SYSTEM_FIELD.test(f.name)).map(nice);
              const labelFields = (info.fields ?? []).filter((f) => f.type === "esriFieldTypeString" && !SYSTEM_FIELD.test(f.name)).map(nice);
              // Webmap-ын шошго GUID/системийн талбар бол шошгогүй
              const ownLabel = lyr.labelField ?? serviceLabelField(info);
              const webLabel = ownLabel && labelFields.some((f) => f.name === ownLabel) ? ownLabel : undefined;
              // Цэгт ч нэрийн талбараар («Байршлийн нэр» гэх мэт) — цөөн цэгтэй бол үргэлж, олон бол ойртуулахад (attachLabels)
              const labelDef = webLabel ?? pickLabelField(labelFields, info.displayField);
              setPickers((ps) => [
                ...ps.filter((p) => p.id !== lyr.id),
                { id: lyr.id, title: lyr.title, point, fields, def: pr?.field, labelFields, labelDef },
              ]);
              const labelPref = prefs.get(labelKey(lyr.id));
              const labelBy = labelPref === NO_LABEL ? undefined : labelPref ?? labelDef;
              (info.fields ?? []).forEach((f) => meta.fields.set(f.name, f));
              meta.labelField = labelBy ?? labelDef;
              if (labelBy) attachLabels(map, fl, labelBy);
              if (colorBy && (point || polyColor)) {
                colorScale(lyr.url, token, whereOf(lyr.definitionExpression, []), colorBy).then((items) => {
                  if (cancelled) return;
                  items.forEach((it) => colors.set(it.value, it.color));
                  if (polyColor) (fl as unknown as { setStyle: (s: typeof polyStyle) => void }).setStyle(polyStyle);
                  else fl.eachFeature?.((m: L.Layer) => {
                    const feat = (m as L.Layer & { feature?: { properties: Record<string, unknown> } }).feature;
                    const v = feat?.properties[colorBy];
                    (m as L.CircleMarker).setStyle?.({ fillColor: colors.get(v === null || v === undefined || v === "" ? "Хоосон" : String(v)) ?? "#8a9a96" });
                  });
                  // Тайлбарын гарчиг — webmap-ын popup дахь нэр («Газар ашиглалтын бүс»), эс бөгөөс alias
                  const alias = lyr.popup?.fields?.find((f) => f.name === colorBy)?.label ?? fields.find((f) => f.name === colorBy)?.alias ?? colorBy;
                  const shape = polyColor ? ("poly" as const) : ("dot" as const);
                  setLegends((ls) => [
                    ...ls.filter((l) => l.id !== lyr.id),
                    { id: lyr.id, field: alias, items: items.map((it) => ({ ...it, shape, stroke: it.color })) },
                  ]);
                });
              }
            });
            // Popup — талбарын нэр, төрлийг давхаргын мэдээлэл ирэхэд нөхнө
            const meta: PopupMeta = { layerTitle: lyr.title, popup: lyr.popup, fields: new Map() };
            fl.bindPopup((l) => popupHtml(((l as L.Layer & { feature?: { properties: Record<string, unknown> } }).feature?.properties) ?? {}, meta), {
              maxWidth: 320,
            });
            // Хулгана очиход объектыг тодруулна
            fl.on("mouseover", (e: L.LeafletMouseEvent) => {
              const t = e.layer as L.Path & { setRadius?: (r: number) => void };
              if (ownPoints) t.setRadius?.(radius() + 2);
              else {
                t.setStyle?.({ weight: 3, fillOpacity: 0.5 });
                t.bringToFront?.();
              }
            });
            fl.on("mouseout", (e: L.LeafletMouseEvent) => {
              const t = e.layer as L.Path & { setRadius?: (r: number) => void; feature?: { id?: number } };
              if (ownPoints) t.setRadius?.(radius());
              else if (t.feature?.id !== undefined) (fl as unknown as { resetStyle: (id: number) => void }).resetStyle(t.feature.id);
            });
            if (lyr.visible && !ownPoints && !polyColor) {
              const items = rendererLegend(lyr.drawingInfo);
              if (items.length) setLegends((ls) => [...ls.filter((x) => x.id !== lyr.id), { id: lyr.id, field: lyr.title, items }]);
            }
            featureLayers.current.set(lyr.id, { layer: fl, base: lyr.definitionExpression });
            // Хилийн давхаргын (нарийн, том геометр) объектыг татахгүй — анхны харагдацад оролцохгүй
            if (lyr.visible && !boundary) {
              const where = whereOf(lyr.definitionExpression, []);
              extents.push(
                new Promise((resolve) =>
                  fl.query()
                    .where(where)
                    .limit(2000)
                    .run((err, fc) => {
                      const feats = (!err && (fc as GeoJSON.FeatureCollection | undefined)?.features) || [];
                      // Объект бүр: төв (төвлөрөл олоход) ба бүтэн хүрээ (талбайг бүтнээр нь харуулахад)
                      const items: ExtentItem[] = [];
                      for (const f of feats) {
                        if (!f.geometry) continue;
                        const b = L.geoJSON(f).getBounds();
                        if (b.isValid()) items.push({ c: [b.getCenter().lat, b.getCenter().lng], b });
                      }
                      if (items.length || feats.length) return resolve({ items, bounds: null, boundary });
                      fl.query()
                        .where(where)
                        .bounds((e2, b) => resolve({ items: [], bounds: !e2 && b?.isValid() ? b : null, boundary }));
                    }),
                ),
              );
            }
            layer = fl;
          } else if (lyr.kind === "tiled") {
            layer = esri.tiledMapLayer({ ...opts, maxZoom: 20 });
          } else if (lyr.kind === "dynamic") {
            layer = esri.dynamicMapLayer(opts);
          } else {
            layer = esri.imageMapLayer(opts);
          }
          if (lyr.visible) layer.addTo(map);
          overlays[lyr.title] = layer;
        }
        if (Object.keys(overlays).length) L.control.layers({}, overlays, { collapsed: true, position: "topright" }).addTo(map);
        Promise.all(extents).then((list) => {
          if (cancelled) return;
          const data = list.some((x) => !x.boundary && (x.items.length || x.bounds)) ? list.filter((x) => !x.boundary) : list;
          const items = data.flatMap((x) => x.items);
          const target = items.length ? denseBounds(items) : data.find((x) => x.bounds)?.bounds ?? null;
          if (target?.isValid()) {
            home.current = target;
            map.fitBounds(target, { padding: [24, 24], maxZoom: 17 });
          }
        });
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      cancelled = true;
      setPickers([]);
      setLegends([]);
      removeGallery?.();
      ro.disconnect();
      featureLayers.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.itemId, widget.id, prefs.version]);

  // Шүүлтүүр өөрчлөгдөхөд feature давхаргын where-г шинэчилнэ
  useEffect(() => {
    for (const [id, { layer, base }] of featureLayers.current) {
      layer.setWhere(whereOf(base, filtersFor(`${widget.id}#${id}`, widget.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  return (
    <Panel widget={widget} loading={loading} error={error} tight>
      <div className="dw-map-wrap">
        <div ref={el} className="dw-map" />
        {pickers.length > 0 && (
          <div className={`dw-map-color ${styleOpen ? "open" : ""}`}>
            <button className="dw-map-style-btn" onClick={() => setStyleOpen(!styleOpen)} title="Тэмдэглэгээ, шошго" aria-expanded={styleOpen}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M12 3a9 9 0 100 18c1.1 0 1.5-.8 1.5-1.5 0-.9-.7-1.3-.7-2.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 004-4C21 6.6 17 3 12 3z" />
                <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
                <circle cx="10" cy="7" r="1.2" fill="currentColor" />
                <circle cx="15" cy="7" r="1.2" fill="currentColor" />
              </svg>
            </button>
            {styleOpen && (
              <div className="dw-map-style-panel">
                <div className="ttl">Тэмдэглэгээ, шошго</div>
                {pickers.map((pk) => (
                  <div key={pk.id} className="dw-map-style-row">
                    {pickers.length > 1 && <span className="lyr" title={pk.title}>{pk.title}</span>}
                    <div className="ctl">
                      <span className="dw-map-ctl-lbl">Өнгө</span>
                      <select value={prefs.get(colorKey(pk.id)) ?? ""} onChange={(e) => prefs.set(colorKey(pk.id), e.target.value || null)} aria-label="Өнгөлөх талбар">
                        <option value="">
                          {pk.def ? `Үндсэн — ${pk.fields.find((f) => f.name === pk.def)?.alias || pk.def}` : "Үндсэн"}
                        </option>
                        {pk.point && <option value={ONE_COLOR}>Нэг өнгөөр</option>}
                        {pk.fields.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.alias || f.name}
                          </option>
                        ))}
                      </select>
                      {pk.point && (
                        <span className="dw-size" role="group" aria-label="Цэгийн хэмжээ">
                          {(["s", "m", "l"] as const).map((k) => (
                            <button
                              key={k}
                              className={(prefs.get(sizeKey(pk.id)) ?? (prefs.get(colorKey(pk.id)) ? "m" : "s")) === k ? "on" : ""}
                              onClick={() => prefs.set(sizeKey(pk.id), k)}
                              title={{ s: "Жижиг цэг", m: "Дунд цэг", l: "Том цэг" }[k]}
                            >
                              <i style={{ width: POINT_SIZES[k] + 2, height: POINT_SIZES[k] + 2 }} />
                            </button>
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="ctl">
                      <span className="dw-map-ctl-lbl">Шошго</span>
                      <select value={prefs.get(labelKey(pk.id)) ?? ""} onChange={(e) => prefs.set(labelKey(pk.id), e.target.value || null)} aria-label="Шошгоны талбар">
                        <option value="">
                          {pk.labelDef ? `Үндсэн — ${pk.labelFields.find((f) => f.name === pk.labelDef)?.alias || pk.labelDef}` : "Үндсэн — шошгогүй"}
                        </option>
                        <option value={NO_LABEL}>Шошгогүй</option>
                        {pk.labelFields.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.alias || f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {legends.length > 0 && (
          <div className="dw-map-legends">
            {legends.map((lg) => (
              <div key={lg.id} className="dw-map-legend">
                <b title={lg.field}>{lg.field}</b>
                {lg.items.slice(0, 8).map((it) => (
                  <span key={it.value} title={it.value}>
                    <i className={it.shape ?? "dot"} style={{ background: it.color, ...(it.shape === "dot" ? {} : { borderColor: it.stroke }) }} />
                    {it.value}
                    <em>{it.n ?? ""}</em>
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

