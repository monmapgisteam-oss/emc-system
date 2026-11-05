export type Link = { title: string; url: string };

export type Department = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  color: string;
  sort_order: number;
  links: Link[];
  dataset_count: number;
  record_count: number;
  dashboard_count: number;
};

export type Dataset = {
  id: number;
  department_id: number;
  name: string;
  description: string | null;
  source_file: string | null;
  columns: string[];
  date_column: string | null;
  lat_column: string | null;
  lon_column: string | null;
  created_at: string;
  record_count: number;
};

export type RecordRow = {
  id: number;
  data: Record<string, unknown>;
  record_date: string | null;
  lat: number | null;
  lon: number | null;
};

export type DatasetStats = {
  record_count: number;
  numeric: Record<string, { count: number; min: number; max: number; mean: number; median: number; sum: number }>;
  categorical: Record<string, [string, number][]>;
  monthly: [string, number][];
};

export type Status = "normal" | "warning" | "alarm" | "no_data";

export type PointSummary = {
  count: number;
  first_at?: string;
  last_at?: string;
  total_mm?: number | null;
  horizontal_mm?: number | null;
  vertical_mm?: number | null;
  velocity?: number | null;
  acceleration?: number | null;
  bearing_deg?: number | null;
  predicted_failure_at?: string | null;
  days_to_failure?: number | null;
  prediction_r2?: number | null;
  window_days?: number;
  status: Status;
};

export type MonitoringPoint = {
  id: number;
  code: string;
  name: string | null;
  instrument: string;
  sector: string | null;
  lat: number | null;
  lon: number | null;
  elevation: number | null;
  warning_velocity: number;
  alarm_velocity: number;
  active: boolean;
  note: string | null;
  summary: PointSummary | null;
};

export type SeriesRow = {
  measured_at: string;
  de: number | null;
  dn: number | null;
  dz: number | null;
  dh: number | null;
  d3: number | null;
  velocity: number | null;
  acceleration: number | null;
  inv_velocity: number | null;
};

export type PointAnalysis = { point: MonitoringPoint; series: SeriesRow[]; summary: PointSummary };

export type Overview = {
  totals: { departments: number; datasets: number; records: number; points: number; measurements: number; dashboards: number };
  departments: { code: string; name: string; color: string; datasets: number; records: number; dashboards: number; description: string | null }[];
  monthly: ({ period: string } & Record<string, number | string>)[];
  displacement_status: Partial<Record<Status, number>>;
  alerts: ({ id: number; code: string; sector: string | null } & PointSummary)[];
  recent_datasets: { id: number; name: string; department: string; created_at: string }[];
};

export type AuthUser = { username: string; full_name: string; source: "arcgis" | "local"; role: string; expires_at: string };

/** Сесс дууссан (401) үед App нэвтрэх хуудас руу шилжинэ */
export const UNAUTHORIZED_EVENT = "emc:unauthorized";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (res.status === 401 && !path.startsWith("/api/auth/login")) {
    forgetClientData();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).detail ?? msg;
    } catch {
      /* JSON биш хариу */
    }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return res.json();
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export type DashboardLayoutOut = {
  sizes: Record<string, number[]>;
  tree?: unknown;
  prefs?: Record<string, string>;
  has_backup?: boolean;
  updated_by: string | null;
  updated_at: string | null;
};

export type ArcgisDashboard = { id: number; item_id: string; title: string; group: string | null; section?: string | null; sort_order: number };

// Хэлтэс хооронд шилжихэд дахин татахгүйн тулд dashboard жагсаалт, тодорхойлолтыг түр санана
const memo = new Map<string, { at: number; p: Promise<unknown> }>();
const MEMO_TTL = 5 * 60_000;

function memoized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL) return hit.p as Promise<T>;
  const p = fn().catch((e) => {
    memo.delete(key); // алдааг санахгүй — дараа дахин оролдоно
    throw e;
  });
  memo.set(key, { at: Date.now(), p });
  return p;
}

const forgetDashboards = () => [...memo.keys()].filter((k) => k.startsWith("dashboards:")).forEach((k) => memo.delete(k));

