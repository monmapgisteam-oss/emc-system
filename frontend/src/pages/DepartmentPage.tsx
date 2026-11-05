import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { IconTable } from "../components/icons";
import { api, ArcgisDashboard, Dataset, DatasetStats, Department, RecordRow } from "../api";
import MapView from "../components/MapView";
import DashboardView, { DashboardSkeleton } from "../dashboard/DashboardView";
import { fmt, fmtDate } from "../components/ui";

const PAGE = 100;

function ImportPanel({ code, onDone }: { code: string; onDone: (d: Dataset) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pick = async (f: File | null) => {
    setFile(f);
    setSheets([]);
    setSheet("");
    setMsg(null);
    if (f && /\.(xlsx|xlsm|xls)$/i.test(f.name)) {
      const { sheets } = await api.sheets(code, f);
      setSheets(sheets);
      setSheet(sheets[0] ?? "");
    }
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const d = await api.importDataset(code, file, name, sheet);
      setMsg({ ok: true, text: `${fmt(d.record_count, 0)} бичлэг амжилттай орлоо` });
      setName("");
      onDone(d);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2>Дата оруулах (Excel / CSV)</h2>
      <div className="toolbar">
        <input type="file" accept=".xlsx,.xlsm,.xls,.csv" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        {sheets.length > 1 && (
          <select value={sheet} onChange={(e) => setSheet(e.target.value)} aria-label="Хуудас">
            {sheets.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        <input type="text" placeholder="Хүснэгтийн нэр (заавал биш)" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={submit} disabled={!file || busy}>
          {busy ? "Оруулж байна…" : "Оруулах"}
        </button>
      </div>
      <div className="note">
        Эхний мөр нь баганын нэр байна. «Огноо/Date», «Lat/Өргөрөг», «Lon/Уртраг» баганыг автоматаар таньж, цаг хугацааны
        дүн шинжилгээ болон газрын зурагт ашиглана.
      </div>
      {msg && <div className={msg.ok ? "ok" : "error"}>{msg.text}</div>}
    </div>
  );
}

function StatsView({ stats }: { stats: DatasetStats }) {
  const numeric = Object.entries(stats.numeric);
  const cats = Object.entries(stats.categorical);
  return (
    <div className="grid cols-2">
      <div>
        <h2>Тоон баганууд</h2>
        {numeric.length === 0 ? (
          <div className="empty">Тоон багана алга</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Багана</th>
                  <th className="num">Тоо</th>
                  <th className="num">Бага</th>
                  <th className="num">Дундаж</th>
                  <th className="num">Медиан</th>
                  <th className="num">Их</th>
                  <th className="num">Нийлбэр</th>
                </tr>
              </thead>
              <tbody>
                {numeric.map(([c, s]) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td className="num">{fmt(s.count, 0)}</td>
                    <td className="num">{fmt(s.min, 2)}</td>
                    <td className="num">{fmt(s.mean, 2)}</td>
                    <td className="num">{fmt(s.median, 2)}</td>
                    <td className="num">{fmt(s.max, 2)}</td>
                    <td className="num">{fmt(s.sum, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div>
        <h2>Ангиллын баганууд (хамгийн их давтагдсан)</h2>
        {cats.length === 0 ? (
          <div className="empty">Ангиллын багана алга</div>
        ) : (
          cats.map(([c, top]) => (
            <details key={c} style={{ marginBottom: 8 }}>
              <summary>
                {c} <span className="note">({top.length} утга)</span>
              </summary>
              <table>
                <tbody>
                  {top.map(([v, n]) => (
                    <tr key={v}>
                      <td>{v}</td>
                      <td className="num">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))
        )}
      </div>
    </div>
  );
}

function DatasetView({ dataset, onDeleted }: { dataset: Dataset; onDeleted: () => void }) {
  const [tab, setTab] = useState<"table" | "map" | "stats">("table");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ total: number; items: RecordRow[] } | null>(null);
  const [mapRows, setMapRows] = useState<RecordRow[]>([]);
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const hasGeo = Boolean(dataset.lat_column && dataset.lon_column);

  useEffect(() => {
    setTab("table");
    setOffset(0);
    setQ("");
    setStats(null);
    setMapRows([]);
  }, [dataset.id]);

  useEffect(() => {
    const t = setTimeout(() => api.records(dataset.id, { limit: PAGE, offset, q }).then(setPage), 200);
    return () => clearTimeout(t);
  }, [dataset.id, offset, q]);

  useEffect(() => {
    if (tab === "stats" && !stats) api.stats(dataset.id).then(setStats);
    if (tab === "map" && !mapRows.length) api.records(dataset.id, { limit: 5000 }).then((p) => setMapRows(p.items));
  }, [tab, dataset.id, stats, mapRows.length]);

  const remove = async () => {
    if (!confirm(`«${dataset.name}» хүснэгтийг бүх бичлэгтэй нь устгах уу?`)) return;
    await api.deleteDataset(dataset.id);
    onDeleted();
  };

  const label = (r: RecordRow) => String(Object.values(r.data).find((v) => typeof v === "string") ?? `#${r.id}`);

  return (
    <div className="card">
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>{dataset.name}</h2>
          <div className="note" style={{ marginTop: 2 }}>
            {fmt(dataset.record_count, 0)} бичлэг · {dataset.columns.length} багана · {fmtDate(dataset.created_at, true)}
            {dataset.date_column && ` · огноо: «${dataset.date_column}»`}
          </div>
        </div>
        <button className="danger" onClick={remove}>
          Устгах
        </button>
      </div>
      <div className="tabs">
        <button className={tab === "table" ? "active" : ""} onClick={() => setTab("table")}>
          Хүснэгт
        </button>
        <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>
          Статистик
        </button>
        {hasGeo && (
          <button className={tab === "map" ? "active" : ""} onClick={() => setTab("map")}>
            Газрын зураг
          </button>
        )}
      </div>

      {tab === "table" && (
        <>
          <div className="toolbar">
            <input
              type="search"
              placeholder="Хайх…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
            />
            {page && (
              <span className="note" style={{ margin: 0 }}>
                {fmt(page.total, 0)}-аас {page.total ? offset + 1 : 0}–{Math.min(offset + PAGE, page.total)}
              </span>
            )}
            <button className="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              ‹ Өмнөх
            </button>
            <button
              className="ghost"
              disabled={!page || offset + PAGE >= page.total}
              onClick={() => setOffset(offset + PAGE)}
            >
              Дараах ›
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {dataset.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page?.items.map((r) => (
                  <tr key={r.id}>
                    {dataset.columns.map((c) => {
                      const v = r.data[c];
                      return (
                        <td key={c} className={typeof v === "number" ? "num" : undefined}>
                          {v === null || v === undefined ? "" : typeof v === "number" ? fmt(v, 4) : String(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "stats" && (stats ? <StatsView stats={stats} /> : <div className="empty">Тооцоолж байна…</div>)}
      {tab === "map" && (
        <MapView
          points={mapRows
            .filter((r) => r.lat !== null && r.lon !== null)
            .map((r) => ({ id: r.id, lat: r.lat!, lon: r.lon!, color: "#2a78d6", label: label(r) }))}
        />
      )}
    </div>
  );
}

function DepartmentData({ code }: { code: string }) {
  const [params, setParams] = useSearchParams();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const selectedId = Number(params.get("dataset")) || datasets[0]?.id;
  const selected = datasets.find((d) => d.id === selectedId);

  const load = useCallback(() => {
    api.datasets(code).then(setDatasets).catch(() => setDatasets([]));
  }, [code]);
  useEffect(load, [load]);

  const select = (id?: number) => {
    const next = new URLSearchParams(params);
    if (id) next.set("dataset", String(id));
    else next.delete("dataset");
    setParams(next);
  };

  return (
    <>
      <ImportPanel
        code={code}
        onDone={(d) => {
          load();
          select(d.id);
        }}
      />
      {datasets.length === 0 ? (
        <div className="card empty">Энэ хэлтэст Excel/CSV дата хараахан оруулаагүй байна.</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "260px 1fr", alignItems: "start" }}>
          <div className="card" style={{ padding: 8 }}>
            <table>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.id} className={`clickable ${d.id === selectedId ? "selected" : ""}`} onClick={() => select(d.id)}>
                    <td style={{ whiteSpace: "normal" }}>
                      <div>{d.name}</div>
                      <div className="note" style={{ marginTop: 2 }}>
                        {fmt(d.record_count, 0)} бичлэг
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && (
            <DatasetView
              dataset={selected}
              onDeleted={() => {
                select(undefined);
                load();
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

const DATA_TAB = "data";
const SIDE_KEY = "emc-dept-side";

export default function DepartmentPage({ departments }: { departments: Department[] }) {
  const { code = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [fetched, setFetched] = useState<Department | null>(null);
  // Жагсаалтыг аль хэлтсийнх болохыг хамт хадгална — шилжих үед өмнөх хэлтсийнхийг ашиглахгүй
  const [loaded, setLoaded] = useState<{ code: string; list: ArcgisDashboard[] } | null>(null);
  const [error, setError] = useState("");

  // Хэлтсийн мэдээлэл аль хэдийн байгаа тул нэр, толгой мөр шууд солигдоно
  const dep = departments.find((d) => d.code === code.toUpperCase()) ?? (fetched?.code === code.toUpperCase() ? fetched : null);

  const load = useCallback(() => {
    setError("");
    if (!departments.some((d) => d.code === code.toUpperCase())) {
      api.department(code).then(setFetched).catch((e) => setError(e.message));
    }
    api
      .dashboards(code)
      .then((list) => setLoaded({ code, list }))
      .catch(() => setLoaded({ code, list: [] }));
  }, [code, departments]);
  useEffect(load, [load]);

  const ready = loaded?.code === code;
  const dashboards = ready ? loaded.list : [];

  const groupOf = (d: ArcgisDashboard) => d.group ?? "Бусад";
  const groups = [...new Set(dashboards.map(groupOf))];
  const view = params.get("view") ?? (dashboards[0] ? String(dashboards[0].id) : DATA_TAB);
  const current = dashboards.find((d) => String(d.id) === view);
  const go = (v: string) => setParams({ view: v });

  // Хажуугийн самбар: нэг удаад нэг бүлэг нээлттэй, идэвхтэй dashboard-ын бүлэг автоматаар нээгдэнэ
  const currentGroup = current ? groupOf(current) : null;
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  useEffect(() => setOpenGroups(currentGroup ? new Set([currentGroup]) : new Set()), [currentGroup, code]);
  const toggleGroup = (g: string) => setOpenGroups((prev) => (prev.has(g) ? new Set() : new Set([g])));

  // Самбарыг хурааж газрын зураг, хүснэгтэд зай гаргана — сонголтыг энэ хөтөч дээр санана
  const [sideOff, setSideOff] = useState(() => {
    try {
      return localStorage.getItem(SIDE_KEY) === "off";
    } catch {
      return false;
    }
  });
  const toggleSide = () => {
    setSideOff(!sideOff);
    try {
      localStorage.setItem(SIDE_KEY, sideOff ? "on" : "off");
    } catch {
      /* хадгалах боломжгүй */
    }
  };

  if (error) return <div className="page error">{error}</div>;
  if (!dep || !ready) {
    // Ачаалах зуурт хар дэлгэц биш — хэлтсийн нэр, dashboard-ын «араг» харагдана
    return (
      <div className={`dept-work ${sideOff ? "side-off" : ""}`}>
        <aside className="dept-side" aria-busy="true">
          {!sideOff && (
            <>
              <span className="sk sk-pill" />
              <span className="sk sk-pill" />
              <span className="sk sk-pill" />
            </>
          )}
        </aside>
        <div className="dash-page">
          <div className="dash-body">
            <DashboardSkeleton />
          </div>
        </div>
      </div>
    );
  }

  // Dashboard харуулж байх үед хуудас дэлгэцэнд яг багтана (гүйлгэхгүй)
  const fit = view !== DATA_TAB && Boolean(current);

  return (
    <div className={`dept-work ${sideOff ? "side-off" : ""}`}>
      {/* Бүлэг, dashboard-ууд хажуугийн самбарт. Нэг section-ий хувилбарууд идэвхтэй үед дотор нь дэлгэгдэнэ */}
      <aside className="dept-side" aria-label="Dashboard-ууд">
        {sideOff ? (
          <button className="dept-toggle" onClick={toggleSide} title="Самбарыг нээх" aria-label="Самбарыг нээх">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <>
        <nav>
          {groups.map((g) => {
            const items = dashboards.filter((d) => groupOf(d) === g);
            const tops = items.filter((d) => !d.section || items.find((x) => x.section === d.section) === d);
            // Ганц бүлэгтэй хэлтэст бүлгийн гарчиг хэрэггүй
            const single = groups.length === 1;
            const isOpen = single || openGroups.has(g);
            return (
              <section key={g}>
                {!single && (
                  <button className={`dept-group ${isOpen ? "open" : ""}`} aria-expanded={isOpen} onClick={() => toggleGroup(g)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                    <span>{g}</span>
                    {!isOpen && g === currentGroup ? <i aria-hidden /> : <small>{tops.length}</small>}
                  </button>
                )}
                {isOpen && (
                  <div className={`dept-items ${single ? "flat" : ""}`}>
                    {tops.map((d) => {
                      const subs = d.section ? items.filter((x) => x.section === d.section) : [];
                      const active = d.section ? d.section === current?.section && g === currentGroup : d.id === current?.id;
                      return (
                        <div key={d.id}>
                          <button className={active ? "on" : ""} title={d.section ?? d.title} aria-current={active && subs.length < 2 ? "page" : undefined} onClick={() => !active && go(String(d.id))}>
                            {d.section ?? d.title}
                          </button>
                          {active && subs.length > 1 && (
                            <div className="dept-sub">
                              {subs.map((x) => (
                                <button key={x.id} className={x.id === current?.id ? "on" : ""} aria-current={x.id === current?.id ? "page" : undefined} onClick={() => go(String(x.id))}>
                                  {x.title}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </nav>
        <div className="dept-foot">
          <button className={`dept-data ${view === DATA_TAB ? "on" : ""}`} onClick={() => go(DATA_TAB)}>
            <IconTable size={14} />
            Excel / CSV дата
          </button>
          <button className="dept-toggle" onClick={toggleSide} title="Самбарыг хураах" aria-label="Самбарыг хураах">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </div>
          </>
        )}
      </aside>
      <div className={fit ? "dash-page" : "dept-scroll"}>
      <div className={fit ? "dash-body" : "page"}>
        {view === DATA_TAB ? (
          <DepartmentData code={code} />
        ) : current ? (
          <DashboardView key={current.item_id} itemId={current.item_id} title={current.title} />
        ) : (
          <div className="card empty">Энэ хэлтэст ArcGIS dashboard холбоогүй байна.</div>
        )}
      </div>
      </div>
    </div>
  );
}
