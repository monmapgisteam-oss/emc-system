"use client";

import { useStore } from "@/lib/store";
import { C, COL_NAMES, ELEV } from "@/lib/config";
import { benchesOf, cuOf, metalSum, moOf, monthlyFlow, sumCol } from "@/lib/excel";
import { fmt } from "@/lib/format";
import { MON_L, ROMAN } from "@/lib/i18n";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type React from "react";
import BenchDetail from "./BenchDetail";
import DestinationBreakdown from "./DestinationBreakdown";

/* ==========================================================================
   ХОЛБОГДСОН ШҮҮЛТ. Бүх чарт нэг Excel-ээс уншдаг тул нэг дор шүүгдэх
   ёстой: хаялбар сонгоход бусад бүх чарт ЗӨВХӨН тэр түвшний тоог үзүүлнэ.
   Сонголт нь `sel` (store) — хаялбарын жагсаалт болон газрын зургаас
   хоёулангаас нь тавигдана.
   ========================================================================== */
function useTuv(): number | undefined {
  const { sel } = useStore();
  return sel?.kind === "bench" ? sel.tuv : undefined;
}

/* ------------------------------------------------------------------ KPI */
/* KPI-ийн дүрсүүд — 24×24, зураасан (stroke) хэв маяг */
const KPI_ICONS: Record<string, React.ReactNode> = {
  /* олборлосон нөөц — хүдрийн талст */
  res: (<><path d="M6.5 3.5h11l4 5.5L12 20.5 2.5 9z" /><path d="M2.5 9h19" /><path d="M9 3.5 7.5 9 12 20.5 16.5 9 15 3.5" /></>),
  /* нийт хүдэр — хүдэртэй вагонетка */
  ore: (<><path d="M2.5 9h19l-2.2 7.5H4.7z" /><path d="M6.5 9 8.5 5.5l3 2 3-2.5L17.5 9" /><circle cx="8" cy="19.5" r="1.6" /><circle cx="16" cy="19.5" r="1.6" /></>),
  /* хоосон чулуулаг — овоолго */
  waste: (<><path d="M1.5 20.5 8.5 9l3.5 5 3-4 7.5 10.5z" /><path d="M6 13.2l2.3 1.3 1.7-1.6" /></>),
  /* нийт уулын цул — давхаргууд */
  rock: (<><path d="m12 2.8 9.5 5L12 12.8 2.5 7.8z" /><path d="m2.5 12.2 9.5 5 9.5-5" /><path d="m2.5 16.6 9.5 5 9.5-5" /></>),
};

