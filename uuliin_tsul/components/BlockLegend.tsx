"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { fmt } from "@/lib/format";
import { MON_L, ROMAN, T, type Lang } from "@/lib/i18n";
import { BLOCK_TEXT, SLAB_CELLS, sliceValue, type BlockModelMeta, type BlockSlice, type SliceMode } from "@/lib/blockModel";

export interface BlockLegendProps {
  meta: BlockModelMeta;
  /** Харуулж буй блокийн хугацаа = сонгосон сар («II → III» бол 3) */
  period: number;
  lang: Lang;
  /** Блокийн давхарга газрын зураг дээр харагдаж байгаа эсэх */
  shown: boolean;
  /** Хугацааны товч дарахад — сарыг солиж блокийг асаана; сонгосон хугацааг
   *  дахин дарвал блокийг унтраана (MineScene) */
  onPeriod: (period: number) => void;
}

/** Картын байрлал (газрын зургийн дотор), хэмжээ — чирж/татаж өөрчилсний дараа */
interface LegendBox { x: number; y: number; w?: number; h?: number }
const BOX_KEY = "emc-block-legend-box";
const MIN_W = 240, MIN_H = 120;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const value = (number: number, decimals = 0) => number === 0 ? "0" : fmt(number, decimals);
const span = (from: number, to: number, sep = " → ") => `${ROMAN[from - 1] ?? from}${sep}${ROMAN[to - 1] ?? to}`;

