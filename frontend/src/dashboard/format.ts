import type { Field, NumberFormat } from "./types";

/** Ангиллын палитр — бараан дэвсгэр дээр шалгагдсан, тогтмол дарааллаар */
export const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const ACCENT = "#34d0ae";
export const MAX_SERIES = PALETTE.length;

export function formatNumber(v: unknown, fmt?: NumberFormat): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const max = fmt?.maximumFractionDigits ?? (Math.abs(n) >= 100 ? 0 : 2);
  const min = Math.min(fmt?.minimumFractionDigits ?? 0, max);
  const text =
    fmt?.style === "percent"
      ? (n * 100).toLocaleString("mn-MN", { minimumFractionDigits: min, maximumFractionDigits: max }) + "%"
      : n.toLocaleString("mn-MN", {
          minimumFractionDigits: min,
          maximumFractionDigits: max,
          useGrouping: fmt?.useGrouping ?? true,
        });
  return `${fmt?.valuePrefix ?? ""}${text}${fmt?.valueSuffix ? " " + fmt.valueSuffix : ""}`;
}

/** 1.2 мян / 3.4 сая / 5.6 тэрбум — тэнхлэгийн шошгонд */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)} тэрбум`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)} сая`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(1)} мян`;
  return n.toLocaleString("mn-MN", { maximumFractionDigits: 2 });
}

export function formatDate(ms: unknown, withTime = false): string {
  const n = Number(ms);
  if (!Number.isFinite(n)) return String(ms ?? "—");
  const d = new Date(n);
  const p = (x: number) => String(x).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

/** Талбарын утгыг хүнд уншигдах хэлбэрт: домэйн нэр, огноо, тоо */
export function displayValue(v: unknown, field?: Field): string {
  if (v === null || v === undefined) return "—";
  if (field?.domain && String(v) in field.domain) return field.domain[String(v)];
  if (field?.type === "esriFieldTypeDate") return formatDate(v);
  if (typeof v === "number") {
    const names = `${field?.name ?? ""} ${field?.alias ?? ""}`;
    // Он «2,007» биш «2007»
    if (Number.isInteger(v) && v >= 1900 && v <= 2100 && /(^|[\s_])(он|year|жил|ognoo)([\s_]|$)/i.test(names)) return String(v);
    // Координат «104» биш «104.0123»
    if (/^(x|y|lat|lon|lng|latitude|longitude|өргөрөг|уртраг)$/i.test(field?.name ?? "")) {
      return v.toLocaleString("mn-MN", { maximumFractionDigits: 6, useGrouping: false });
    }
    return formatNumber(v);
  }
  return String(v);
}

export function stripHtml(html?: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return tameCaps((doc.body.textContent ?? "").replace(/\s+/g, " ").trim());
}

/**
 * Бүтэн том үсгээр бичсэн кирилл гарчгийг («ЦООНОГИЙН НИЙТ ГҮН, М») энгийн бичиглэлд оруулна.
 * Латин товчлол (COLLAR, NW) хэвээр; нэг үгтэй товчлол (ХАБЭА) хөндөгдөхгүй.
 */
export function tameCaps(text: string): string {
  if (/\p{Ll}/u.test(text) || !/[Ѐ-ӿ]/.test(text)) return text;
  if ((text.match(/[Ѐ-ӿ]{4,}/g) ?? []).length < 2) return text;
  const out = text.replace(/[Ѐ-ӿ]+/g, (w) => w.toLowerCase());
  return out.replace(/[Ѐ-ӿ]/, (c) => c.toUpperCase());
}

const ALLOWED_TAGS = new Set([
  "P", "DIV", "SPAN", "STRONG", "B", "EM", "I", "U", "BR", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI",
  "A", "IMG", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "FONT", "SUB", "SUP", "HR", "BLOCKQUOTE",
]);
const ALLOWED_ATTRS = new Set(["href", "src", "alt", "title", "style", "colspan", "rowspan", "align", "color", "width", "height", "target"]);

/** ArcGIS rich text-ийг аюулгүй болгоно: script, event handler, javascript: URL-ыг хасна */
export function sanitizeHtml(html?: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const bad = /^\s*javascript:/i.test(attr.value) || (name === "style" && /expression|url\(/i.test(attr.value));
        if (!ALLOWED_ATTRS.has(name) || bad) child.removeAttribute(attr.name);
      }
      if (child.tagName === "A") {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noreferrer");
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** "{field}" загварыг мөрийн утгаар орлуулна (list, details виджет) */
export function fillTemplate(tpl: string, row: Record<string, unknown>, fields: Field[]): string {
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
  return tpl.replace(/\{(?:field\/)?([^{}]+)\}/g, (_, key: string) => {
    if (!(key in row)) return "";
    const v = row[key];
    // Он, сар зэрэг 4-өөс бага оронтой бүхэл тоонд мянгатын таслал тавихгүй (2013, 2,013 биш)
    if (typeof v === "number" && Number.isInteger(v) && Math.abs(v) < 10000 && !byName[key]?.domain) return String(v);
    return escapeHtml(displayValue(v, byName[key]));
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const rgba = (c?: number[]) =>
  c && c.length >= 3 ? `rgba(${c[0]},${c[1]},${c[2]},${c.length > 3 ? +(c[3] / 255).toFixed(2) : 1})` : undefined;
