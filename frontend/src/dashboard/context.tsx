import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, rememberResult, seenResult } from "../api";
import type { DashboardDef, QueryResult, RuntimeFilter, Selection, Widget } from "./types";

type Link = { sourceId: string; fieldMap?: { sourceName: string; targetName: string }[] };

type Ctx = {
  itemId: string;
  selections: Record<string, Selection | null>;
  setSelection: (sourceId: string, sel: Selection | null) => void;
  filtersFor: (targetKey: string, selfId: string) => RuntimeFilter[];
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

/** Виджет бүрийн events-ээс «targetId → эх үүсвэрүүд» индекс байгуулна. */
function buildLinks(def: DashboardDef): Map<string, Link[]> {
  const all: Widget[] = [...def.widgets, ...(def.header?.selectors ?? []), ...(def.leftPanel?.selectors ?? [])];
  const links = new Map<string, Link[]>();
  for (const w of all) {
    for (const ev of w.events ?? []) {
      if (ev.type !== "selectionChanged") continue;
      for (const a of ev.actions ?? []) {
        for (const t of a.targets ?? []) {
          if (t.by !== "whereClause") continue; // geometry (газрын зургийн хүрээ) шүүлтийг дэмжихгүй
          const list = links.get(t.targetId) ?? [];
          list.push({ sourceId: w.id, fieldMap: t.fieldMap });
          links.set(t.targetId, list);
        }
      }
    }
  }
  return links;
}

export function DashboardProvider({ def, children }: { def: DashboardDef; children: React.ReactNode }) {
  const [selections, setSelections] = useState<Record<string, Selection | null>>({});
  const links = useMemo(() => buildLinks(def), [def]);

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
    }),
    [def.id, selections, links],
  );

  return <DashboardCtx.Provider value={value}>{children}</DashboardCtx.Provider>;
}

/** Виджетийн dataset-ийн өгөгдлийг (идэвхтэй шүүлтүүртэй нь) серверээс авна. */
export function useWidgetData(widget: Widget, datasetName = "main", sortDesc?: string) {
  const { itemId, filtersFor } = useDashboard();
  const filters = filtersFor(`${widget.id}#${datasetName}`, widget.id);
  const key = JSON.stringify(filters);
  const resultKey = `${itemId}|${widget.id}|${datasetName}|${sortDesc ?? ""}|${key}`;
  const [state, setState] = useState<{ data: QueryResult | null; error: string; loading: boolean }>(() => {
    const seen = seenResult<QueryResult>(resultKey);
    return { data: seen ?? null, error: "", loading: !seen };
  });

  useEffect(() => {
    const ds = widget.datasets?.find((d) => d.name === datasetName);
    if (!ds) {
      setState({ data: null, error: "", loading: false });
      return;
    }
    const ctrl = new AbortController();
    // Өмнө харсан бол шууд харуулж, ард нь шинэчилнэ
    const seen = seenResult<QueryResult>(resultKey);
    setState((s) => ({ data: seen ?? s.data, error: "", loading: !seen }));
    api
      .widgetQuery<QueryResult>(itemId, { widget_id: widget.id, dataset: datasetName, filters, sort_desc: sortDesc }, ctrl.signal, ds.statisticDefinitions?.length ? JSON.stringify(ds.dataSource ?? null) : null)
      .then((data) => {
        rememberResult(resultKey, data);
        // Өөрчлөгдөөгүй бол дахин зурахгүй
        if (!seen || seen.total !== data.total || JSON.stringify(seen.rows) !== JSON.stringify(data.rows)) setState({ data, error: "", loading: false });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ data: null, error: e.message, loading: false });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, widget.id, datasetName, key, sortDesc]);

  // Давхаргад талбар нь байхгүй шүүлтүүрийг сервер алгасдаг: тэмдэг зөвхөн үнэхээр шүүгдсэн үед
  return { ...state, filtered: filters.length > (state.data?.ignored_filters ?? 0) };
}