export default function BlockLegend({
  meta, period, lang, shown, onPeriod,
}: BlockLegendProps) {
  const t = T[lang];
  const tx = BLOCK_TEXT[lang];
  const isMn = lang === "mn";
  const monthData = meta.months[String(period)] ?? null;
  const classes = meta.classes;
  const periods = Object.keys(meta.months).map(Number).sort((a, b) => a - b);
  const badge = monthData ? span(monthData.from, monthData.to) : ROMAN[period - 1] ?? String(period);
  const badgeTitle = monthData
    ? `${MON_L[lang][monthData.from - 1]} → ${MON_L[lang][monthData.to - 1]}`
    : MON_L[lang][period - 1];

  /* Картыг нууж/гаргана — зөвхөн толгой үлдэнэ. Сонголт хөтөчид хадгалагдана. */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("emc-block-legend") === "collapsed"); } catch { /* хадгалалтгүй */ }
  }, []);
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem("emc-block-legend", c ? "open" : "collapsed"); } catch { /* хадгалалтгүй */ }
    return !c;
  });
  const toggleLabel = collapsed ? (isMn ? "Дэлгэх" : "Expand") : (isMn ? "Нуух" : "Collapse");

  /* Агуулгын ангиллын жагсаалтыг эвхэнэ — сонголт хөтөчид хадгалагдана */
  const [classesOpen, setClassesOpen] = useState(true);
  useEffect(() => {
    try { setClassesOpen(localStorage.getItem("emc-block-legend-classes") !== "closed"); } catch { /* хадгалалтгүй */ }
  }, []);
  const toggleClasses = () => setClassesOpen((o) => {
    try { localStorage.setItem("emc-block-legend-classes", o ? "closed" : "open"); } catch { /* хадгалалтгүй */ }
    return !o;
  });

  /* Толгойноос чирж зөөнө, баруун доод булангаас хэмжээг өөрчилнө.
     Толгойг давхар дарахад анхны байрлал руу буцна. Хөтөчид хадгалагдана. */
  const ref = useRef<HTMLElement>(null);
  const [box, setBox] = useState<LegendBox | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BOX_KEY) ?? "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) setBox(saved);
    } catch { /* хадгалалтгүй */ }
  }, []);
  const saveBox = (b: LegendBox | null) => {
    setBox(b);
    try { b ? localStorage.setItem(BOX_KEY, JSON.stringify(b)) : localStorage.removeItem(BOX_KEY); } catch { /* хадгалалтгүй */ }
  };
  const startDrag = (e: ReactPointerEvent, kind: "move" | "size") => {
    if (e.button !== 0) return;
    if (kind === "move" && (e.target as HTMLElement).closest("button")) return;
    const el = ref.current, host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const s = { px: e.clientX, py: e.clientY, x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
    let next: LegendBox = box ?? { x: s.x, y: s.y };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - s.px, dy = ev.clientY - s.py;
      next = kind === "move"
        ? { ...next, x: clamp(s.x + dx, 0, hr.width - s.w), y: clamp(s.y + dy, 0, hr.height - s.h) }
        : { x: s.x, y: s.y, w: clamp(s.w + dx, MIN_W, hr.width - s.x), h: clamp(s.h + dy, MIN_H, hr.height - s.y) };
      setBox(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("is-dragging");
      saveBox(next);
    };
    document.body.classList.add("is-dragging");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  /* Газрын зураг багассан ч карт гадагш гарахгүй — хамгийн багадаа толгой нь харагдана */
  const style = box ? {
    left: `max(0px, min(${box.x}px, calc(100% - 120px)))`,
    top: `max(0px, min(${box.y}px, calc(100% - 44px)))`,
    right: "auto", bottom: "auto",
    width: box.w, height: collapsed ? undefined : box.h,
    maxWidth: "calc(100% - 4px)", maxHeight: "calc(100% - 4px)",
  } : undefined;
  const moveTip = isMn ? "Чирж зөөх · давхар дарж анхны байрлалд" : "Drag to move · double-click to reset";

  return (
    <aside ref={ref} style={style}
           className={`block-legend${monthData ? "" : " block-legend--empty"}${collapsed ? " block-legend--collapsed" : ""}`}
           aria-label={`${t.blkTitle} · ${badgeTitle}`}>
      <header className="block-legend__header block-legend__header--drag" title={moveTip}
              onPointerDown={(e) => startDrag(e, "move")}
              onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button")) saveBox(null); }}>
        <div><h3>Block model</h3></div>
        {shown && <span className="block-legend__period" title={badgeTitle} aria-label={badgeTitle}>{badge}</span>}
        <button type="button" className="block-legend__toggle" onClick={toggle}
                aria-expanded={!collapsed} aria-controls="block-legend-body"
                title={toggleLabel} aria-label={toggleLabel}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={collapsed ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
          </svg>
        </button>
      </header>

      <div id="block-legend-body" className="block-legend__body" hidden={collapsed}>
        {/* Хугацаа — сонгоход газрын зураг доорх сарын мөр ч хамт солигдоно */}
        <div className="block-legend__label">
          <span>{isMn ? "Хугацаа" : "Period"}</span>
        </div>
        <div className="block-legend__periods" role="group" aria-label={isMn ? "Хугацаа" : "Period"}>
          {periods.map((p) => {
            const d = meta.months[String(p)];
            return (
              <button key={p} type="button" aria-pressed={shown && p === period}
                      title={`${MON_L[lang][d.from - 1]} → ${MON_L[lang][d.to - 1]}`}
                      onClick={() => onPeriod(p)}>
                {/* Төгсгөлийн сар л — газрын зураг доорх сарын мөртэй ижил; бүтэн
                    хугацаа нь толгойн тэмдэг ба title-д байна */}
                {ROMAN[d.to - 1] ?? d.to}
              </button>
            );
          })}
        </div>

        {/* I сард блок байхгүй — зөвхөн хугацааны товчнууд үлдэнэ */}
        {monthData && shown && (
          <>
            <dl className="block-legend__metrics">
              <div><dt>{isMn ? "Нийт масс" : "Total mass"}</dt><dd>{value(monthData.kt, 1)}<small>{t.blkKt}</small></dd></div>
              <div><dt>{isMn ? "Дундаж Cu" : "Average Cu"}</dt><dd>{monthData.cu.toFixed(3)}<small>%</small></dd></div>
            </dl>

            <button type="button" className="block-legend__columns" onClick={toggleClasses}
                    aria-expanded={classesOpen} aria-controls="block-legend-classes">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={classesOpen ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} />
                </svg>
                {isMn ? "Cu агуулга, %" : "Cu grade, %"}
              </span>
              <span>{isMn ? "Массын хувь" : "Mass share"}</span>
            </button>
            <ul id="block-legend-classes" className="block-legend__classes" hidden={!classesOpen}>
              {classes.map((item, index) => {
                const upper = classes[index + 1]?.min;
                const range = index === 0 && upper !== undefined
                  ? `< ${upper.toFixed(2)}`
                  : upper === undefined ? `≥ ${item.min.toFixed(2)}` : `${item.min.toFixed(2)}–${upper.toFixed(2)}`;
                const share = Number.isFinite(monthData.share[index]) ? monthData.share[index] : null;
                const percentage = share === null ? "—" : `${(share * 100).toFixed(1)}%`;
                return (
                  <li className="block-legend__class" key={`${item.min}-${index}`}
                    aria-label={`${tx.classes[index]} · ${range} Cu%: ${percentage}`}>
                    <span className="block-legend__swatch" style={{ background: item.color }} aria-hidden="true" />
                    <span className="block-legend__range">{range}<small>{tx.classes[index]}</small></span>
                    <span className="block-legend__track" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, (share ?? 0) * 100))}%`, background: item.color }} /></span>
                    <span className="block-legend__share">{percentage}</span>
                  </li>
                );
              })}
            </ul>

            <footer className="block-legend__footer"><span>{value(monthData.blocks)} {isMn ? "блок" : "blocks"}</span><span>Micromine</span></footer>
          </>
        )}
      </div>
      {!collapsed && (
        <span className="block-legend__grip" aria-hidden="true" title={isMn ? "Хэмжээг өөрчлөх" : "Resize"}
              onPointerDown={(e) => startDrag(e, "size")} />
      )}
    </aside>
  );
}

/** Блок моделийн зүсэлт — газрын зургийн зүүн дээд буланд, суурь зургийн
 *  дүрсийн доорх «зүсэлт» дүрсийг дарахад нээгдэнэ (Esri Expand-ийн агуулга).
 *  Зүссэн нүүр нь доторх блокуудын өнгөөр харагдана. */
export function BlockSlicePanel({ meta, period, lang, slice, onSlice }: {
  meta: BlockModelMeta | null;
  period: number;
  lang: Lang;
  slice: BlockSlice;
  onSlice: (slice: BlockSlice) => void;
}) {
  const isMn = lang === "mn";
  const monthData = meta?.months[String(period)] ?? null;
  const modes: { m: SliceMode; n: string }[] = [
    { m: "off", n: isMn ? "Үгүй" : "Off" },
    { m: "z", n: isMn ? "Хэвтээ" : "Plan" },
    { m: "i", n: isMn ? "Дагуу" : "Long" },
    { m: "j", n: isMn ? "Хөндлөн" : "Cross" },
  ];
  const axis = slice.mode === "i" ? 0 : slice.mode === "j" ? 1 : 2;
  const steps = monthData ? monthData.dims[axis] : 1;
  const sv = meta && monthData && slice.mode !== "off" ? sliceValue(monthData, meta, slice) : 0;
  /* Нэг үе сонгосон бол мужаар нь (RL 1243–1258 м), эс бол зүсэлтийн түвшин */
  const svLo = meta ? sv - SLAB_CELLS * meta.cell[axis] : sv;
  const svText = slice.slab ? `${fmt(svLo, 0)}–${fmt(sv, 0)}` : fmt(sv, 0);
  const sliceLabel = slice.mode === "z" ? `RL ${svText} м` : `${svText} м`;

  return (
    <div className="block-legend block-legend--pop">
      <header className="block-legend__header">
        <div><span className="block-legend__eyebrow">{isMn ? "БЛОК МОДЕЛЬ" : "BLOCK MODEL"}</span><h3>{isMn ? "Зүсэлт" : "Slice"}</h3></div>
        {slice.mode !== "off" && monthData && <span className="block-legend__period">{sliceLabel}</span>}
      </header>
      <div className="block-legend__seg" role="group" aria-label={isMn ? "Зүсэлт" : "Slice"}>
        {modes.map(({ m, n }) => (
          <button key={m} type="button" aria-pressed={slice.mode === m}
                  onClick={() => onSlice({ ...slice, mode: m, pos: slice.mode === "off" ? 0.6 : slice.pos })}>
            {n}
          </button>
        ))}
      </div>
      {/* Гулсуурыг блоктой сард л харуулна (I сард блок байхгүй) */}
      {monthData && slice.mode !== "off" && (
        <div className="block-legend__slice">
          <input type="range" min={0} max={1} step={1 / Math.max(steps, 1)} value={slice.pos}
                 aria-label={sliceLabel}
                 onChange={(e) => onSlice({ ...slice, pos: Number(e.target.value) })} />
          <label>
            <input type="checkbox" checked={slice.slab}
                   onChange={(e) => onSlice({ ...slice, slab: e.target.checked })} />
            {slice.mode === "z"
              ? (isMn ? "Зөвхөн нэг шат (15 м)" : "Single bench (15 m)")
              : (isMn ? "Зөвхөн нэг огтлол (20 м)" : "Single section (20 m)")}
          </label>
        </div>
      )}
    </div>
  );
}
