import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { DashboardDef, QueryResult, RuntimeFilter, Selection, Widget } from "./types";

type Link = { sourceId: string; fieldMap?: { sourceName: string; targetName: string }[] };

type Ctx = {
  itemId: string;
  selections: Record<string, Selection | null>;
  setSelection: (sourceId: string, sel: Selection | null) => void;
  filtersFor: (targetKey: string, selfId: string) => RuntimeFilter[];
  /** Энэ зургийг орон зайгаар (аймаг, сум) хязгаарлах сонголтууд */
  geoFor: (mapId: string) => { layerId: string; sel: Selection }[];
};

const DashboardCtx = createContext<Ctx | null>(null);

/**
 * Графикийн төрлийг (багана ⇄ шугам) солих тохиргоо. Байрлалтай адил хадгалагдана:
 * түлхүүр `kind:<widgetId>` — [2] = шугам, [1] = багана. Энэ хөтөч → серверийн үндсэн.
 */
export type ChartKind = "bar" | "line";

/** Текст тохиргоо (газрын зургийн цэгийг өнгөлөх талбар гэх мэт): энэ хөтөч → серверийн үндсэн */
export const PrefsCtx = createContext<{ version: number; get: (key: string) => string | undefined; set: (key: string, v: string | null) => void }>({
  version: 0,
  get: () => undefined,
  set: () => {},
});
export const ChartPrefsCtx = createContext<{ get: (id: string) => ChartKind | undefined; set: (id: string, k: ChartKind) => void }>({
  get: () => undefined,
  set: () => {},
});


export function useDashboard() {
  const ctx = useContext(DashboardCtx);
  if (!ctx) throw new Error("DashboardProvider алга");
  return ctx;
}


function targetsOf(w: Widget, by: string) {
  return (w.events ?? [])
    .filter((ev) => ev.type === "selectionChanged")
    .flatMap((ev) => ev.actions ?? [])
    .flatMap((a) => a.targets ?? [])
    .filter((t) => t.by === by);
}

const layerKey = (w: Widget, name = "main") => {
  const src = w.datasets?.find((d) => d.name === name)?.dataSource as { itemId?: string; layerId?: unknown } | undefined;
  return src?.itemId && src.layerId != null ? `${src.itemId}|${src.layerId}` : null;
};

/**
 * «targetId → эх үүсвэрүүд» индекс. Dashboard-д тодорхойлсон холбоос дээр нэмж:
 * холбоогүй chart, шүүлтүүр нь ижил давхаргын виджетүүдийг шүүнэ, бүгд тухайн давхаргын зурагт хүрнэ.
 */
function buildLinks(def: DashboardDef): Map<string, Link[]> {
  const selectors = [...(def.header?.selectors ?? []), ...(def.leftPanel?.selectors ?? [])];
  const all: Widget[] = [...def.widgets, ...selectors];
  const maps = def.widgets.filter((w) => w.type === "mapWidget");
  const layerOf = new Map<string, string>();
  for (const w of all) {
    for (const d of w.datasets ?? []) {
      const key = layerKey(w, d.name);
      if (key) layerOf.set(`${w.id}#${d.name}`, key);
    }
  }
  const links = new Map<string, Link[]>();
  const add = (targetId: string, link: Link) => {
    const list = links.get(targetId) ?? [];
    const same = list.find((l) => l.sourceId === link.sourceId);
    // Огнооны шүүлтүүрийн талбар fieldMap-д: зургийн холбоост дутуу бол ижил давхаргынхаас авна
    if (same) same.fieldMap ??= link.fieldMap;
    else list.push(link);
    links.set(targetId, list);
  };
  for (const w of all) {
    if (w.type === "mapWidget") continue;
    const own = layerKey(w);
    let targets: { targetId: string; fieldMap?: Link["fieldMap"] }[] = targetsOf(w, "whereClause");
    if (!targets.length && own) {
      targets = [...layerOf.entries()]
        .filter(([id, key]) => key === own && !id.startsWith(`${w.id}#`) && !selectors.some((s) => id.startsWith(`${s.id}#`)))
        .map(([targetId]) => ({ targetId }));
    }
    for (const t of targets) add(t.targetId, { sourceId: w.id, fieldMap: t.fieldMap });
    // Зураг: шүүгдэж буй давхарга зурагт байвал түүнийг ч шүүнэ
    const sources: [string | null, Link["fieldMap"]][] = [[own, undefined], ...targets.map((t) => [layerOf.get(t.targetId) ?? null, t.fieldMap] as [string | null, Link["fieldMap"]])];
    for (const [key, fieldMap] of sources) {
      if (!key) continue;
      const [itemId, layerId] = key.split("|");
      for (const m of maps) {
        if (m.itemId === itemId) add(`${m.id}#${layerId}`, { sourceId: w.id, fieldMap });
      }
    }
  }
  return links;
}