// Сүүлд харсан виджетийн хариу: dashboard-ыг дахин нээхэд шууд харагдаж, ард нь шинэчлэгдэнэ
const seenResults = new Map<string, unknown>();
const SEEN_MAX = 400;
const SEEN_MAX_ROWS = 500; // олон мөртэй хүснэгтийг санахгүй: санах ой, харьцуулалт хөтчийг удаашруулна

export const seenResult = <T,>(key: string) => seenResults.get(key) as T | undefined;

export function rememberResult(key: string, value: { rows: unknown[] }) {
  seenResults.delete(key);
  if (value.rows.length > SEEN_MAX_ROWS) return;
  seenResults.set(key, value);
  if (seenResults.size > SEEN_MAX) seenResults.delete(seenResults.keys().next().value as string);
}

/** Нэвтрэлт дуусахад цэвэрлэнэ: дараагийн хэрэглэгч өмнөхийн хаалттай датаг харах ёсгүй */
function forgetClientData() {
  memo.clear();
  seenResults.clear();
}

/** Хэлтсийн dashboard-уудыг урьдчилан ачаална (хажуугийн цэс дээр хулгана очиход) */
export function prefetchDepartment(code: string) {
  memoized(`dashboards:${code}`, () => request<ArcgisDashboard[]>(`/api/departments/${code}/dashboards`))
    .then((list) => list[0] && memoized(`def:${list[0].item_id}`, () => request(`/api/arcgis/dashboards/${list[0].item_id}`)))
    .catch(() => undefined);
}

// Нэг дор гарсан виджетүүдийн асуулгыг нэг хүсэлтээр илгээнэ: хөтөч нэг хост руу зэрэг 6 хүсэлт л явуулдаг тул
// тус тусад нь бол дараалалд зогсож, газрын зургийн хүсэлтийг ч хойшлуулдаг
type PendingQuery = { body: unknown; aborted: boolean; cancelled?: () => void; resolve: (v: never) => void; reject: (e: Error) => void };
type QueryOutcome = { error?: string };
const pendingQueries = new Map<string, PendingQuery[]>();

async function sendQueries(itemId: string, queries: PendingQuery[]) {
  const live = queries.filter((q) => !q.aborted);
  if (!live.length) return;
  // Бүх виджет цуцалсан бол (шүүлтүүр солигдсон) хүсэлтийг зогсооно: хөтчийн 6 холболтыг эзлэхгүй
  const ctrl = new AbortController();
  for (const q of live) q.cancelled = () => live.every((x) => x.aborted) && ctrl.abort();
  try {
    const { results } = await request<{ results: QueryOutcome[] }>(`/api/arcgis/dashboards/${itemId}/query-batch`, {
      ...json("POST", { queries: live.map((q) => q.body) }),
      signal: ctrl.signal,
    });
    live.forEach((q, i) => (results[i].error === undefined ? q.resolve(results[i] as never) : q.reject(new Error(results[i].error))));
  } catch (e) {
    live.forEach((q) => q.reject(e as Error));
  }
}

/**
 * Виджетийн асуулга. `batch` — статистик асуулгын эх үүсвэр: нэг эх үүсвэрийнх нэгтгэгдэж, хамт буцна.
 * Өөр давхарга удаан бол энэ нь хүлээхгүй. `null` — бичлэг татдаг (удаан байж болох) асуулга: тусдаа явна.
 */
function widgetQuery<T>(itemId: string, body: unknown, signal?: AbortSignal, batch: string | null = null): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const query: PendingQuery = { body, aborted: false, resolve: resolve as (v: never) => void, reject };
    signal?.addEventListener("abort", () => {
      query.aborted = true;
      reject(new DOMException("Цуцлагдсан", "AbortError"));
      query.cancelled?.();
    });
    if (batch === null) {
      void sendQueries(itemId, [query]);
      return;
    }
    const key = `${itemId}|${batch}`;
    const queue = pendingQueries.get(key);
    if (queue) {
      queue.push(query);
      return;
    }
    pendingQueries.set(key, [query]);
    setTimeout(() => {
      const queries = pendingQueries.get(key) ?? [];
      pendingQueries.delete(key);
      void sendQueries(itemId, queries);
    }, 0);
  });
}

