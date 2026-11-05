import { createContext, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import * as esri from "esri-leaflet";
import "esri-leaflet-renderers";
import { api } from "../api";
import { addBasemapGallery, basemapKeyFor } from "../components/basemaps";
import { IconLayers, IconSearch } from "../components/icons";
import {
  attachLabels,
  guardEarlyMove,
  hasRenderer,
  isBoundaryLayer,
  layerInfo,
  LayerField,
  LayerInfo,
  MapLayer,
  noData,
  popupHtml,
  PopupMeta,
  serviceLabelField,
  SYSTEM_FIELD,
  whereOf,
  Map3D,
  MapDimSwitch,
} from "../dashboard/MapWidget";
import { displayValue, formatDate, stripHtml } from "../dashboard/format";
import type { Field } from "../dashboard/types";
import { fmtArea, fmtLength, pathLength, polygonArea, toUtm } from "./geoMath";
import "../dashboard/dashboard.css";

const WEBMAP = "ded3c591f7e7448e85abc4a4c7dfb77e";
const ARCGIS_APP = "https://erdenetmining.maps.arcgis.com/apps/instant/atlas/index.html?appid=a4df590b646243dcbf7c2288b4c85b7b";
const ITEM_URL = "https://erdenetmining.maps.arcgis.com/home/item.html?id=";
const LEGEND_MAX = 12;
const TABLE_MAX = 500;
const NUMERIC_FIELD = /Integer|Double|Single/;
const STORE_ON = "emc-geodata-on";
/** Сумын нэр манай «Сумын хил» давхаргаас монголоор гардаг тул суурь зургийн англи нэрийг нууна */
const HIDE_BASEMAP_LABELS = /^Admin2 area\/label|admin2 capital/;
const HILITE = "#ff2bb8";
/** Объектын нэрээр хайх давхаргууд (webmap-ын нэр → хайх талбарууд) */
const SEARCH_FIELDS: Record<string, string[]> = {
  "Лицензийн талбай": ["Name", "LIC_ID"],
  "Хэтийн төлөвтэй талбай": ["Name"],
  "Ашиглалтын ТЗ-ийн талбай": ["Name"],
  "Хайгуулын ТЗ-ийн талбай": ["Name"],
  "Овоолгийн мэдээлэл": ["NAME"],
  "Цооногийн амсрын өгөгдөл": ["HOLEID"],
  "Сумын хил": ["namemon"],
  "Зэс порфирын илрэл, эрдэсжсэн цэгүүд": ["NAME"],
};
/** Web Mercator-ийн 0-р түвшний масштаб — масштабаас томролт олоход */
const ZOOM0_SCALE = 591657527.591555;

type GroupNode = { id: string; title: string; itemId?: string | null; children: TreeNode[] };
type Leaf = MapLayer & { itemId?: string | null };
type TreeNode = GroupNode | Leaf;
type TreeOut = {
  tree: TreeNode[];
  extent: { xmin: number; ymin: number; xmax: number; ymax: number } | null;
  basemap: string[];
  basemap_title: string | null;
  token: string | null;
};
type RowState = "busy" | "error";
type Tool = "legend" | "info";
type Hit = { lyr: Leaf; label: string; oid: string; id: unknown };
type Measure = { mode: "line" | "area"; pts: L.LatLng[]; live: L.LatLng | null };
/** Сервисийн мэдээлэл — тэмдэглэгээ, талбараас гадна тайлбар, огноо, хүрээ */
type SvcInfo = Omit<LayerInfo, "fields"> & {
  fields?: (LayerField & { domain?: { codedValues?: { name: string; code: unknown }[] } | null })[];
  objectIdField?: string;
  description?: string;
  serviceDescription?: string;
  copyrightText?: string;
  editingInfo?: { lastEditDate?: number };
  fullExtent?: { xmin: number; ymin: number; xmax: number; ymax: number };
  minScale?: number;
  maxScale?: number;
};
type TableState = {
  lyr: Leaf;
  fields: Field[];
  oid?: string;
  rows: Record<string, unknown>[];
  total: number | null;
  loading: boolean;
  more?: boolean;
  error?: string;
};

const isGroup = (n: TreeNode): n is GroupNode => "children" in n;
const leavesOf = (n: TreeNode): Leaf[] => (isGroup(n) ? n.children.flatMap(leavesOf) : [n]);
/** Масштабын хязгаар → Leaflet-ийн томролт: зураг нь тодорхой масштабд л tile-тай */
const zoomOfScale = (scale?: number) => (scale ? Math.log2(ZOOM0_SCALE / scale) : undefined);
const sqlText = (v: string) => `'${v.replace(/'/g, "''")}'`;
const whereOid = (oid: string, id: unknown) => `${oid}=${typeof id === "number" ? id : sqlText(String(id))}`;

// ---- Тайлбар: webmap-ын эсвэл давхаргын өөрийн тэмдэглэгээнээс
type Sym = { type?: string; color?: number[]; outline?: { color?: number[] }; imageData?: string; contentType?: string; url?: string };
type Rend = {
  type?: string;
  label?: string;
  symbol?: Sym;
  defaultSymbol?: Sym;
  defaultLabel?: string;
  uniqueValueInfos?: { label?: string; value?: unknown; symbol?: Sym }[];
  classBreakInfos?: { label?: string; classMaxValue?: number; symbol?: Sym }[];
};
type LegendRow = { label: string; sym?: Sym };

function legendRows(drawingInfo: unknown): LegendRow[] {
  const r = (drawingInfo as { renderer?: Rend } | undefined)?.renderer;
  if (!r) return [];
  if (r.type === "simple") return [{ label: r.label ?? "", sym: r.symbol }];
  const infos = r.uniqueValueInfos ?? r.classBreakInfos ?? [];
  const rows = infos.map((i) => ({
    label: i.label || String((i as { value?: unknown }).value ?? (i as { classMaxValue?: number }).classMaxValue ?? ""),
    sym: i.symbol,
  }));
  return r.defaultSymbol ? [...rows, { label: r.defaultLabel || "Бусад", sym: r.defaultSymbol }] : rows;
}

const rgba = (c?: number[]) => (c && c.length >= 3 ? `rgba(${c[0]},${c[1]},${c[2]},${((c[3] ?? 255) / 255).toFixed(2)})` : "transparent");

function Swatch({ sym }: { sym?: Sym }) {
  if (sym?.type === "esriPMS") {
    const src = sym.imageData ? `data:${sym.contentType ?? "image/png"};base64,${sym.imageData}` : sym.url;
    if (src) return <span className="geo-sw"><img src={src} alt="" /></span>;
  }
  if (sym?.type === "esriSLS") return <span className="geo-sw"><i className="line" style={{ borderColor: rgba(sym.color) }} /></span>;
  if (sym?.type === "esriSMS") return <span className="geo-sw"><i className="dot" style={{ background: rgba(sym.color), borderColor: rgba(sym.outline?.color ?? sym.color) }} /></span>;
  return <span className="geo-sw"><i className="poly" style={{ background: rgba(sym?.color), borderColor: rgba(sym?.outline?.color ?? sym?.color) }} /></span>;
}

function LegendList({ rows, fallback }: { rows: LegendRow[]; fallback?: string }) {
  return (
    <ul>
      {rows.slice(0, LEGEND_MAX).map((r, i) => (
        <li key={i}>
          <Swatch sym={r.sym} />
          <span>{r.label || fallback}</span>
        </li>
      ))}
      {rows.length > LEGEND_MAX && <li className="more">+{rows.length - LEGEND_MAX}</li>}
    </ul>
  );
}

// ---- Хэрэгслийн дүрсүүд
const ToolIcon = ({ d }: { d: React.ReactNode }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const ICONS = {
  zoom: <><circle cx="12" cy="12" r="6" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  legend: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" /><circle cx="4.5" cy="12" r="1.2" /><circle cx="4.5" cy="18" r="1.2" /></>,
  swipe: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 2v20" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M10 10v10" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
};

// ---- Мөрүүдэд хэрэгтэй төлөв, үйлдлүүд
type Ctx = {
  on: Set<string>;
  open: Set<string>;
  states: Record<string, RowState>;
  infos: Record<string, SvcInfo>;
  counts: Record<string, number | null>;
  trans: Record<string, number>;
  zoom: number;
  menuId: string | null;
  tool: Tool | null;
  swipeId: string | null;
  tableId: string | null;
  toggle: (ids: string[], value: boolean) => void;
  toggleOpen: (id: string) => void;
  toggleMenu: (node: TreeNode, row: HTMLElement) => void;
  closeMenu: () => void;
  pickTool: (node: TreeNode, t: Tool) => void;
  setTrans: (ids: string[], v: number) => void;
  zoomTo: (node: TreeNode) => void;
  startSwipe: (lyr: Leaf) => void;
  openTable: (lyr: Leaf) => void;
};
const GeoCtx = createContext<Ctx>(null as unknown as Ctx);

const GEOMETRY: Record<string, string> = {
  esriGeometryPoint: "Цэг",
  esriGeometryMultipoint: "Цэг",
  esriGeometryPolyline: "Шугам",
  esriGeometryPolygon: "Талбай",
};

/** «⋯» дарахад самбарын хажууд гарах цэс. Бүлэгт: очих, тунгалаг, мэдээлэл; давхаргад бүгд */
function LayerMenu({ node, top }: { node: TreeNode; top: number }) {
  const c = useContext(GeoCtx);
  const box = useRef<HTMLDivElement>(null);
  // Агуулга өөрчлөгдөхөд ч дэлгэцээс гарахгүй
  useLayoutEffect(() => {
    const el = box.current;
    const parent = el?.parentElement;
    if (el && parent) el.style.top = `${Math.max(12, Math.min(top, parent.clientHeight - el.offsetHeight - 12))}px`;
  });
  const group = isGroup(node);
  const leaves = leavesOf(node);
  const feature = !group && node.kind === "feature";
  // Газрын зураг дээр ажиллах үйлдэл — цэс хаагдаж зургийг халхлахгүй
  const act = (fn: () => void) => () => {
    c.closeMenu();
    fn();
  };
  const btn = (key: keyof typeof ICONS, label: string, onClick: () => void, active = false) => (
    <button className={`geo-tool ${active ? "on" : ""}`} data-tool={key} onClick={onClick}>
      <ToolIcon d={ICONS[key]} />
      {label}
    </button>
  );
  const info = c.infos[node.id];
  const rows = !group ? legendRows(node.drawingInfo ?? info?.drawingInfo) : [];
  const t = c.trans[leaves[0]?.id] ?? 0;
  const desc = stripHtml(info?.description || info?.serviceDescription);
  const count = c.counts[node.id];
  const edited = info?.editingInfo?.lastEditDate;
  return (
    <div className="geo-pop" ref={box}>
      <h4>{node.title}</h4>
      <label className="geo-opacity">
        <span>Тунгалаг</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={t}
          aria-label="Тунгалаг"
          onChange={(e) => c.setTrans(leaves.map((l) => l.id), Number(e.target.value))}
        />
        <b>{t}%</b>
      </label>
      {btn("zoom", "Очих", act(() => c.zoomTo(node)))}
      {feature && btn("table", "Хүснэгт", act(() => c.openTable(node)), c.tableId === node.id)}
      {!group && btn("swipe", "Харьцуулах", act(() => c.startSwipe(node)), c.swipeId === node.id)}
      {feature && btn("legend", "Тайлбар", () => c.pickTool(node, "legend"), c.tool === "legend")}
      {c.tool === "legend" && (
        <div className="geo-lg">{rows.length ? <LegendList rows={rows} fallback={node.title} /> : <div className="geo-note">{info ? "Тайлбар алга" : "Ачаалж байна…"}</div>}</div>
      )}
      {btn("info", "Мэдээлэл", () => c.pickTool(node, "info"), c.tool === "info")}
      {c.tool === "info" && (
        <dl className="geo-info">
          {group ? (
            <>
              <dt>Давхарга</dt>
              <dd>{leaves.length}</dd>
            </>
          ) : (
            <>
              <dt>Төрөл</dt>
              <dd>{node.kind === "feature" ? GEOMETRY[info?.geometryType ?? ""] ?? "…" : "Зураг"}</dd>
              {node.kind === "feature" && (
                <>
                  <dt>Объект</dt>
                  <dd>{count === undefined ? "…" : count === null ? "—" : count.toLocaleString("mn-MN")}</dd>
                </>
              )}
              {edited ? (
                <>
                  <dt>Шинэчилсэн</dt>
                  <dd>{formatDate(edited)}</dd>
                </>
              ) : null}
              {info?.copyrightText ? (
                <>
                  <dt>Эх сурвалж</dt>
                  <dd>{stripHtml(info.copyrightText)}</dd>
                </>
              ) : null}
              {desc && <dd className="wide">{desc}</dd>}
            </>
          )}
          {node.itemId && (
            <dd className="wide">
              <a href={`${ITEM_URL}${node.itemId}`} target="_blank" rel="noreferrer">
                ArcGIS-д нээх ↗
              </a>
            </dd>
          )}
        </dl>
      )}
    </div>
  );
}

const MoreBtn = ({ node }: { node: TreeNode }) => {
  const c = useContext(GeoCtx);
  const isOn = c.menuId === node.id;
  return (
    <button
      className={`geo-more ${isOn ? "on" : ""}`}
      title="Хэрэгслүүд"
      aria-label={`${node.title} — хэрэгслүүд`}
      aria-expanded={isOn}
      onClick={(e) => {
        e.stopPropagation();
        c.toggleMenu(node, e.currentTarget.closest(".geo-row") as HTMLElement);
      }}
    >
      ⋯
    </button>
  );
};

/** Давхаргын мөр: бүлэг бол дэлгэгдэнэ, сонголт нь доторх бүх давхаргад үйлчилнэ */
function Row({ node, path }: { node: TreeNode; path?: string }) {
  const c = useContext(GeoCtx);
  const box = useRef<HTMLInputElement>(null);
  const leaves = useMemo(() => leavesOf(node), [node]);
  const count = leaves.filter((l) => c.on.has(l.id)).length;
  const all = count === leaves.length;
  useEffect(() => {
    if (box.current) box.current.indeterminate = count > 0 && !all;
  }, [count, all]);

  if (!isGroup(node)) {
    const empty = c.counts[node.id] === 0;
    const minZoom = zoomOfScale(c.infos[node.id]?.minScale);
    const far = all && !empty && node.kind !== "feature" && minZoom !== undefined && c.zoom < Math.floor(minZoom + 0.01);
    // Холоос зураг татахгүй тул ачаалж буй тэмдэг хэрэггүй
    const st = empty || far ? undefined : c.states[node.id];
    return (
      <div className={`geo-row ${all ? "on" : ""} ${far ? "far" : ""} ${c.menuId === node.id ? "menu" : ""}`}>
        <label className="geo-check">
          <input type="checkbox" checked={all} onChange={(e) => c.toggle([node.id], e.target.checked)} />
          <span className="nm">
            {node.title}
            {path && <small>{path}</small>}
          </span>
        </label>
        {st === "busy" && <i className="busy" aria-label="Ачаалж байна" />}
        {st === "error" && <span className="err" title="Өгөгдөл ачаалж чадсангүй">!</span>}
        {empty && <span className="n" title="Энэ давхаргад бичлэг алга">Хоосон</span>}
        {far && (
          <button className="geo-far" title="Энэ зураг ойртуулсан үед л харагдана" onClick={() => c.zoomTo(node)}>
            Ойртуулах
          </button>
        )}
        <MoreBtn node={node} />
      </div>
    );
  }
  const isOpen = c.open.has(node.id);
  return (
    <>
      <div className={`geo-row group ${count ? "on" : ""} ${isOpen ? "open" : ""} ${c.menuId === node.id ? "menu" : ""}`} onClick={() => c.toggleOpen(node.id)} aria-expanded={isOpen}>
        <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 6l6 6-6 6" />
        </svg>
        <input
          ref={box}
          type="checkbox"
          checked={all}
          aria-label={node.title}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => c.toggle(leaves.map((l) => l.id), e.target.checked)}
        />
        <span className="nm">{node.title}</span>
        {count > 0 && <span className="n">{count}/{leaves.length}</span>}
        <MoreBtn node={node} />
      </div>
      {isOpen && (
        <div className="geo-kids">
          {[...node.children].reverse().map((k) => (
            <Row key={k.id} node={k} />
          ))}
        </div>
      )}
    </>
  );
}

export default function Geodata() {
  const el = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const built = useRef<Map<string, L.Layer>>(new Map());
  const pending = useRef<Set<string>>(new Set());
  const infoCache = useRef<Map<string, Promise<SvcInfo>>>(new Map());
  const [ready, setReady] = useState(0);
  const [data, setData] = useState<TreeOut | null>(null);
  const [error, setError] = useState("");
  const [on, setOn] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [infos, setInfos] = useState<Record<string, SvcInfo>>({});
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [trans, setTransState] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<{ node: TreeNode; top: number } | null>(null);
  const [q, setQ] = useState("");
  const [tool, setTool] = useState<Tool | null>(null);
  const [swipe, setSwipe] = useState<{ id: string; title: string; x: number } | null>(null);
  const [table, setTable] = useState<TableState | null>(null);
  const [panel, setPanel] = useState(true);
  const [zoom, setZoom] = useState(10);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [sort, setSort] = useState<{ f: string; desc: boolean } | null>(null);
  const [selected, setSelected] = useState<{ layerId: string; id: unknown } | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [dim, setDim] = useState<"2d" | "3d">("2d");
  const coordEl = useRef<HTMLDivElement>(null);
  const homeBounds = useRef<L.LatLngBounds | null>(null);
  const defaults = useRef<string[]>([]);
  const highlight = useRef<L.Layer | null>(null);
  const measureLayer = useRef<L.LayerGroup | null>(null);
  const setMeasureRef = useRef(setMeasure);
  const [tab, setTab] = useState<"layers" | "legend">("layers");

  // Webmap-ын дарааллаар (доороос дээш) — дараа асаасан давхарга ч зөв давхраандаа зурагдана
  const leaves = useMemo(() => (data?.tree ?? []).flatMap(leavesOf), [data]);
  const paneOf = (id: string) => `geo-${leaves.findIndex((l) => l.id === id)}`;

  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { zoomControl: false, zoomSnap: 0.25 }).setView([49.02, 104.12], 10);
    mapRef.current = map;
    const zoomCtl = L.control.zoom({ position: "topright" }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomright", maxWidth: 110 }).addTo(map);
    const barBtn = (cls: string, title: string, svg: string, onClick: () => void) => {
      const a = L.DomUtil.create("a", cls, zoomCtl.getContainer());
      a.href = "#";
      a.title = title;
      a.setAttribute("role", "button");
      a.setAttribute("aria-label", title);
      a.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svg}</svg>`;
      L.DomEvent.on(a, "click", (e) => {
        L.DomEvent.stop(e);
        onClick();
      });
    };
    barBtn("geo-home", "Анхны харагдац", '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>', () => {
      if (homeBounds.current) map.fitBounds(homeBounds.current, { paddingTopLeft: [330, 0] });
    });
    barBtn("geo-ruler", "Хэмжих", '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>', () =>
      setMeasureRef.current((v) => (v ? null : { mode: "line", pts: [], live: null })),
    );
    const showCoord = (e: L.LeafletMouseEvent) => {
      if (!coordEl.current) return;
      const u = toUtm(e.latlng);
      coordEl.current.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}  ·  UTM ${u.zone}N  ${Math.round(u.east)} / ${Math.round(u.north)}`;
    };
    map.on("mousemove", showCoord);
    map.on("zoomend", () => setZoom(map.getZoom()));
    map.on("click", () => {
      if (highlight.current) map.removeLayer(highlight.current);
      highlight.current = null;
      setSelected(null);
    });
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    let removeGallery: (() => void) | undefined;
    let cancelled = false;
    api
      .webmapTree<TreeOut>(WEBMAP)
      .then((d) => {
        if (cancelled) return;
        removeGallery = addBasemapGallery(map, basemapKeyFor(d.basemap_title, d.basemap), false, HIDE_BASEMAP_LABELS);
        if (d.extent) {
          const toLatLng = (x: number, y: number) => L.CRS.EPSG3857.unproject(L.point(x, y));
          homeBounds.current = L.latLngBounds(toLatLng(d.extent.xmin, d.extent.ymin), toLatLng(d.extent.xmax, d.extent.ymax));
          map.fitBounds(homeBounds.current, { paddingTopLeft: [330, 0] });
        }
        setZoom(map.getZoom());
        const all = d.tree.flatMap(leavesOf);
        defaults.current = all.filter((l) => l.visible).map((l) => l.id);
        // Энэ хөтөч дээр сүүлд асаасан давхаргууд, байхгүй бол webmap-ын анхных
        let saved: string[] | null = null;
        try {
          saved = JSON.parse(localStorage.getItem(STORE_ON) ?? "null");
        } catch {
          /* хадгалах боломжгүй */
        }
        const known = new Set(all.map((l) => l.id));
        setOn(new Set(Array.isArray(saved) ? saved.filter((id) => known.has(id)) : defaults.current));
        setData(d);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      removeGallery?.();
      ro.disconnect();
      built.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /** Сервисийн мэдээллийг нэг л удаа татна */
  const loadInfo = (lyr: Leaf): Promise<SvcInfo> => {
    let p = infoCache.current.get(lyr.id);
    if (!p) {
      p = layerInfo(lyr.url, data?.token ?? null).then((info) => {
        setInfos((prev) => ({ ...prev, [lyr.id]: info as SvcInfo }));
        return info as SvcInfo;
      });
      infoCache.current.set(lyr.id, p);
    }
    return p;
  };

  const queryJson = (lyr: Leaf, params: Record<string, string>) =>
    fetch(`${lyr.url}/query`, {
      method: "POST",
      body: new URLSearchParams({ where: whereOf(lyr.definitionExpression, []), f: "json", ...params, ...(data?.token ? { token: data.token } : {}) }),
    }).then((r) => r.json());

  // Давхаргыг анх асаахад л үүсгэж, дараа нь дахин ашиглана.
  // Тэмдэглэгээг урьдчилан татаж өгнө — эс бөгөөс esri-leaflet давхаргаа хожуу эхлүүлж, тэр хооронд газрын зураг хөдөлбөл алдаа заана.
  // Давхарга бүр өөрийн pane-д — webmap-ын дараалал, тунгалаг, харьцуулалт pane дээр хийгдэнэ.
  const prepare = async (lyr: Leaf, order: number, token: string | null): Promise<L.Layer> => {
    const map = mapRef.current!;
    const setState = (s: RowState) => setStates((prev) => ({ ...prev, [lyr.id]: s }));
    const pane = `geo-${order}`;
    const labelPane = `geo-label-${order}`;
    const opts = { url: lyr.url, opacity: lyr.opacity ?? 1, token: token ?? undefined, pane };
    if (!map.getPane(pane)) map.createPane(pane).style.zIndex = String(410 + order);
    // Шошго өөрийн давхраанд — бусад объектын дээр, гэхдээ тунгалаг, харьцуулалт давхаргатайгаа хамт
    if (!map.getPane(labelPane)) map.createPane(labelPane).style.zIndex = "650";
    const info = await loadInfo(lyr);
    let layer: L.Layer;
    if (lyr.kind === "feature") {
      const drawingInfo = hasRenderer(lyr.drawingInfo) ? lyr.drawingInfo : info.drawingInfo;
      if (counts[lyr.id] === undefined) {
        queryJson(lyr, { returnCountOnly: "true" })
          .then((r: { count?: number }) => setCounts((prev) => ({ ...prev, [lyr.id]: r.count ?? null })))
          .catch(() => undefined);
      }
      const boundary = isBoundaryLayer(lyr);
      const fl = esri.featureLayer({
        ...opts,
        where: whereOf(lyr.definitionExpression, []),
        onEachFeature: (f: { properties?: Record<string, unknown> }, l: L.Layer) => {
          if (boundary || noData(f.properties)) (l as L.Path).options.interactive = false;
        },
        ...(drawingInfo ? { drawingInfo } : {}),
      } as esri.FeatureLayerOptions);
      guardEarlyMove(fl);
      const meta: PopupMeta = { layerTitle: lyr.title, popup: lyr.popup, fields: new Map<string, LayerField>() };
      (info.fields ?? []).forEach((f) => meta.fields.set(f.name, f));
      fl.bindPopup((l) => popupHtml((l as L.Layer & { feature?: { properties: Record<string, unknown> } }).feature?.properties ?? {}, meta), { maxWidth: 320 });
      const label = lyr.labelField ?? serviceLabelField(info as LayerInfo);
      if (label && (info.fields ?? []).some((f) => f.name === label)) {
        meta.labelField = label;
        attachLabels(map, fl, label, labelPane);
      }
      // Түр зуурын сүлжээний алдаанд нэг удаа дахин ачаална; дахин бүтэлгүйтвэл мөрөнд «!» гарна
      let failed = false;
      let retried = false;
      fl.on("requesterror", () => {
        failed = true;
      });
      fl.on("load", () => {
        if (!failed) {
          retried = false;
          return;
        }
        failed = false;
        if (retried) return setState("error");
        retried = true;
        (fl as unknown as { refresh: () => void }).refresh();
      });
      layer = fl;
    } else {
      // Масштабаас гадуур tile байхгүй: холоос хүсэлт явуулахгүй, хамгийн ойрхоос цааш томруулж харуулна
      const minZoom = zoomOfScale(info.minScale);
      const maxNative = zoomOfScale(info.maxScale);
      if (lyr.kind === "tiled")
        layer = esri.tiledMapLayer({
          ...opts,
          maxZoom: 20,
          ...(minZoom !== undefined ? { minZoom: Math.max(0, Math.floor(minZoom + 0.01)) } : {}),
          ...(maxNative !== undefined ? { maxNativeZoom: Math.min(20, Math.floor(maxNative + 0.01)) } : {}),
        });
      else if (lyr.kind === "dynamic") layer = esri.dynamicMapLayer(opts);
      else layer = esri.imageMapLayer(opts);
    }
    layer.on("loading", () => setState("busy"));
    layer.on("load", () => setStates((prev) => (prev[lyr.id] === "busy" ? setStateClear(prev, lyr.id) : prev)));
    return layer;
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    leaves.forEach((lyr, i) => {
      const want = on.has(lyr.id);
      if (!want) setStates((prev) => setStateClear(prev, lyr.id));
      const layer = built.current.get(lyr.id);
      if (want && !layer && !pending.current.has(lyr.id)) {
        pending.current.add(lyr.id);
        setStates((prev) => ({ ...prev, [lyr.id]: "busy" }));
        prepare(lyr, i, data.token).then((l) => {
          if (!mapRef.current) return;
          built.current.set(lyr.id, l);
          pending.current.delete(lyr.id);
          setStates((prev) => (prev[lyr.id] === "busy" ? setStateClear(prev, lyr.id) : prev));
          setReady((n) => n + 1);
        });
      }
      if (!layer) return;
      if (want && !map.hasLayer(layer)) layer.addTo(map);
      if (!want && map.hasLayer(layer)) map.removeLayer(layer);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, data, leaves, ready]);

  // Тунгалаг — давхаргын pane дээр
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    leaves.forEach((l, i) => {
      for (const name of [`geo-${i}`, `geo-label-${i}`]) {
        const pane = map.getPane(name);
        if (pane) pane.style.opacity = String(1 - (trans[l.id] ?? 0) / 100);
      }
    });
  }, [trans, leaves, ready]);

  // Харьцуулах: сонгосон давхарга зөвхөн зурааснаас зүүн талд харагдана.
  // Pane нь газрын зурагтай хамт хөдөлдөг тул хайчлах хүрээг хөдөлгөөн бүрт дахин тооцоолно
  const swipeOn = swipe && on.has(swipe.id) ? swipe : null;
  const swipeId = swipeOn?.id ?? null;
  const swipeX = swipeOn?.x ?? 0;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !swipeId) return;
    const name = paneOf(swipeId);
    const names = [name, name.replace("geo-", "geo-label-")];
    const update = () => {
      const size = map.getSize();
      const tl = map.containerPointToLayerPoint([0, 0]);
      const cut = tl.x + size.x * swipeX;
      const [x0, y0, y1] = [tl.x - 4000, tl.y - 4000, tl.y + size.y + 4000];
      for (const n of names) {
        const pane = map.getPane(n);
        if (pane) pane.style.clipPath = `polygon(${x0}px ${y0}px, ${cut}px ${y0}px, ${cut}px ${y1}px, ${x0}px ${y1}px)`;
      }
    };
    update();
    map.on("move zoom zoomend resize viewreset", update);
    return () => {
      map.off("move zoom zoomend resize viewreset", update);
      for (const n of names) {
        const pane = map.getPane(n);
        if (pane) pane.style.clipPath = "";
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swipeId, swipeX, leaves, ready]);

  const dragSwipe = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!wrap.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = wrap.current.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const x = Math.min(0.98, Math.max(0.02, (ev.clientX - rect.left) / rect.width));
      setSwipe((s) => (s ? { ...s, x } : s));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  const toggle = (ids: string[], value: boolean) =>
    setOn((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (value ? next.add(id) : next.delete(id)));
      return next;
    });
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const closeMenu = () => {
    setMenu(null);
    setTool(null);
  };
  const toggleMenu = (node: TreeNode, row: HTMLElement) => {
    setTool(null);
    const top = row.getBoundingClientRect().top - (wrap.current?.getBoundingClientRect().top ?? 0) - 6;
    setMenu((m) => (m?.node.id === node.id ? null : { node, top }));
  };
  const pickTool = (node: TreeNode, t: Tool) => {
    const next = tool === t ? null : t;
    setTool(next);
    if (!next || isGroup(node)) return;
    loadInfo(node);
    if (next === "info" && node.kind === "feature" && counts[node.id] === undefined) {
      queryJson(node, { returnCountOnly: "true" })
        .then((r: { count?: number }) => setCounts((prev) => ({ ...prev, [node.id]: r.count ?? null })))
        .catch(() => setCounts((prev) => ({ ...prev, [node.id]: null })));
    }
  };
  const setTrans = (ids: string[], v: number) =>
    setTransState((prev) => {
      const next = { ...prev };
      ids.forEach((id) => (next[id] = v));
      return next;
    });

  /** Давхарга (бүлэг бол бүх доторх) руу очиж асаана. Зураг нь тодорхой масштабаас ойр л харагддаг тул тэр хүртэл ойртуулна */
  const zoomTo = async (node: TreeNode) => {
    const map = mapRef.current;
    if (!map) return;
    const list = leavesOf(node);
    toggle(list.map((l) => l.id), true);
    const corner = (x: number, y: number) => L.CRS.EPSG3857.unproject(L.point(x, y));
    const results = await Promise.all(
      list.map(
        (lyr) =>
          new Promise<{ b?: L.LatLngBounds; minZoom: number }>((resolve) => {
            if (lyr.kind === "feature") {
              const q = esri.query({ url: lyr.url, ...(data?.token ? { token: data.token } : {}) } as never);
              q.where(whereOf(lyr.definitionExpression, [])).bounds((err: unknown, b: L.LatLngBounds) => resolve({ b: err ? undefined : b, minZoom: 0 }));
              return;
            }
            loadInfo(lyr).then((m) => {
              const e = m.fullExtent;
              resolve({
                b: e ? L.latLngBounds(corner(e.xmin, e.ymin), corner(e.xmax, e.ymax)) : undefined,
                minZoom: m.minScale ? Math.max(0, Math.ceil(Math.log2(ZOOM0_SCALE / m.minScale))) : 0,
              });
            });
          }),
      ),
    );
    const valid = results.filter((r) => r.b?.isValid());
    if (!valid.length || !mapRef.current) return;
    const bounds = valid.reduce((acc, r) => acc.extend(r.b!), L.latLngBounds(valid[0].b!.getSouthWest(), valid[0].b!.getNorthEast()));
    const minZoom = list.length === 1 ? valid[0].minZoom : 0;
    if (map.getBoundsZoom(bounds) < minZoom) map.setView(bounds.getCenter(), minZoom);
    else map.fitBounds(bounds, { paddingTopLeft: [panel ? 340 : 30, 30], paddingBottomRight: [30, 30], maxZoom: 17 });
  };

  const startSwipe = (lyr: Leaf) => {
    if (swipe?.id === lyr.id) return setSwipe(null);
    toggle([lyr.id], true);
    setSwipe({ id: lyr.id, title: lyr.title, x: 0.6 });
  };

  const openTable = async (lyr: Leaf) => {
    setSort(null);
    if (table?.lyr.id === lyr.id) return setTable(null);
    setTable({ lyr, fields: [], rows: [], total: null, loading: true });
    try {
      const info = await loadInfo(lyr);
      const fields: Field[] = (info.fields ?? [])
        .filter((f) => !SYSTEM_FIELD.test(f.name))
        .map((f) => ({
          name: f.name,
          alias: f.alias,
          type: f.type,
          domain: f.domain?.codedValues ? Object.fromEntries(f.domain.codedValues.map((c) => [String(c.code), c.name])) : null,
        }));
      const [res, cnt] = await Promise.all([
        queryJson(lyr, { outFields: "*", returnGeometry: "false", resultRecordCount: String(TABLE_MAX) }),
        queryJson(lyr, { returnCountOnly: "true" }),
      ]);
      if (res.error) throw new Error(res.error.message);
      const rows = (res.features ?? []).map((f: { attributes: Record<string, unknown> }) => f.attributes);
      setTable((t) => (t?.lyr.id === lyr.id ? { lyr, fields, oid: info.objectIdField, rows, total: cnt.count ?? null, loading: false } : t));
    } catch (e) {
      setTable((t) => (t?.lyr.id === lyr.id ? { ...t, loading: false, error: (e as Error).message } : t));
    }
  };

  const loadMoreRows = async (t: TableState) => {
    setTable((c) => (c ? { ...c, more: true } : c));
    try {
      const res = await queryJson(t.lyr, { outFields: "*", returnGeometry: "false", resultRecordCount: String(TABLE_MAX), resultOffset: String(t.rows.length) });
      const rows = (res.features ?? []).map((f: { attributes: Record<string, unknown> }) => f.attributes);
      setTable((c) => (c?.lyr.id === t.lyr.id ? { ...c, rows: [...c.rows, ...rows], more: false } : c));
    } catch {
      setTable((c) => (c ? { ...c, more: false } : c));
    }
  };

  // Сонгосон давхаргуудыг энэ хөтөч дээр санана
  useEffect(() => {
    if (!data) return;
    try {
      localStorage.setItem(STORE_ON, JSON.stringify([...on]));
    } catch {
      /* хадгалах боломжгүй */
    }
  }, [on, data]);

  /** Нэг объект руу очиж тодруулна (хүснэгт, хайлтаас) */
  const selectFeature = (lyr: Leaf, oid: string, id: unknown) => {
    const map = mapRef.current;
    if (!map) return;
    toggle([lyr.id], true);
    setSelected({ layerId: lyr.id, id });
    if (!map.getPane("geo-hilite")) map.createPane("geo-hilite").style.zIndex = "640";
    const q = esri.query({ url: lyr.url, ...(data?.token ? { token: data.token } : {}) } as never);
    q.where(whereOid(oid, id)).run((err: unknown, fc: GeoJSON.FeatureCollection) => {
      if (err || !fc?.features?.length || !mapRef.current) return;
      if (highlight.current) map.removeLayer(highlight.current);
      const shape = L.geoJSON(fc, {
        pane: "geo-hilite",
        interactive: false,
        style: { color: HILITE, weight: 3, fillColor: HILITE, fillOpacity: 0.12 },
        pointToLayer: (_f, ll) => L.circleMarker(ll, { pane: "geo-hilite", radius: 10, color: HILITE, weight: 3, fillOpacity: 0.15, interactive: false }),
      }).addTo(map);
      highlight.current = shape;
      const b = shape.getBounds();
      if (b.isValid())
        map.fitBounds(b, {
          paddingTopLeft: [panel ? 340 : 30, 30],
          paddingBottomRight: [30, table ? Math.round(map.getSize().y * 0.42) : 30],
          maxZoom: 16,
        });
    });
  };

  // Объектын нэрээр хайх — давхаргын нэрийн хайлттай зэрэг, бичиж дуусахыг хүлээж
  const hitSeq = useRef(0);
  useEffect(() => {
    const t = q.trim();
    const seq = ++hitSeq.current;
    if (t.length < 2 || !data) return setHits(null);
    const timer = setTimeout(async () => {
      const like = sqlText(`%${t.toUpperCase()}%`);
      const lists = await Promise.all(
        leaves
          .filter((l) => SEARCH_FIELDS[l.title.trim()])
          .map(async (l) => {
            const fields = SEARCH_FIELDS[l.title.trim()];
            try {
              const info = await loadInfo(l);
              const oid = info.objectIdField ?? "OBJECTID";
              const r = await queryJson(l, {
                where: fields.map((f) => `UPPER(${f}) LIKE ${like}`).join(" OR "),
                outFields: [oid, ...fields].join(","),
                returnGeometry: "false",
                resultRecordCount: "5",
              });
              return ((r.features ?? []) as { attributes: Record<string, unknown> }[]).map(
                (f): Hit => ({ lyr: l, oid, id: f.attributes[oid], label: fields.map((x) => f.attributes[x]).filter(Boolean).join(" · ") }),
              );
            } catch {
              return [] as Hit[];
            }
          }),
      );
      if (seq === hitSeq.current) setHits(lists.flat());
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, data, leaves]);

  // Хэмжих: зураг дээр дарж цэг тавина. Объектын товшилтыг зогсоож, давхар товшилтоор томрохгүй
  const measuring = Boolean(measure);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !measuring) return;
    map.closePopup();
    map.doubleClickZoom.disable();
    if (!map.getPane("geo-measure")) map.createPane("geo-measure").style.zIndex = "645";
    const group = L.layerGroup().addTo(map);
    measureLayer.current = group;
    const click = (e: L.LeafletMouseEvent) => setMeasure((v) => (v ? { ...v, pts: [...v.pts, e.latlng] } : v));
    const move = (e: L.LeafletMouseEvent) => setMeasure((v) => (v && v.pts.length ? { ...v, live: e.latlng } : v));
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMeasure(null);
    map.on("click", click);
    map.on("mousemove", move);
    document.addEventListener("keydown", key);
    return () => {
      map.off("click", click);
      map.off("mousemove", move);
      document.removeEventListener("keydown", key);
      map.doubleClickZoom.enable();
      map.removeLayer(group);
      measureLayer.current = null;
    };
  }, [measuring]);
  useEffect(() => {
    const group = measureLayer.current;
    if (!group || !measure) return;
    group.clearLayers();
    const style = { pane: "geo-measure", color: "#ff7a00", weight: 2.5, interactive: false };
    const path = measure.live ? [...measure.pts, measure.live] : measure.pts;
    if (path.length > 1) {
      if (measure.mode === "area") L.polygon(path, { ...style, fillColor: "#ff7a00", fillOpacity: 0.15 }).addTo(group);
      else L.polyline(path, style).addTo(group);
    }
    measure.pts.forEach((ll) => L.circleMarker(ll, { ...style, radius: 4, weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(group));
  }, [measure]);
  const measurePath = measure ? (measure.live ? [...measure.pts, measure.live] : measure.pts) : [];

  // Цэсийн гадна дарах эсвэл Esc — хаана
  const menuOpen = Boolean(menu);
  useEffect(() => {
    if (!menuOpen) return;
    const down = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".geo-pop, .geo-more")) closeMenu();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [menuOpen]);

  // Хайлт: давхаргын эсвэл бүлгийн нэрээр, үр дүн нь хавтгай жагсаалт
  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    const out: { lyr: Leaf; path: string }[] = [];
    const walk = (n: TreeNode, path: string[], hit: boolean) => {
      const here = hit || n.title.toLowerCase().includes(t);
      if (isGroup(n)) [...n.children].reverse().forEach((k) => walk(k, [...path, n.title], here));
      else if (here) out.push({ lyr: n, path: path.join(" · ") });
    };
    [...(data?.tree ?? [])].reverse().forEach((n) => walk(n, [], false));
    return out;
  }, [q, data]);

  const active = leaves.filter((l) => on.has(l.id));
  const sameAsDefault = active.length === defaults.current.length && defaults.current.every((id) => on.has(id));
  const tableRows = useMemo(() => {
    if (!table) return [];
    if (!sort) return table.rows;
    const dir = sort.desc ? -1 : 1;
    return [...table.rows].sort((a, b) => {
      const [x, y] = [a[sort.f], b[sort.f]];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "mn")) * dir;
    });
  }, [table, sort]);
  // Дээд давхарга эхэнд; зурган (tile) давхаргад тэмдэглэгээ байхгүй
  const legends = [...active]
    .reverse()
    .map((l) => ({ id: l.id, title: l.title, rows: legendRows(l.drawingInfo ?? infos[l.id]?.drawingInfo) }))
    .filter((l) => l.rows.length);

  const ctx: Ctx = {
    on,
    open,
    states,
    infos,
    counts,
    trans,
    zoom,
    menuId: menu?.node.id ?? null,
    tool,
    swipeId,
    tableId: table?.lyr.id ?? null,
    toggle,
    toggleOpen,
    toggleMenu,
    closeMenu,
    pickTool,
    setTrans,
    zoomTo,
    startSwipe,
    openTable,
  };

  return (
    <>
      {error && <div className="page error">{error}</div>}
      <GeoCtx.Provider value={ctx}>
      <div className={`geo ${measure ? "measuring" : ""} ${dim === "3d" ? "is-3d" : ""}`} ref={wrap}>
        <div ref={el} className="dw-map" />
        {data && mapRef.current && <MapDimSwitch value={dim} onChange={setDim} />}
        {dim === "3d" && data && mapRef.current && (
          <Suspense fallback={<div className="map3d-wait">3D ачаалж байна…</div>}>
            <Map3D
              layers={active}
              token={data.token}
              layerList={false}
              insetLeft={330}
              start={{ lat: mapRef.current.getCenter().lat, lng: mapRef.current.getCenter().lng, zoom: mapRef.current.getZoom() }}
              onClose={({ lat, lng, zoom }) => mapRef.current?.setView([lat, lng], zoom, { animate: false })}
            />
          </Suspense>
        )}

        <div className={`geo-coord ${panel ? "" : "wide"}`} ref={coordEl} aria-hidden />

        {measure && (
          <div className="geo-measure">
            <div className="seg" role="group" aria-label="Хэмжих төрөл">
              <button className={measure.mode === "line" ? "on" : ""} onClick={() => setMeasure({ mode: "line", pts: [], live: null })}>Зай</button>
              <button className={measure.mode === "area" ? "on" : ""} onClick={() => setMeasure({ mode: "area", pts: [], live: null })}>Талбай</button>
            </div>
            <b>
              {measurePath.length < 2
                ? "Газрын зураг дээр дарж цэг тавина"
                : measure.mode === "line"
                  ? fmtLength(pathLength(measurePath))
                  : measurePath.length < 3
                    ? "Дахин цэг тавина"
                    : fmtArea(polygonArea(measurePath))}
            </b>
            {measure.pts.length > 0 && <button className="txt" onClick={() => setMeasure({ ...measure, pts: [], live: null })}>Цэвэрлэх</button>}
            <button className="x" onClick={() => setMeasure(null)} title="Хэмжихээ болих (Esc)" aria-label="Хэмжихээ болих">×</button>
          </div>
        )}

        {swipeOn && (
          <div className="geo-swipe" style={{ left: `${swipeOn.x * 100}%` }} onPointerDown={dragSwipe} title="Чирж харьцуулна">
            <span className="grip" aria-hidden>‹ ›</span>
            <span className="tag" onPointerDown={(e) => e.stopPropagation()}>
              {swipeOn.title}
              <button onClick={() => setSwipe(null)} title="Харьцуулахаа болих" aria-label="Харьцуулахаа болих">×</button>
            </span>
          </div>
        )}

        {table && (
          <section className={`geo-table ${panel ? "" : "wide"}`}>
            <header>
              <h4>{table.lyr.title}</h4>
              {table.total !== null && (
                <span>{table.total > table.rows.length ? `${table.rows.length} / ${table.total.toLocaleString("mn-MN")}` : table.total.toLocaleString("mn-MN")}</span>
              )}
              <button onClick={() => setTable(null)} title="Хаах" aria-label="Хаах">×</button>
            </header>
            {table.loading ? (
              <div className="geo-empty">Ачаалж байна…</div>
            ) : table.error ? (
              <div className="geo-empty">Хүснэгт ачаалж чадсангүй</div>
            ) : !table.rows.length ? (
              <div className="geo-empty">Бичлэг алга</div>
            ) : (
              <div className="dw-table">
                <table>
                  <thead>
                    <tr>
                      {table.fields.map((f) => (
                        <th
                          key={f.name}
                          className={NUMERIC_FIELD.test(f.type) ? "num" : undefined}
                          title="Дарж эрэмбэлэх"
                          aria-sort={sort?.f === f.name ? (sort.desc ? "descending" : "ascending") : undefined}
                          onClick={() => setSort((v) => (v?.f === f.name ? (v.desc ? null : { f: f.name, desc: true }) : { f: f.name, desc: false }))}
                        >
                          {f.alias || f.name}
                          {sort?.f === f.name && (sort.desc ? " ↓" : " ↑")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((r, i) => (
                      <tr
                        key={i}
                        className={table.oid && selected?.layerId === table.lyr.id && selected.id === r[table.oid] ? "on" : ""}
                        onClick={() => table.oid && selectFeature(table.lyr, table.oid, r[table.oid])}
                      >
                        {table.fields.map((f) => (
                          <td key={f.name} className={`${NUMERIC_FIELD.test(f.type) ? "num" : ""} ${r[f.name] === null || r[f.name] === undefined ? "nil" : ""}`} title={typeof r[f.name] === "string" ? String(r[f.name]) : undefined}>
                            {displayValue(r[f.name], f)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {table.total !== null && table.total > table.rows.length && (
                  <button className="geo-more-rows" disabled={table.more} onClick={() => loadMoreRows(table)}>
                    {table.more ? "Ачаалж байна…" : `Дараагийн ${Math.min(TABLE_MAX, table.total - table.rows.length)}`}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {!panel ? (
          <button className="geo-open" onClick={() => setPanel(true)}>
            <IconLayers />
            Давхарга
            {active.length > 0 && <b>{active.length}</b>}
          </button>
        ) : (
          <aside className="geo-panel">
            <div className="geo-head">
              <button className={tab === "layers" ? "on" : ""} onClick={() => setTab("layers")}>Давхарга</button>
              <button className={tab === "legend" ? "on" : ""} onClick={() => setTab("legend")}>Тайлбар</button>
              <button className="geo-close" onClick={() => { closeMenu(); setPanel(false); }} title="Хаах" aria-label="Хаах">×</button>
            </div>
            {tab === "layers" && (
              <label className="search geo-find">
                <IconSearch size={14} />
                <input
                  type="search"
                  placeholder="Давхарга, талбай, цооног хайх"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setQ("")}
                />
              </label>
            )}
            <div className={`geo-body ${found ? "found" : ""}`} onScroll={() => menu && closeMenu()}>
              {!data && !error && <div className="geo-empty">Ачаалж байна…</div>}
              {tab === "layers" && found && !found.length && !hits?.length && <div className="geo-empty">{hits === null && q.trim().length > 1 ? "Хайж байна…" : "Олдсонгүй"}</div>}
              {tab === "layers" && found && found.length > 0 && hits && hits.length > 0 && <h5 className="geo-sec">Давхарга</h5>}
              {tab === "layers" && found?.map((f) => <Row key={f.lyr.id} node={f.lyr} path={f.path} />)}
              {tab === "layers" && found && hits && hits.length > 0 && (
                <>
                  <h5 className="geo-sec">Объект</h5>
                  {hits.map((h) => (
                    <button key={`${h.lyr.id}:${String(h.id)}`} className={`geo-hit ${selected?.layerId === h.lyr.id && selected.id === h.id ? "on" : ""}`} onClick={() => selectFeature(h.lyr, h.oid, h.id)}>
                      {h.label}
                      <small>{h.lyr.title}</small>
                    </button>
                  ))}
                </>
              )}
              {tab === "layers" && !found && [...(data?.tree ?? [])].reverse().map((n) => <Row key={n.id} node={n} />)}
              {tab === "legend" && data && !legends.length && <div className="geo-empty">Асаалттай давхаргын тайлбар алга</div>}
              {tab === "legend" &&
                legends.map((l) => (
                  <section key={l.id} className="geo-lg">
                    {/* Нэг тэмдэгтэй давхарга — тэмдэг нь нэрийнхээ хажууд */}
                    <h4>
                      {l.rows.length === 1 && <Swatch sym={l.rows[0].sym} />}
                      {l.title}
                    </h4>
                    {l.rows.length > 1 && <LegendList rows={l.rows} />}
                  </section>
                ))}
            </div>
            <div className="geo-foot">
              <span>{active.length} асаалттай</span>
              {active.length > 0 && <button onClick={() => setOn(new Set())}>Унтраах</button>}
              {data && !sameAsDefault && <button onClick={() => setOn(new Set(defaults.current))}>Анхны байдал</button>}
              <a href={ARCGIS_APP} target="_blank" rel="noreferrer" title="Хэмжих, хайх хэрэгслээр ArcGIS-д нээх">ArcGIS ↗</a>
            </div>
          </aside>
        )}
        {menu && panel && <LayerMenu key={menu.node.id} node={menu.node} top={menu.top} />}
      </div>
      </GeoCtx.Provider>
    </>
  );
}

function setStateClear(prev: Record<string, RowState>, id: string): Record<string, RowState> {
  if (!(id in prev)) return prev;
  const next = { ...prev };
  delete next[id];
  return next;
}
