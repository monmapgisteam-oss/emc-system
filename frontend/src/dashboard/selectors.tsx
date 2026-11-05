import { useEffect, useMemo, useRef, useState } from "react";
import { useDashboard, useWidgetData } from "./context";
import { displayValue, stripHtml } from "./format";
import type { Widget } from "./types";

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return { open, setOpen, ref };
}

export function CategorySelector({ widget }: { widget: Widget }) {
  const { selections, setSelection } = useDashboard();
  const { data, loading } = useWidgetData(widget);
  const { open, setOpen, ref } = usePopover();
  const [q, setQ] = useState("");
  const field = widget.datasets?.[0]?.groupByFields?.[0];
  const meta = data?.fields.find((f) => f.name === field);
  const multiple = widget.selection?.type !== "single";
  const sel = selections[widget.id];
  const selected = new Set((sel?.values ?? []).map(String));
  const label = stripHtml(widget.label) || widget.name || field || "Шүүлтүүр";

  const options = useMemo(
    () =>
      (data?.rows ?? [])
        .map((r) => ({ raw: field ? r[field] : undefined, label: displayValue(field ? r[field] : undefined, meta) }))
        .filter((o) => o.raw !== undefined && !(o.raw === null && widget.selection?.allowNone === false)),
    [data, field, meta, widget.selection?.allowNone],
  );
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  const choose = (raw: unknown) => {
    if (!field) return;
    let values: unknown[];
    if (multiple) {
      values = selected.has(String(raw)) ? (sel?.values ?? []).filter((v) => String(v) !== String(raw)) : [...(sel?.values ?? []), raw];
    } else {
      values = selected.has(String(raw)) ? [] : [raw];
      setOpen(false);
    }
    setSelection(widget.id, values.length ? { field, op: "in", values } : null);
  };

  const summary =
    selected.size === 0
      ? "Бүгд"
      : selected.size === 1
        ? options.find((o) => selected.has(String(o.raw)))?.label ?? "1 сонгосон"
        : `${selected.size} сонгосон`;

  return (
    <div className="dw-selector" ref={ref}>
      <button className={`dw-selector-btn ${selected.size ? "active" : ""}`} onClick={() => setOpen(!open)}>
        <span className="lbl">{label}</span>
        <span className="val">{summary}</span>
      </button>
      {open && (
        <div className="dw-popover">
          {(widget.showFilter ?? true) && options.length > 8 && (
            <input type="search" placeholder="Хайх…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          )}
          <div className="opts">
            {loading && !options.length && <div className="dw-msg">Ачаалж байна…</div>}
            {shown.map((o) => (
              <label key={String(o.raw)} className={selected.has(String(o.raw)) ? "on" : ""}>
                <input type={multiple ? "checkbox" : "radio"} checked={selected.has(String(o.raw))} onChange={() => choose(o.raw)} />
                {o.label}
              </label>
            ))}
          </div>
          {selected.size > 0 && (
            <button className="ghost" onClick={() => setSelection(widget.id, null)}>
              Цэвэрлэх
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DateSelector({ widget }: { widget: Widget }) {
  const { selections, setSelection } = useDashboard();
  const { open, setOpen, ref } = usePopover();
  const sel = selections[widget.id];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const label = stripHtml(widget.label) || "Огноо";

  const apply = () => {
    if (!from && !to) setSelection(widget.id, null);
    else setSelection(widget.id, { field: "filterField", op: "between", values: [from ? `${from}T00:00:00` : null, to ? `${to}T23:59:59` : null] });
    setOpen(false);
  };

  return (
    <div className="dw-selector" ref={ref}>
      <button className={`dw-selector-btn ${sel ? "active" : ""}`} onClick={() => setOpen(!open)}>
        <span className="lbl">{label}</span>
        <span className="val">{sel ? `${from || "…"} — ${to || "…"}` : "Бүх хугацаа"}</span>
      </button>
      {open && (
        <div className="dw-popover">
          <label className="field">
            Эхлэх
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            Дуусах
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div className="toolbar" style={{ margin: "8px 0 0" }}>
            <button onClick={apply}>Хэрэглэх</button>
            {sel && (
              <button className="ghost" onClick={() => { setFrom(""); setTo(""); setSelection(widget.id, null); setOpen(false); }}>
                Цэвэрлэх
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