/** Зургийг орон зайгаар хязгаарлах (аймаг, сум) сонгогчид */
function buildGeo(def: DashboardDef) {
  const all: Widget[] = [...def.widgets, ...(def.header?.selectors ?? []), ...(def.leftPanel?.selectors ?? [])];
  const geo = new Map<string, { sourceId: string; layerId: string }[]>();
  for (const w of all) {
    const layerId = (w.datasets?.[0]?.dataSource as { layerId?: unknown } | undefined)?.layerId;
    if (layerId == null) continue;
    for (const t of targetsOf(w, "geometry")) {
      const mapId = t.targetId.split("#")[0];
      geo.set(mapId, [...(geo.get(mapId) ?? []).filter((g) => g.sourceId !== w.id), { sourceId: w.id, layerId: String(layerId) }]);
    }
  }
  return geo;
}

export function DashboardProvider({ def, children }: { def: DashboardDef; children: React.ReactNode }) {
  const [selections, setSelections] = useState<Record<string, Selection | null>>({});
  const links = useMemo(() => buildLinks(def), [def]);
  const geo = useMemo(() => buildGeo(def), [def]);

  useEffect(() => {
    setSelections({});
  }, [def.id]);

  const value = useMemo<Ctx>(
    () => ({
      itemId: def.id,
      selections,
      setSelection: (sourceId, sel) => setSelections((s) => ({ ...s, [sourceId]: sel })),
      filtersFor: (targetKey, selfId) => {
        const out: RuntimeFilter[] = [];
        for (const link of links.get(targetKey) ?? []) {
          const sel = selections[link.sourceId];
          if (!sel || link.sourceId === selfId) continue;
          const mapped = link.fieldMap?.find((m) => m.sourceName === sel.field || m.sourceName === "filterField");
          const field = mapped?.targetName ?? (sel.field === "filterField" ? null : sel.field);
          if (field) out.push({ field, op: sel.op, values: sel.values });
        }
        return out;
      },
      geoFor: (mapId) =>
        (geo.get(mapId) ?? []).flatMap(({ sourceId, layerId }) => {
          const sel = selections[sourceId];
          return sel ? [{ layerId, sel }] : [];
        }),
    }),
    [def.id, selections, links, geo],
  );

  return <DashboardCtx.Provider value={value}>{children}</DashboardCtx.Provider>;
}

/** Виджетийн dataset-ийн өгөгдлийг (идэвхтэй шүүлтүүртэй нь) серверээс авна. */
export function useWidgetData(widget: Widget, datasetName = "main", sortDesc?: string) {
  const { itemId, filtersFor } = useDashboard();
  const filters = filtersFor(`${widget.id}#${datasetName}`, widget.id);
  const key = JSON.stringify(filters);
  const [state, setState] = useState<{ data: QueryResult | null; error: string; loading: boolean }>({
    data: null,
    error: "",
    loading: true,
  });

  useEffect(() => {
    const ds = widget.datasets?.find((d) => d.name === datasetName);
    if (!ds) {
      setState({ data: null, error: "", loading: false });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: "" }));
    api
      .widgetQuery<QueryResult>(itemId, { widget_id: widget.id, dataset: datasetName, filters, sort_desc: sortDesc }, ctrl.signal)
      .then((data) => setState({ data, error: "", loading: false }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ data: null, error: e.message, loading: false });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, widget.id, datasetName, key, sortDesc]);

  return { ...state, filtered: filters.length > 0 };
}