export function Kpis() {
  const { m, t } = useStore();
  const tuv = useTuv();
  const p = m > 1 ? m - 1 : null;
  /* Дөрвөн үзүүлэлт нь Excel-ийн ДӨРВӨН баганаас шууд:
       NOOC   — олборлосон үйлдвэрлэлийн нөөц (захын агуулга 0.25 %)
       NIIT   — нийт олборлосон хүдэр (БҮ + овоолгууд)
       HOOSON — хоосон чулуулаг (Овоолго №1, 4, 11)
       TSUL   — нийт уулын цул */
  /* `c` — картын өнгө: дүрсний хайрцаг ба доорх шошгыг өнгөлнө */
  const defs = [
    { k: t.kRes,   s: t.kResSub,   ci: C.NOOC,   u: t.uKt, dec: 1, ic: "res",   c: "var(--g4)" },
    { k: t.kOre,   s: t.kOreSub,   ci: C.NIIT,   u: t.uKt, dec: 0, ic: "ore",   c: "var(--s1)" },
    { k: t.kWaste, s: t.kWasteSub, ci: C.HOOSON, u: t.uM3, dec: 1, ic: "waste", c: "var(--s4)" },
    { k: t.kRock,  s: t.kRockSub,  ci: C.TSUL,   u: t.uM3, dec: 0, ic: "rock",  c: "var(--ui)" },
  ];
  return (
    <div className="kpis">
      {defs.map((o) => {
        const v = sumCol(m, o.ci, tuv);
        const prev = p ? sumCol(p, o.ci, tuv) : null;
        const pc = prev ? ((v - prev) / prev) * 100 : null;
        return (
          <div className="kpi" key={o.k} style={{ ["--c" as any]: o.c } as React.CSSProperties}>
            <span className="kic" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                   strokeLinecap="round" strokeLinejoin="round">{KPI_ICONS[o.ic]}</svg>
            </span>
            <div className="kbody">
              <div className="k">{o.k}</div>
              <div className="v">
                <b>{fmt(v, o.dec)}</b>
                <i>{o.u}</i>
                {pc !== null && (
                  <em className={pc >= 0 ? "up" : "dn"}>
                    {(pc >= 0 ? "▲ " : "▼ ") + Math.abs(pc).toFixed(1) + "%"}
                  </em>
                )}
              </div>
              <div className="ks"><i /><span>{o.s}</span></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------- түвшний рейл */
export function BenchRail() {
  const { m, t, lang, sel, toggleBench, setTip } = useStore();
  /* Зөвхөн тухайн сард ХӨДӨЛГӨӨНТЭЙ түвшин. Мэдээлэлгүй хаялбарыг бүдэг
     шошготой үлдээж үзсэн боловч жагсаалтын талыг эзэлж, утгатай мөрүүд
     доош түлхэгдэж байв. Түвшний өндөр зүүн талд, багана нь зүүн талын
     тэнхлэгээс БАРУУН тийш ургана. */
  const act = benchesOf(m);
  const tot = act.reduce((a2, e) => a2 + sumCol(m, C.NIIT, e), 0) || 1;
  const mx = Math.max(...act.map((e) => sumCol(m, C.NIIT, e)), 1);

  return (
    <div className="rail">
      {act.map((e) => {
        const kt = sumCol(m, C.NIIT, e);
        const cu = cuOf(m, e);
        const w = (kt / mx) * 100;
        /* Сонгогдсон мөр дээр ДАХИН дарахад шүүлт цуцлагдана — зөвлөмжийг
           tooltip-ийн доод мөрөнд шууд бичиж өгнө. */
        const on = sel?.kind === "bench" && sel.tuv === e;
        return (
          <button
            key={e}
            className="bench"
            aria-pressed={on}
            title={on ? t.filterOff : undefined}
            onClick={() => toggleBench(e)}
            onMouseEnter={(ev) =>
              setTip({
                x: ev.clientX, y: ev.clientY,
                title: `${t.dBench} ${e} м`, key: `${m} | ${e}`,
                hint: on ? t.filterAgain : undefined,
                rows: [
                  { label: COL_NAMES[lang][C.NIIT], value: `${fmt(kt, 0)} ${t.uKt}`, color: "var(--bench)" },
                  { label: t.tCu, value: `${cu.toFixed(3)} %` },
                  { label: t.tMo, value: `${moOf(m, e).toFixed(4)} %` },
                  { label: t.tShare, value: `${((kt / tot) * 100).toFixed(1)} %` },
                ],
              })
            }
            onMouseMove={(ev) => setTip((prev) => (prev ? { ...prev, x: ev.clientX, y: ev.clientY } : prev))}
            onMouseLeave={() => setTip(null)}
          >
            <span className="bl">{e}</span>
            <span className="bwrap">
              {/* Тоо нь баганын УРД ҮЗҮҮРТ. Өмнө нь баганын ДОТОР, суурь
                  талд нь бичигдээд, 26 %-аас богино багана дээр огт
                  харагддаггүй байв — жижиг түвшнүүд тоогүй үлддэг.
                  Хамгийн урт баганад ч тоо гадна талдаа багтахаар `.bwrap`
                  баруун талдаа тогтмол зай үлдээнэ (globals.css). */}
              {/* Бүх багана НЭГ өнгөтэй (--bench) — агуулгаар өнгөлөхөө больсон */}
              <i style={{ width: `${w.toFixed(1)}%`, ["--c" as any]: "var(--bench)" }}>
                <b>{fmt(kt, 0)}</b>
              </i>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ==========================================================================
   Түвшин бүрийн нөөц ба хүдэр — шугаман чарт.
   --------------------------------------------------------------------------
   «Уулын цул» цуврал ХАСАГДСАН: тэр нь мян.м³ бөгөөд бусад хоёр нь
   мян.тн — өөр нэгжийг нэг тэнхлэгт тавих нь буруу байв. Одоо хоёулаа
   мян.тн тул хэмжээгээр нь шууд харьцуулна.
   ========================================================================== */
const BSERIES: { ci: number; c: string; nm: [string, string]; u: "kt" | "m3" }[] = [
  /* Улаан — цуврал өнгө биш тогтмол утга, «Нийт хүдэр»-ээс тод ялгарна */
  { ci: C.NOOC, c: "#a7ecd9", nm: ["Олборлосон нөөц", "Mined reserve"], u: "kt" },
  { ci: C.NIIT, c: "var(--s1)", nm: ["Нийт хүдэр", "Total ore"], u: "kt" },
];

/* Catmull-Rom сплайныг куб Безье болгож, шулуун холбоосыг гөлгөр муруй
   болгоно. Хяналтын цэгийн Y-г хөрш ХОЁР цэгийн хооронд хязгаарлав:
   энгийн Catmull-Rom нь өгөгдөлд БАЙХГҮЙ оргил, хотгор үүсгэдэг — нөөцийн
   утга 0 хүртэл унасан газар муруй нь тэнхлэгээс доош гарч, байхгүй
   сөрөг утга харуулж мэдэх юм. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  const clamp = (v: number, a: number, b: number) =>
    Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i], p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6, p1[1], p2[1]);
    const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6, p1[1], p2[1]);
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)}`
       + ` ${c2x.toFixed(2)},${c2y.toFixed(2)}`
       + ` ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

/* SVG-ийн градиентийн id нь хуудсан дээр давтагдахгүй байх ёстой.
   React-ийн `useId` нь «:» тэмдэгт агуулдаг тул `url(#…)`-д ашиглахын
   өмнө цэвэрлэнэ. */
function useSvgId(prefix: string): string {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

/* ==========================================================================
   Түвшин бүрийн нөөц ба хүдэр — БАГАНА + ШУГАМ.
   --------------------------------------------------------------------------
   Хоёр шугам бараг давхцаж, ялгаа нь уншигддаггүй байв. Одоо «Нийт
   хүдэр» нь градиент багана (үзүүр нь тод, суурь руугаа бүдгэрнэ), харин
   «Олборлосон нөөц» нь дээр нь давхарласан шугам. Хоёр цуврал нэг
   нэгжтэй (мян.тн) тул нэг тэнхлэгт сууна. Шугам баганын оройтой
   давхцвал тухайн түвшний хүдэр бүхэлдээ нөөц; доор нь зай үлдвэл
   нөөцөөс гадуурх хүдэр.
   ========================================================================== */
/** SVG-ийн бодит пикселийн хэмжээ. viewBox-ыг үүнтэй тэнцүүлснээр чарт
 *  панелийнхаа өндрөөр сунахад бичвэр, зураас гажихгүй. Callback ref тул
 *  SVG хожим (өгөгдөл ирсний дараа) гарч ирсэн ч ажиглана. */
function usePlotSize(fallback: { width: number; height: number }) {
  const [size, setSize] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((svg: SVGSVGElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!svg) return;
    const update = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((previous) => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    observer.current = new ResizeObserver(([entry]) => update(entry.contentRect.width, entry.contentRect.height));
    observer.current.observe(svg);
    const bounds = svg.getBoundingClientRect();
    update(bounds.width, bounds.height);
  }, []);
  return [ref, size] as const;
}

export function BenchLine() {
  const { m, t, lang, sel, setTip } = useStore();
  const li = lang === "mn" ? 0 : 1;
  const gid = useSvgId("bl");
  /* Панел баганын үлдсэн өндрийг дүүргэж сунана (globals.css .lsvg) */
  const [plotRef, plot] = usePlotSize({ width: 320, height: 140 });
  const act = ELEV.filter((e) => BSERIES.some((s2) => sumCol(m, s2.ci, e)));
  const W = plot.width, H = plot.height, PL = 42, PR = 12, PT = 14, PB = 22;
  if (act.length < 2) return <div className="empty">{t.noData}</div>;

  const [line, bar] = BSERIES;
  const vals = BSERIES.map((s2) => act.map((e) => sumCol(m, s2.ci, e)));
  const [lineV, barV] = vals;
  const mx = Math.max(...vals.flat(), 1);
  const step = Math.pow(10, Math.floor(Math.log10(mx))) / 2;
  const top = Math.ceil(mx / step) * step;
  /* Баганын тэнхлэг: түвшин бүр тэнцүү өргөнтэй зурвас эзэлж, шугам нь
     зурвасын голоор дамжина. */
  const band = (W - PL - PR) / act.length;
  const bw = Math.min(14, band * 0.56);
  const x = (i: number) => PL + (i + 0.5) * band;
  const y = (v: number) => PT + (1 - v / top) * (H - PT - PB);
  const base = y(0);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const pick = sel?.kind === "bench" ? sel.tuv : undefined;
  const pickIndex = pick === undefined ? -1 : act.indexOf(pick);
  // Keep enlarged axis labels clear of the selected bench label.
  const labelGap = 34;
  const labelStep = Math.max(1, Math.ceil(labelGap / band));
  const showLevelLabel = (i: number) => i === pickIndex ||
    (i % labelStep === 0 && (pickIndex < 0 || Math.abs(i - pickIndex) * band >= labelGap));
  const peak = barV.indexOf(Math.max(...barV));
  /* Шошго нь зөвхөн тодруулах нэг баганад: сонгосон түвшин, эсвэл
     сонголтгүй үед хамгийн их хүдэртэй түвшин. */
  const labelAt = pickIndex >= 0 ? pickIndex : peak;

  return (
    <div className="lchart">
      <div className="legend2">
        <span><i className="sw-bar" style={{ ["--c" as any]: bar.c }} />{bar.nm[li]}</span>
        <span><i className="sw-line" style={{ ["--c" as any]: line.c }} />{line.nm[li]}</span>
      </div>
      <svg ref={plotRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="lsvg">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: bar.c, stopOpacity: 0.95 }} />
            <stop offset="1" style={{ stopColor: bar.c, stopOpacity: 0.06 }} />
          </linearGradient>
        </defs>
        {ticks.map((v, k) => (
          <g key={k}>
            {k > 0 && <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="lgrid" />}
            <text x={PL - 4} y={y(v) + 4} className="ltxt" textAnchor="end">{v === 0 ? "0" : fmt(v, 0)}</text>
          </g>
        ))}
        {act.map((e, i) => {
          const dim = pick !== undefined && pick !== e;
          const h = Math.max(base - y(barV[i]), barV[i] > 0 ? 1.5 : 0);
          return (
            <g key={`b${e}`} className={"lbar" + (dim ? " dim" : "")}>
              <rect x={x(i) - bw / 2} y={base - h} width={bw} height={h} fill={`url(#${gid})`} />
              <rect x={x(i) - bw / 2} y={base - h} width={bw} height={1.4} style={{ fill: bar.c }} />
            </g>
          );
        })}
        <path className="lline" fill="none" stroke={line.c} strokeWidth={1.5}
              strokeLinecap="round" strokeLinejoin="round" style={{ color: line.c }}
              d={smoothPath(act.map((e, i) => [x(i), y(lineV[i])] as [number, number]))} />
        {act.map((e, i) => (
          <circle key={`p${e}`} cx={x(i)} cy={y(lineV[i])} r={1.9} className="ldot" style={{ stroke: line.c }} />
        ))}
        <text x={x(labelAt)} y={y(Math.max(barV[labelAt], lineV[labelAt])) - 4} className="lpeak" textAnchor="middle">
          {fmt(barV[labelAt], 0)}
        </text>
        {act.map((e, i) => (
          <text key={e} x={x(i)} y={H - 8} className={"ltxt" + (e === pick ? " on" : "")} textAnchor="middle">
            {showLevelLabel(i) ? e : ""}
          </text>
        ))}
        {act.map((e, i) => (
          <rect key={`h${e}`} x={x(i) - band / 2} y={0} width={band} height={H} fill="transparent"
                onMouseEnter={(ev) => setTip({
                  x: ev.clientX, y: ev.clientY, title: `${t.dBench} ${e} м`,
                  rows: BSERIES.map((s2, k) => ({
                    label: s2.nm[li],
                    value: `${fmt(vals[k][i], 0)} ${s2.u === "kt" ? t.uKt : t.uM3}`,
                    color: s2.c,
                  })),
                })}
                onMouseMove={(ev) => setTip((pv) => (pv ? { ...pv, x: ev.clientX, y: ev.clientY } : pv))}
                onMouseLeave={() => setTip(null)} />
        ))}
      </svg>
    </div>
  );
}

/* --------------------------------------------------- дэлгэрэнгүй карт */
export function DetailCard() {
  const { m, t, sel, blk } = useStore();

  if (!sel) {
    return (
      <div className="pb">
        <div className="empty">{t.emptyMsg}</div>
      </div>
    );
  }

  if (sel.kind === "bench") {
    return <BenchDetail key={`${m}:${sel.tuv}:${blk ?? ""}`} level={sel.tuv} />;
  }

  /* Газрын зураг дээрх блок — Micromine-ийн бүх талбар бүлгээр */
  if (sel.kind === "block") {
    return (
      <div className="pb">
        <div className="bdet">
          <header className="bdet-head">
            <i style={{ background: sel.color }} aria-hidden="true" />
            <div><b>{sel.title}</b><small>{sel.sub}</small></div>
          </header>
          {sel.groups.map((g) => (
            <section key={g.title}>
              <h4>{g.title}</h4>
              <dl>
                {g.rows.map((r) => (
                  <div key={r.label}>
                    <dt>{r.label}{r.code && <small>{r.code}</small>}</dt>
                    <dd>{r.color && <i style={{ background: r.color }} aria-hidden="true" />}{r.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    );
  }

  const ci = sel.ci;
  const isM3 = ci === C.HOOSON || ci === C.TSUL;
  const rows = ELEV.map((e) => [e, sumCol(m, ci, e), metalSum(m, "cu", ci, e), metalSum(m, "mo", ci, e)] as const)
    .filter((r) => r[1] > 0);
  const tot = rows.reduce((a, r) => a + r[1], 0);

  return (
    <div className="pb">
        <div className="dtable">
          {!rows.length ? (
            <div className="empty">{t.noData}</div>
          ) : (
            <table>
              <thead>
                <tr><th>{t.thLvl}</th><th>{isM3 ? t.uM3 : t.thKt}</th><th>{t.thCu}</th><th>{t.thMo}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r[0]}>
                    <td className="mono" style={{ color: "var(--ink)" }}>{r[0]} м</td>
                    <td className="mono">{fmt(r[1], 1)}</td>
                    <td className={"mono" + (r[2] ? "" : " zero")}>{r[2] ? r[2].toFixed(3) : "—"}</td>
                    <td className={"mono" + (r[3] ? "" : " zero")}>{r[3] ? r[3].toFixed(4) : "—"}</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td>{t.thTot}</td><td className="mono">{fmt(tot, 1)}</td><td /><td />
                </tr>
              </tbody>
            </table>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------ сарын шилжилт (зүүн багана)
   Өмнө нь доод талд 880 px өргөн SVG байсан. Зүүн баганад (252 px) багтахын
   тулд сар бүрийг ХЭВТЭЭ мөр болгосон — дээрх түвшний рейлтэй ижил хэмнэл:
   шошго · багана · тоо. Уншихад ч, харьцуулахад ч илүү тод. */
export function DestChart() {
  return <DestinationBreakdown />;
}

export function Timeline() {
  const { m, setM, t, lang, setTip } = useStore();
  const cols = ["var(--s1)", "var(--s2)", "var(--s3)"];
  const names = [t.sBu, t.sOv, t.sOv2];
  const tuv = useTuv();
  const data = [1, 2, 3, 4, 5, 6].map((mm) => monthlyFlow(mm, tuv));
  const totals = data.map((d) => d[0] + d[1] + d[2]);

  /* ХЭМЖҮҮР: өмнө нь баганын урт хамгийн их сарын харьцаагаар тооцогдож
     байсан. Зургаан сарын дүн 4 898–5 488 буюу 11 %-ийн дотор багтдаг тул
     бүх багана бараг ижил урттай гарч, харьцуулах утгагүй болдог байв.
     Одоо 0-ээс эхэлсэн ТОГТМОЛ шатлалт хэмжүүр дээр зурж, хажууд нь
     хуваарийн зураас тавьснаар зөрүү нь хаанаас гарч байгаа нь уншигдана. */
  const STEP = 2000;
  const axMax = Math.ceil(Math.max(...totals, 1) / STEP) * STEP;
  const ticks = Array.from({ length: axMax / STEP + 1 }, (_, k) => k * STEP);


  return (
    <>
      {/* хуваарь */}
      <div className="tlax">
        <span className="ml" />
        <span className="tlticks">
          {ticks.map((v, k) => (
            <b key={v} style={{ left: `${(v / axMax) * 100}%` }}
               className={k === 0 ? "first" : k === ticks.length - 1 ? "last" : ""}>
              {/* `fmt` нь 0-ийг «—» болгодог тул тэгийг шууд бичнэ */}
              {v === 0 ? "0" : fmt(v, 0)}
            </b>
          ))}
        </span>
        <span className="tlu">{t.uKt}</span>
      </div>

      <div className="mrows">
        {data.map((d, i) => {
          const sel = i + 1 === m;
          const tot = totals[i];
          return (
            <button key={i} className="mrow" aria-pressed={sel}
                    onClick={() => setM(i + 1)}
                    onMouseEnter={(ev) => setTip({
                      x: ev.clientX, y: ev.clientY, title: MON_L[lang][i], unit: t.uKt,
                      rows: [
                        ...names.map((n, k) => ({
                          label: n,
                          value: fmt(d[k], 0),
                          pct: (d[k] / (tot || 1)) * 100,
                          color: cols[k],
                        })),
                        { label: t.thTot, value: fmt(tot, 0), total: true },
                      ],
                    })}
                    onMouseMove={(ev) => setTip((p) => (p ? { ...p, x: ev.clientX, y: ev.clientY } : p))}
                    onMouseLeave={() => setTip(null)}>
              <span className="ml">{ROMAN[i]}</span>
              <span className="mtrack">
                <span className="mbar" style={{ width: `${((tot / axMax) * 100).toFixed(2)}%` }}>
                  {d.map((v, k) => (
                    /* Тэг утгыг ОГТ зурахгүй: тойрогтой болсон тул тэг ч
                       гэсэн 2 px-ийн хүрээ болж харагдаж мэдэх юм. */
                    v > 0 ? <i key={k} style={{ flex: `${v} 0 0`, ["--c" as any]: cols[k] }} /> : null
                  ))}
                </span>
              </span>
              <span className="mv">{fmt(tot, 0)}</span>
            </button>
          );
        })}
      </div>

    </>
  );
}

/* ==========================================================================
   Хоёр цуврал зэрэгцүүлсэн багана
   --------------------------------------------------------------------------
   Cu (0.4 %) ба Mo (0.01 %) хоёр 40 дахин ялгаатай тул НЭГ тэнхлэгт
   тавьж болохгүй — Mo огт харагдахгүй болно. Тиймээс цуврал тус бүр
   өөрийн масштабтай, зэрэгцээ хоёр багана болгон зурав. Утга бүр нь
   тоогоороо бичигдсэн тул харьцуулалт эндүүрэхгүй.
   ========================================================================== */
/* ==========================================================================
   Хоёр үзүүлэлтийг САРААР харуулах ТАЛБАЙН чарт.
   --------------------------------------------------------------------------
   Хос хэвтээ багана байсныг сольсон: сар хоорондын өөрчлөлт баганаар
   харьцуулагдахгүй байв.

   Хоёр цувралыг НЭГ тэнхлэгт тавихгүй — Cu 0.41 %, Mo 0.014 % шиг хэмжээ
   нь 30 дахин зөрөх тул нэг нь шугам болж хавтгайрна. Тус бүр нь ӨӨРИЙН
   гэсэн жижиг чартатай.

   Тэнхлэг нь 0-ээс биш, цувралын доод утгаас эхэлнэ (Cu 0.410–0.422 гэх
   мэт бага хэлбэлзлийг 0-ээс зурвал шулуун шугам болно). Тасалсныг
   мэдэгдэхийн тулд дээд, доод утгыг ЗААВАЛ бичнэ. */
/* ==========================================================================
   НЭГ үзүүлэлтийн талбайн чарт, сараар.
   --------------------------------------------------------------------------
   Урьд нь нэг панелд хоёр чарт зэрэгцүүлж байсныг САЛГАВ — үзүүлэлт бүр
   өөрийн панелтай. Ингэснээр чарт өргөсөж, сарын хэлбэлзэл тод уншигдана.

   Тэнхлэг 0-ээс биш цувралын доод утгаас эхэлнэ (Cu 0.410–0.422-ыг 0-ээс
   зурвал шулуун шугам болно). Тасалсныг мэдэгдэхийн тулд доод, дээд
   утгыг заавал бичнэ.
   ========================================================================== */
function AreaOne({
  rows, label, dec, color, unit,
}: {
  rows: { key: string; v: number }[];
  label: string; dec: number; color: string; unit: string;
}) {
  const { setTip, lang, m } = useStore();
  const gid = useSvgId("ar");
  const [plotRef, plotSize] = usePlotSize({ width: 300, height: 120 });
  const v = rows.map((r) => r.v);
  /* Шошго нь зөвхөн сонгосон сар ба оргил цэгт — зургаан тоо зэрэг
     бичигдэхэд нүд аль нэгэнд нь ч тогтдоггүй байв. Бусад утгыг
     доод/дээд хязгаар болон tooltip-оос уншина. */
  const cur = m - 1;
  const peak = v.indexOf(Math.max(...v));
  const lo = Math.min(...v), hi = Math.max(...v);
  const pad = (hi - lo) * 0.18 || Math.abs(hi) * 0.08 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  /* Цэг бүрийн утгыг ШОШГООР бичнэ — дүүжлэхгүйгээр уншигдана.
     Дээд талд нь бичих зай гаргахын тулд PT-г томсгов. */
  const W = plotSize.width, H = plotSize.height, PB = 30, PT = 22;
  const x = (i: number) => (i / (rows.length - 1)) * W;
  const y = (t2: number) => PT + (1 - (t2 - y0) / (y1 - y0)) * (H - PT - PB);
  // The 9px monospace labels need room at the chart edges on narrow panels.
  const labelBounds = (i: number) => {
    const width = v[i].toFixed(dec).length * 5.4;
    const left = x(i) - (i === 0 ? 0 : i === rows.length - 1 ? width : width / 2);
    return { left, right: left + width };
  };
  const currentLabel = labelBounds(cur), peakLabel = labelBounds(peak);
  const labelsOverlap = Math.abs(y(v[cur]) - y(v[peak])) < 14 &&
    currentLabel.left < peakLabel.right + 4 && peakLabel.left < currentLabel.right + 4;
  const labelled = new Set(lo === hi || labelsOverlap ? [cur] : [cur, peak]);
  /* Гөлгөр муруй. Талбай нь мөн ТЭР МУРУЙГ дагана: шугам гөлгөр, дүүргэлт
     нь өнцөгтэй үлдвэл хоёр нь салж, доод захаараа зай үүсгэнэ. */
  const pts = rows.map((r, i) => [x(i), y(v[i])] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L${W},${H - PB} L0,${H - PB} Z`;

  return (
    <div className="acell">
      <div className="ahead" style={{ color }}>{label}</div>
      <svg ref={plotRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="asvg">
        {/* Талбай нь шугамын доор тод, суурь руугаа бүрэн тунгалаг болж
            дэвсгэрт уусна. */}
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: color, stopOpacity: 0.42 }} />
            <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {[0.33, 0.66].map((f) => (
          <line key={f} x1={0} x2={W} y1={PT + f * (H - PT - PB)} y2={PT + f * (H - PT - PB)} className="lgrid" />
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <line x1={0} x2={W} y1={H - PB} y2={H - PB} className="abase" />
        {rows.map((r, i) => (
          <g key={"axis" + r.key} aria-label={MON_L[lang][i]}>
            <line x1={x(i)} x2={x(i)} y1={H - PB} y2={H - PB + 4} className="abase" />
            <text x={x(i)} y={H - 10} className={"axlabel" + (i === cur ? " on" : "")}
                  textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}>
              {i + 1}
            </text>
          </g>
        ))}
        <path className="lline" d={line} fill="none" stroke={color} strokeWidth={1.6}
              strokeLinecap="round" strokeLinejoin="round" style={{ color }} />
        <line x1={x(cur)} x2={x(cur)} y1={y(v[cur])} y2={H - PB} className="acur" style={{ stroke: color }} />
        {rows.map((r, i) => (
          <circle key={r.key} cx={x(i)} cy={y(v[i])} r={i === cur ? 3 : 1.9}
                  className={"ldot" + (i === cur ? " on" : "")} style={{ stroke: color, ["--c" as any]: color }} />
        ))}
        {rows.map((r, i) => labelled.has(i) ? (
          <text key={"v" + r.key} x={x(i)} y={y(v[i]) - 6} className={"avlab" + (i === cur ? " on" : "")}
                textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}>
            {v[i].toFixed(dec)}
          </text>
        ) : null)}
        {rows.map((r, i) => (
          <rect key={"h" + r.key} x={i === 0 ? 0 : (x(i - 1) + x(i)) / 2} y={0}
                width={W / (rows.length - 1) * (i === 0 || i === rows.length - 1 ? 0.5 : 1)} height={H} fill="transparent"
                onMouseEnter={(ev) => setTip({
                  x: ev.clientX, y: ev.clientY, title: MON_L[lang][i],
                  rows: [{ label, value: `${v[i].toFixed(dec)} ${unit}`, color }],
                })}
                onMouseMove={(ev) => setTip((pv) => (pv ? { ...pv, x: ev.clientX, y: ev.clientY } : pv))}
                onMouseLeave={() => setTip(null)} />
        ))}
      </svg>
    </div>
  );
}

const MONTHS = [1, 2, 3, 4, 5, 6];

/* ==========================================================================
   Элемент тус бүрийн панел — АГУУЛГА ⇄ МЕТАЛЛ солигдоно.
   --------------------------------------------------------------------------
   Урьд нь Cu%, Mo%, Cuт, Moт гэсэн ДӨРВӨН панел байсныг ХОЁР болгов:
   Cu-гийн панел дотроос агуулга/металлыг сольж хардаг, Mo мөн адил.
   Хоёр хэмжигдэхүүнийг ДАВХАРЛАХГҮЙ — Cu 0.41 % ба 12 986 т нь 30 000
   дахин зөрөх тул нэг тэнхлэгт багтахгүй. Оронд нь ээлжлүүлнэ.
   Панел өөрийн толгойг өөрөө зурна (гарчиг нь сонголтоор өөрчлөгдөнө).
   ========================================================================== */
export function ElementPanel() {
  const { t } = useStore();
  const tuv = useTuv();
  /* Cu ба Mo НЭГ панелд — элементийг зүүн талын товчоор, агуулга ⇄
     металлыг баруун талын товчоор сольно. */
  const [el, setEl] = useState<"cu" | "mo">("cu");
  const [mode, setMode] = useState<"grade" | "metal">("grade");
  const isCu = el === "cu";

  const rows = MONTHS.map((mm) => ({
    key: ROMAN[mm - 1],
    v: mode === "grade"
      ? (isCu ? cuOf(mm, tuv) : moOf(mm, tuv))
      : metalSum(mm, isCu ? "cut" : "mot", C.NIIT, tuv),
  }));

  const label = `${isCu ? "Cu" : "Mo"} ${mode === "grade" ? "%" : t.uT}`;
  const dec = mode === "grade" ? (isCu ? 3 : 4) : 0;
  const what = (mode === "grade" ? t.mGrade : t.mMetal).toLowerCase();

  return (
    <div className="panel element-panel">
      <div className="ph">
        <div className="seg sm eltab" role="group">
          <button aria-pressed={isCu} onClick={() => setEl("cu")}>Cu {what}</button>
          <button aria-pressed={!isCu} onClick={() => setEl("mo")}>Mo {what}</button>
        </div>
        <div className="seg sm" role="group" style={{ marginLeft: "auto" }}>
          <button aria-pressed={mode === "grade"} onClick={() => setMode("grade")}>{t.mGrade}</button>
          <button aria-pressed={mode === "metal"} onClick={() => setMode("metal")}>{t.mMetal}</button>
        </div>
      </div>
      <div className="pb tight">
        <AreaOne rows={rows} label={label} unit={mode === "grade" ? "%" : t.uT}
                 dec={dec} color={isCu ? "var(--g5)" : "var(--s3)"} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ tooltip */
export function Tooltip() {
  const { tip } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useEffect(() => {
    if (!tip || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let x = tip.x + 14, y = tip.y + 14;
    if (x + r.width > window.innerWidth - 8) x = tip.x - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = tip.y - r.height - 14;
    setPos({ left: x, top: y });
  }, [tip]);

  return (
    <div id="tip" ref={ref} role="status" aria-live="polite"
         style={{ opacity: tip ? 1 : 0, left: pos.left, top: pos.top }}>
      {tip && (
        <>
          <span className="tt">
            {tip.title}
            {tip.unit && <small>{tip.unit}</small>}
          </span>
          {tip.key && <span className="tk">{tip.key}</span>}
          {tip.rows.some((r) => r.pct != null) ? (
            /* Хувьтай хувилбар: шошго · утга · хувь */
            <div className="tshare">
              {tip.rows.map((r, i) => (
                <div className={"srow" + (r.total ? " tot" : "")} key={i}>
                  <span className="sl">
                    {r.color && <i style={{ background: r.color }} />}
                    {r.label}
                  </span>
                  <b>{r.value}</b>
                  <em>{r.pct != null ? `${r.pct.toFixed(0)} %` : ""}</em>
                </div>
              ))}
            </div>
          ) : tip.rows.map((r, i) => (
            <div className="row" key={i}>
              <span>
                {r.color && <i style={{ background: r.color }} />}
                {r.label}
              </span>
              <b>{r.value}</b>
            </div>
          ))}
          {tip.hint && <span className="hintline">{tip.hint}</span>}
        </>
      )}
    </div>
  );
}
