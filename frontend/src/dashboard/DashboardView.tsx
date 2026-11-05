import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, DashboardLayoutOut } from "../api";
import { ChartPrefsCtx, ChartKind, DashboardProvider, PrefsCtx, useDashboard } from "./context";
import MapWidget from "./MapWidget";
import { CategorySelector, DateSelector } from "./selectors";
import type { DashboardDef, LayoutElement, Widget } from "./types";
import {
  DetailsWidget,
  GaugeWidget,
  IndicatorWidget,
  ListWidget,
  Panel,
  PieChartWidget,
  ProjectMixWidget,
  ShareListWidget,
  RichTextWidget,
  SerialChartWidget,
  StatListWidget,
  TableWidget,
  UnsupportedWidget,
} from "./widgets";
import { stripHtml, tameCaps } from "./format";
import "./dashboard.css";

const ARCGIS_APP = "https://www.arcgis.com/apps/dashboards/";

/** Хуучин ArcGIS dashboard-ын графикийн цувааг (graphs) одоогийн chartConfig.series болгоно */
function upgradeLegacy(d: DashboardDef): DashboardDef {
  const widgets = d.widgets.map((w): Widget => {
    if (w.type !== "serialChartWidget" || w.chartConfig || !w.graphs?.length) return w;
    const stack = w.valueAxis?.stackType;
    const series = w.graphs
      .filter((g) => g.valueField)
      .map((g, i) => ({
        type: /line|step/i.test(g.type ?? "") ? "lineSeries" : "barSeries",
        id: `legacy-${i}`,
        name: g.title ?? "",
        x: w.category?.fieldName,
        y: g.valueField,
      }));
    return {
      ...w,
      chartConfig: {
        rotated: Boolean(w.rotate),
        stackedType: stack === "regular" ? "stacked" : stack === "100%" ? "stacked100" : "sideBySide",
        series,
      },
    };
  });
  return { ...d, widgets };
}

