import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api, ArcgisDashboard, Department } from "../api";
import { IconSearch } from "./icons";

type CatalogItem = ArcgisDashboard & { department: string; department_name: string; color: string };
type Hit = { key: string; title: string; hint?: string; to: string };

const PAGES: Hit[] = [
  { key: "monitor", title: "Хяналтын самбар", to: "/monitor" },
  { key: "displacement", title: "Уулын цулын шилжилт", to: "/displacement" },
  { key: "geodata", title: "Геомэдээллийн сан", to: "/geodata" },
];

/** Бүх хуудас, хэлтэс, dashboard-аас хайх цонх — Ctrl+K эсвэл толгой мөрийн товчоор */
export default function WorkspaceSearch({ departments }: { departments: Department[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setAt(0);
    if (!catalog) api.allDashboards().then(setCatalog).catch(() => setCatalog([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hits = useMemo(() => {
    const all: Hit[] = [
      ...PAGES,
      ...departments.map((d) => ({ key: `dept:${d.code}`, title: d.name, hint: "Хэлтэс", to: `/dept/${d.code}` })),
      ...(catalog ?? []).map((d) => ({
        key: `dash:${d.id}`,
        title: d.section ? `${d.section} · ${d.title}` : d.title,
        hint: d.department_name,
        to: `/dept/${d.department}?view=${d.id}`,
      })),
    ];
    const t = q.trim().toLowerCase();
    if (!t) return all;
    return all.filter((h) => `${h.title} ${h.hint ?? ""}`.toLowerCase().includes(t));
  }, [catalog, departments, q]);

  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    list.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const go = (h?: Hit) => {
    if (!h) return;
    setOpen(false);
    navigate(h.to);
  };

  return (
    <>
      <button className="wk-find" onClick={() => setOpen(true)} title="Хайх (Ctrl+K)">
        <IconSearch size={15} />
        <span>Хайх</span>
        <kbd>Ctrl K</kbd>
      </button>
      {/* Толгой мөрийн давхраас гаргана — эс бөгөөс газрын зургийн товчнууд цонхны дээр гарна */}
      {open && createPortal(
        <div className="wk-search-back" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="wk-search" role="dialog" aria-modal="true" aria-label="Хайх">
            <label>
              <IconSearch size={17} />
              <input
                autoFocus
                type="search"
                placeholder="Хуудас, хэлтэс, dashboard хайх"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setAt((i) => Math.min(hits.length - 1, i + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setAt((i) => Math.max(0, i - 1));
                  } else if (e.key === "Enter") go(hits[at]);
                }}
              />
            </label>
            <div className="wk-search-list" ref={list}>
              {hits.map((h, i) => (
                <button key={h.key} className={i === at ? "on" : ""} onMouseEnter={() => setAt(i)} onClick={() => go(h)}>
                  <span>{h.title}</span>
                  {h.hint && <small>{h.hint}</small>}
                </button>
              ))}
              {!hits.length && <div className="wk-search-empty">Олдсонгүй</div>}
            </div>
            <div className="wk-search-foot">Esc — хаах · ↑↓ — сонгох · Enter — нээх</div>
          </div>
        </div>,
        document.querySelector(".app") ?? document.body,
      )}
    </>
  );
}