export const api = {
  me: () => request<AuthUser>("/api/auth/me"),
  // Гарах үед замдаа байсан хариу кэшид буцаж орж болзошгүй: шинэ сесс үргэлж цэвэр эхэлнэ
  login: (username: string, password: string) => request<AuthUser>("/api/auth/login", json("POST", { username, password })).finally(forgetClientData),
  logout: () => {
    forgetClientData();
    return request("/api/auth/logout", { method: "POST" });
  },
  arcgisStatus: () => request<{ portal: string; credentials: boolean }>("/api/arcgis/status"),
  dashboards: (code: string) =>
    memoized(`dashboards:${code}`, () => request<ArcgisDashboard[]>(`/api/departments/${code}/dashboards`)),
  allDashboards: () =>
    request<(ArcgisDashboard & { department: string; department_name: string; color: string })[]>("/api/dashboards"),
  addDashboard: (code: string, body: { url: string; title?: string; group?: string }) =>
    request<ArcgisDashboard>(`/api/departments/${code}/dashboards`, json("POST", body)).finally(forgetDashboards),
  deleteDashboard: (id: number) => request(`/api/dashboards/${id}`, { method: "DELETE" }).finally(forgetDashboards),
  dashboardDef: <T>(itemId: string) => memoized(`def:${itemId}`, () => request<T>(`/api/arcgis/dashboards/${itemId}`)),
  widgetQuery,
  dashboardLayout: (itemId: string) => request<DashboardLayoutOut>(`/api/arcgis/dashboards/${itemId}/layout`),
  saveDashboardLayout: (itemId: string, sizes: Record<string, number[]>, prefs: Record<string, string | null> = {}) =>
    request<DashboardLayoutOut>(`/api/arcgis/dashboards/${itemId}/layout`, json("PUT", { sizes, prefs })),
  undoDashboardLayout: (itemId: string) =>
    request<DashboardLayoutOut>(`/api/arcgis/dashboards/${itemId}/layout/undo`, { method: "POST" }),
  resetDashboardLayout: (itemId: string) =>
    request<DashboardLayoutOut>(`/api/arcgis/dashboards/${itemId}/layout`, { method: "DELETE" }),
  webmapLayers: <T>(itemId: string) => request<T>(`/api/arcgis/webmaps/${itemId}/layers`),
  webmapTree: <T>(itemId: string) => request<T>(`/api/arcgis/webmaps/${itemId}/tree`),
  overview: () => request<Overview>("/api/analytics/overview"),
  departments: () => request<Department[]>("/api/departments"),
  department: (code: string) => request<Department>(`/api/departments/${code}`),
  updateDepartment: (code: string, body: Partial<Department>) =>
    request<Department>(`/api/departments/${code}`, json("PUT", body)),
  datasets: (code: string) => request<Dataset[]>(`/api/departments/${code}/datasets`),
  sheets: (code: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ sheets: string[] }>(`/api/departments/${code}/sheets`, { method: "POST", body: fd });
  },
  importDataset: (code: string, file: File, name: string, sheet: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name);
    fd.append("sheet", sheet);
    return request<Dataset>(`/api/departments/${code}/datasets/import`, { method: "POST", body: fd });
  },
  deleteDataset: (id: number) => request(`/api/datasets/${id}`, { method: "DELETE" }),
  records: (id: number, params: { limit?: number; offset?: number; q?: string }) => {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v ?? "")]));
    return request<{ total: number; items: RecordRow[] }>(`/api/datasets/${id}/records?${qs}`);
  },
  stats: (id: number) => request<DatasetStats>(`/api/datasets/${id}/stats`),
  series: (id: number, column: string, agg: string) =>
    request<{ period: string; value: number }[]>(
      `/api/datasets/${id}/series?column=${encodeURIComponent(column)}&agg=${agg}`,
    ),
  points: (windowDays: number) => request<MonitoringPoint[]>(`/api/displacement/points?window_days=${windowDays}`),
  pointAnalysis: (id: number, windowDays: number) =>
    request<PointAnalysis>(`/api/displacement/points/${id}/analysis?window_days=${windowDays}`),
  updatePoint: (id: number, body: Partial<MonitoringPoint>) =>
    request<MonitoringPoint>(`/api/displacement/points/${id}`, json("PUT", body)),
  importMeasurements: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ inserted: number; skipped_duplicates: number; created_points: number }>(
      "/api/displacement/measurements/import",
      { method: "POST", body: fd },
    );
  },
};