/** Dashboard ачаалах зуурт харагдах «араг» — гарчиг, KPI, газрын зураг, графикийн байрлал */
export function DashboardSkeleton() {
  return (
    <div className="dw-view dw-skeleton" aria-busy="true" aria-label="Dashboard ачаалж байна">
      <div className="dw-header">
        <span className="sk sk-title" />
        <div className="dw-header-selectors">
          <span className="sk sk-sel" />
          <span className="sk sk-sel" />
        </div>
      </div>
      <div className="dw-root">
        <div className="dw-stack v">
          <div className="dw-cell" style={{ flex: "0.55 1 0" }}>
            <div className="dw-stack h">
              <div className="dw-cell" style={{ flex: "0.16 1 0" }}>
                <div className="dw-stack v">
                  <div className="dw-cell" style={{ flex: "1 1 0" }}><span className="sk sk-panel" /></div>
                  <div className="dw-cell" style={{ flex: "1 1 0" }}><span className="sk sk-panel" /></div>
                </div>
              </div>
              <div className="dw-cell" style={{ flex: "0.68 1 0" }}><span className="sk sk-panel" /></div>
              <div className="dw-cell" style={{ flex: "0.16 1 0" }}>
                <div className="dw-stack v">
                  <div className="dw-cell" style={{ flex: "1 1 0" }}><span className="sk sk-panel" /></div>
                  <div className="dw-cell" style={{ flex: "1 1 0" }}><span className="sk sk-panel" /></div>
                </div>
              </div>
            </div>
          </div>
          <div className="dw-cell" style={{ flex: "0.45 1 0" }}>
            <div className="dw-stack h">
              <div className="dw-cell" style={{ flex: "1 1 0" }}><span className="sk sk-panel" /></div>
              <div className="dw-cell" style={{ flex: "1 1 0" }}><span className="sk sk-panel" /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WidgetView({ widget }: { widget?: Widget }) {
  if (!widget) return null;
  switch (widget.type) {
    case "indicatorWidget":
      return <IndicatorWidget widget={widget} />;
    case "serialChartWidget":
      return <SerialChartWidget widget={widget} />;
    case "pieChartWidget":
      return <PieChartWidget widget={widget} />;
    case "projectMixWidget":
      return <ProjectMixWidget widget={widget} />;
    case "statListWidget":
      return <StatListWidget widget={widget} />;
    case "shareListWidget":
      return <ShareListWidget widget={widget} />;
    case "mapWidget":
      return <MapWidget widget={widget} />;
    case "listWidget":
      return <ListWidget widget={widget} />;
    case "tableWidget":
      return <TableWidget widget={widget} />;
    case "detailsWidget":
      return <DetailsWidget widget={widget} />;
    case "gaugeWidget":
      return <GaugeWidget widget={widget} />;
    case "richTextWidget":
      return <RichTextWidget widget={widget} />;
    case "categorySelectorWidget":
      return (
        <Panel widget={widget}>
          <CategorySelector widget={widget} />
        </Panel>
      );
    case "dateSelectorWidget":
      return (
        <Panel widget={widget}>
          <DateSelector widget={widget} />
        </Panel>
      );
    default:
      return <UnsupportedWidget widget={widget} />;
  }
}

const ParentDirCtx = createContext<boolean>(false);

/** Табын нэр самбарын гарчигт агуулагдаагүй бол (ижил гарчигтай графикуудыг ялгахын тулд) шошго болгоно */
function tabCaption(c: LayoutElement, widgets: Record<string, Widget>): string {
  const w = c.type === "itemLayoutElement" ? widgets[c.id] : undefined;
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const title = norm(w ? stripHtml(w.topCaption ?? w.caption ?? w.title) : "");
  const tab = tameCaps(c.tabName?.trim() ?? "");
  return tab && !title.includes(norm(tab)) ? tab : "";
}

// Табын бүлгийг «дэлгэх» — бүх табыг зэрэгцүүлж нэг дор харуулна.
// Төлөвийг байрлалын хэмжээтэй адил хадгална: [2] = дэлгэсэн, [1] = табаар.
const EXPANDED = 2;

function Tabs({ el, widgets }: { el: LayoutElement; widgets: Record<string, Widget> }) {
  const { dashId, defaults, onSaved } = useContext(LayoutCtx);
  const parentHorizontal = useContext(ParentDirCtx);
  const [active, setActive] = useState(0);
  const items = el.elements ?? [];
  const current = items[Math.min(active, items.length - 1)];
  const key = layoutKey(dashId, `tabs:${el.id}`);
  const [expanded, setExpanded] = useState(() => {
    const local = readSizes(key, 1);
    const server = defaults[`tabs:${el.id}`];
    return (local ?? server)?.[0] === EXPANDED;
  });

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(key, JSON.stringify([next ? EXPANDED : 1]));
    } catch {
      /* ignore */
    }
    onSaved();
  };

  if (expanded) {
    return (
      <div className={`dw-tabs-expanded ${parentHorizontal ? "v" : "h"}`}>
        {items.map((c) => {
          const tab = tabCaption(c, widgets);
          return (
            <div key={c.id} className="dw-cell dw-tab-cell">
              {tab && <div className="dw-tab-caption">{tab}</div>}
              <div className="dw-tab-cell-body">
                <LayoutNode el={c} widgets={widgets} />
              </div>
            </div>
          );
        })}
        <button className="dw-tabs-toggle collapse" onClick={toggle} title="Буцааж табаар харуулах">
          ⊟
        </button>
      </div>
    );
  }

  return (
    <div className="dw-tabs">
      <div className="dw-tabs-body">{current && <LayoutNode el={current} widgets={widgets} />}</div>
      <nav className={items.some((c) => c.tabLabel) ? "dw-tabstrip short" : "dw-tabstrip"}>
        {items.map((c, i) => (
          <button key={c.id} className={i === active ? "active" : ""} onClick={() => setActive(i)} title={c.tabName?.trim()}>
            {c.tabLabel ?? (tameCaps(c.tabName?.trim() ?? "") || `${i + 1}`)}
          </button>
        ))}
        {items.length > 1 && (
          <button className="dw-tabs-toggle" onClick={toggle} title={`Бүх ${items.length} табыг зэрэг харуулах`}>
            ⊞
          </button>
        )}
      </nav>
    </div>
  );
}

// ---- Самбарын хэмжээг чирж өөрчлөх. Хэмжээг dashboard бүрээр энэ хөтөч дээр санана.
// defaults — серверт хадгалсан бүх хэрэглэгчийн үндсэн хэмжээ ({stackId: [...]})
const LayoutCtx = createContext<{ dashId: string; version: number; defaults: Record<string, number[]>; onSaved: () => void }>({
  dashId: "",
  version: 0,
  defaults: {},
  onSaved: () => {},
});
const layoutKey = (dashId: string, stackId: string) => `emc-layout:${dashId}:${stackId}`;
const MIN_SHARE = 0.06; // самбар хамгийн багадаа хэсгийн 6%

function readSizes(key: string, n: number): number[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && x > 0) ? v : null;
  } catch {
    return null;
  }
}

// ---- Автомат үндсэн байрлал: газрын зураг том, хажуугийн баганууд нарийн, доод график намхан.
// Серверт үндсэн байрлал хадгалаагүй dashboard-д хэрэглэнэ.
const SMALL = new Set(["indicatorWidget", "gaugeWidget", "categorySelectorWidget", "dateSelectorWidget", "richTextWidget"]);

function items(el: LayoutElement): LayoutElement[] {
  return el.type === "itemLayoutElement" ? [el] : (el.elements ?? []).flatMap(items);
}
const typeOf = (el: LayoutElement, widgets: Record<string, Widget>) => widgets[el.id]?.type ?? "";
const hasMap = (el: LayoutElement, w: Record<string, Widget>) => items(el).some((i) => typeOf(i, w) === "mapWidget");
const onlySmall = (el: LayoutElement, w: Record<string, Widget>) => items(el).every((i) => SMALL.has(typeOf(i, w)));
const isBusy = (el: LayoutElement, w: Record<string, Widget>) =>
  el.type === "tabsLayoutElement" || items(el).filter((i) => !SMALL.has(typeOf(i, w))).length > 1;

function autoSizes(el: LayoutElement, horizontal: boolean, w: Record<string, Widget>): number[] | null {
  const kids = el.elements ?? [];
  if (kids.length < 2) return null;
  // Зөвхөн KPI-тай багана/мөр — тэнцүү хуваана
  if (kids.every((c) => c.type === "itemLayoutElement" && SMALL.has(typeOf(c, w)))) return kids.map(() => 1);
  const mapAt = kids.findIndex((c) => hasMap(c, w));
  if (mapAt < 0) return null; // газрын зураггүй хэсэг — ArcGIS-ийн харьцаа хэвээр

  // Газрын зурагтай биш хэсэг бүрийн эзлэх хувь
  const share = (c: LayoutElement): number =>
    horizontal
      ? onlySmall(c, w) ? 0.11 : isBusy(c, w) ? 0.17 : 0.13 // хажуугийн багана
      : onlySmall(c, w) ? 0.16 : kids.length === 2 ? 0.24 : 0.2; // дээд/доод мөр (KPI мөрөнд гарчиг 2-3 мөр)
  const others = kids.map((c, i) => (i === mapAt ? 0 : share(c)));
  const total = others.reduce((a, b) => a + b, 0);
  const scale = total > 0.5 ? 0.5 / total : 1; // газрын зураг хамгийн багадаа 50%
  return others.map((v, i) => (i === mapAt ? 1 - total * scale : v * scale));
}

function Stack({ el, widgets }: { el: LayoutElement; widgets: Record<string, Widget> }) {
  const { dashId, defaults, onSaved } = useContext(LayoutCtx);
  // ArcGIS-д orientation "col" = хэвтээ (баганууд зэрэгцэнэ), "row" = босоо.
  // Хэрэглэгч ⇄ товчоор сольж болно: энэ хөтөч → серверийн үндсэн → ArcGIS
  const orientKey = layoutKey(dashId, `orient:${el.id}`);
  const [orient, setOrient] = useState<number | undefined>(
    () => readSizes(orientKey, 1)?.[0] ?? defaults[`orient:${el.id}`]?.[0],
  );
  const horizontal = orient ? orient === 2 : el.orientation === "col";
  const flip = () => {
    const next = horizontal ? 1 : 2;
    setOrient(next);
    try {
      localStorage.setItem(orientKey, JSON.stringify([next]));
    } catch {
      /* ignore */
    }
    onSaved();
  };
  const kids = el.elements ?? [];
  const key = layoutKey(dashId, el.id);
  // Эрэмбэ: энэ хөтөч дээр өөрчилсөн → серверийн үндсэн → автомат дүрэм → ArcGIS-ийн анхны
  const arcgisSizes = kids.map((c) => (horizontal ? c.width : c.height) || 1);
  const serverSizes = defaults[el.id];
  const initial =
    serverSizes && serverSizes.length === kids.length ? serverSizes : (autoSizes(el, horizontal, widgets) ?? arcgisSizes);
  const [sizes, setSizes] = useState<number[]>(() => readSizes(key, kids.length) ?? initial);
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  const box = useRef<HTMLDivElement>(null);

  const startDrag = (i: number, e: React.PointerEvent) => {
    if (!box.current) return;
    e.preventDefault();
    const rect = box.current.getBoundingClientRect();
    const total = horizontal ? rect.width : rect.height;
    const start = horizontal ? e.clientX : e.clientY;
    const base = [...sizesRef.current];
    const pair = base[i] + base[i + 1];
    const sum = base.reduce((a, b) => a + b, 0);
    const min = sum * MIN_SHARE;
    document.body.classList.add(horizontal ? "dw-resizing-h" : "dw-resizing-v");
    const move = (ev: PointerEvent) => {
      const delta = (((horizontal ? ev.clientX : ev.clientY) - start) / total) * sum;
      const a = Math.min(pair - min, Math.max(min, base[i] + delta));
      const next = [...base];
      next[i] = a;
      next[i + 1] = pair - a;
      setSizes(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dw-resizing-h", "dw-resizing-v");
      try {
        localStorage.setItem(key, JSON.stringify(sizesRef.current));
      } catch {
        /* хадгалах боломжгүй — энэ удаад л хүчинтэй */
      }
      onSaved(); // хадгалсны дараа «⟲ Байрлал» товчийг харуулна
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const reset = () => {
    setSizes(initial);
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };

  return (
    <div ref={box} className={`dw-stack ${horizontal ? "h" : "v"}`}>
      {kids.map((c, i) => (
        <Fragment key={c.id}>
          <div className={`dw-cell ${tabCaption(c, widgets) ? "dw-tab-cell" : ""}`} style={{ flex: `${sizes[i]} 1 0` }}>
            {tabCaption(c, widgets) && <div className="dw-tab-caption">{tabCaption(c, widgets)}</div>}
            <ParentDirCtx.Provider value={horizontal}>
              {tabCaption(c, widgets) ? (
                <div className="dw-tab-cell-body">
                  <LayoutNode el={c} widgets={widgets} />
                </div>
              ) : (
                <LayoutNode el={c} widgets={widgets} />
              )}
            </ParentDirCtx.Provider>
          </div>
          {i < kids.length - 1 && (
            <div
              className={`dw-split ${horizontal ? "h" : "v"}`}
              onPointerDown={(e) => startDrag(i, e)}
              onDoubleClick={reset}
              role="separator"
              aria-orientation={horizontal ? "vertical" : "horizontal"}
              title="Чирж хэмжээг өөрчилнө · давхар дарвал анхны байдалд"
            >
              <button
                className="dw-flip"
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={flip}
                title={horizontal ? "Дээш доош байрлуулах" : "Зэрэгцүүлж байрлуулах"}
              >
                {horizontal ? "⇅" : "⇄"}
              </button>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function LayoutNode({ el, widgets }: { el: LayoutElement; widgets: Record<string, Widget> }) {
  if (el.type === "itemLayoutElement") return <WidgetView widget={widgets[el.id]} />;
  if (el.type === "tabsLayoutElement") return <Tabs el={el} widgets={widgets} />;
  return <Stack el={el} widgets={widgets} />;
}

const localLayout = (dashId: string): Record<string, number[]> => {
  const prefix = `emc-layout:${dashId}:`;
  const out: Record<string, number[]> = {};
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(prefix)) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? "null");
      if (Array.isArray(v)) out[k.slice(prefix.length)] = v;
    }
  } catch {
    /* ignore */
  }
  return out;
};

const PREF = (dashId: string, key: string) => `emc-pref:${dashId}:${key}`;

const localPrefs = (dashId: string): Record<string, string | null> => {
  const prefix = `emc-pref:${dashId}:`;
  const out: Record<string, string | null> = {};
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = localStorage.getItem(k) || null;
  } catch {
    /* ignore */
  }
  return out;
};

const clearLocalLayout = (dashId: string) => {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(`emc-pref:${dashId}:`))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(`emc-layout:${dashId}:`))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
};

/** «⟲» — энэ хөтөч дээр өөрчилсөн байрлалыг цуцалж үндсэн байрлал руу буцаана (зөвхөн өөрчлөлт байхад) */
function LayoutControls({ dashId, onChange }: { dashId: string; onChange: () => void }) {
  const hasLocal = Object.keys(localLayout(dashId)).length > 0 || Object.keys(localPrefs(dashId)).length > 0;
  if (!hasLocal) return null;
  return (
    <button
      className="ghost dw-reset"
      title="Үндсэн байрлал руу буцах"
      onClick={() => {
        clearLocalLayout(dashId);
        onChange();
      }}
    >
      ⟲
    </button>
  );
}

function ClearAll() {
  const { selections, setSelection } = useDashboard();
  const active = Object.entries(selections).filter(([, s]) => s);
  if (!active.length) return null;
  return (
    <button className="ghost dw-clear" onClick={() => active.forEach(([id]) => setSelection(id, null))}>
      Шүүлтүүр цэвэрлэх ({active.length})
    </button>
  );
}

export default function DashboardView({ itemId, title }: { itemId: string; title?: string }) {
  const [def, setDef] = useState<DashboardDef | null>(null);
  const [error, setError] = useState<{ message: string; locked: boolean } | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0); // «⟲ Байрлал» дарахад самбарууд анхны хэмжээнд
  const [, rerender] = useState(0);
  const [prefsVersion, setPrefsVersion] = useState(0); // текст тохиргоо өөрчлөгдөхөд газрын зургийг дахин зурна

  const [serverLayout, setServerLayout] = useState<DashboardLayoutOut | null>(null);

  useEffect(() => {
    setDef(null);
    setError(null);
    setServerLayout(null);
    // Үндсэн байрлалыг dashboard-тай зэрэг ачаална — эхлээд ArcGIS-ийн байрлалаар гарч, дараа нь үсрэхгүй
    Promise.all([api.dashboardDef<DashboardDef>(itemId), api.dashboardLayout(itemId).catch(() => null)])
      .then(([d, lay]) => {
        setServerLayout(lay);
        setDef(upgradeLegacy(d));
      })
      .catch((e: Error) => setError({ message: e.message, locked: /хаалттай|нэвтр/i.test(e.message) }));
  }, [itemId]);

  const widgets = useMemo(() => Object.fromEntries((def?.widgets ?? []).map((w) => [w.id, w])), [def]);
  // Серверт дахин байрлуулсан layout байвал түүнийг, үгүй бол ArcGIS-ийнхийг хэрэглэнэ.
  // Хуучирсан (ArcGIS дээр устсан виджет заасан) layout-ыг алгасна.
  const layoutRoot = useMemo(() => {
    const tree = serverLayout?.tree as LayoutElement | undefined;
    if (!tree || !def) return def?.layout;
    const ok = (el: LayoutElement): boolean =>
      el.type === "itemLayoutElement" ? Boolean(widgets[el.id]) : (el.elements ?? []).every(ok);
    return ok(tree) ? tree : def.layout;
  }, [serverLayout, def, widgets]);
  const selectors = [...(def?.header?.selectors ?? []), ...(def?.leftPanel?.selectors ?? [])];

  if (error) {
    return (
      <div className="dw-locked">
        <div className="icon">{error.locked ? "🔒" : "!"}</div>
        <h2>{title}</h2>
        <p>
          {error.locked
            ? "Энэ dashboard ArcGIS Online дээр хаалттай (private). Системд шууд харуулахын тулд сервер дээр ArcGIS нэвтрэх эрх тохируулна уу (EMC_ARCGIS_USERNAME / EMC_ARCGIS_PASSWORD)."
            : error.message}
        </p>
        <a className="dw-open" href={ARCGIS_APP + itemId} target="_blank" rel="noreferrer">
          ArcGIS дээр нээх ↗
        </a>
      </div>
    );
  }
  if (!def) return <DashboardSkeleton />;

  return (
    <DashboardProvider def={def}>
      <div className="dw-view">
      <div className="dw-header">
        <h2>{tameCaps(def.header?.title || def.title)}</h2>
        <div className="dw-header-selectors">
          {selectors.map((s) =>
            s.type === "dateSelectorWidget" ? <DateSelector key={s.id} widget={s} /> : <CategorySelector key={s.id} widget={s} />,
          )}
          <ClearAll />
          <LayoutControls dashId={itemId} onChange={() => setLayoutVersion((v) => v + 1)} />
        </div>
      </div>
      <div className="dw-root">
        {layoutRoot ? (
          <LayoutCtx.Provider
            value={{ dashId: itemId, version: layoutVersion, defaults: serverLayout?.sizes ?? {}, onSaved: () => rerender((n) => n + 1) }}
          >
            <PrefsCtx.Provider
              value={{
                version: prefsVersion + layoutVersion,
                get: (key) => {
                  try {
                    const v = localStorage.getItem(PREF(itemId, key));
                    if (v !== null) return v || undefined;
                  } catch {
                    /* ignore */
                  }
                  return serverLayout?.prefs?.[key];
                },
                set: (key, v) => {
                  try {
                    localStorage.setItem(PREF(itemId, key), v ?? "");
                  } catch {
                    /* ignore */
                  }
                  setPrefsVersion((n) => n + 1);
                },
              }}
            >
            <ChartPrefsCtx.Provider
              value={{
                get: (id) => {
                  const v = readSizes(layoutKey(itemId, `kind:${id}`), 1)?.[0] ?? serverLayout?.sizes?.[`kind:${id}`]?.[0];
                  return v === 2 ? "line" : v === 1 ? "bar" : undefined;
                },
                set: (id, k: ChartKind) => {
                  try {
                    localStorage.setItem(layoutKey(itemId, `kind:${id}`), JSON.stringify([k === "line" ? 2 : 1]));
                  } catch {
                    /* ignore */
                  }
                  rerender((n) => n + 1);
                },
              }}
            >
              <LayoutNode key={layoutVersion} el={layoutRoot} widgets={widgets} />
            </ChartPrefsCtx.Provider>
            </PrefsCtx.Provider>
          </LayoutCtx.Provider>
        ) : (
          <div className="dw-stack v">
            {def.widgets.map((w) => (
              <div key={w.id} className="dw-cell" style={{ flex: "1 1 0" }}>
                <WidgetView widget={w} />
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </DashboardProvider>
  );
}
