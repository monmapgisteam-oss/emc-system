"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { MON_L, ROMAN } from "@/lib/i18n";
import { BenchLine, BenchRail, DestChart, DetailCard, ElementPanel, Kpis,
         Timeline, Tooltip } from "./Panels";

/* ArcGIS Maps SDK бол бүхэлдээ browser талын сан — SSR-ээс салгана.
   Түр орлуулагч нь MineScene-тэй ЯГ ИЖИЛ бүтэцтэй байх ёстой: эс тэгвэл
   .mapwrap-ийн өндөр яг SceneView үүсэх агшинд өөрчлөгдөж, зураг
   панелаа дүүргэхгүй үлддэг. Толгой (.ph) хасагдсан — товчнууд нь
   газрын зургийн зүүн дээд буланд орсон. */
const MineScene = dynamic(() => import("./MineScene"), {
  ssr: false,
  loading: () => (
    <div className="mapwrap">
      <div className="loading"><span className="spin" /><span>ArcGIS…</span></div>
    </div>
  ),
});

export default function Shell() {
  const { m, setM, setLang, lang, t, clearAll, theme, setTheme,
          mapMax, setMapMax } = useStore();

  /* Өнгөний горимын товч: «auto» үед системийн тохиргоог дагана */
  const [sysDark, setSysDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSysDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const isDark = theme === "dark" || (theme === "auto" && sysDark);

  /* Хажуугийн баганын өргөн — чирж өөрчилнө. Сонголт нь localStorage-д
     хадгалагдана. Дундах багана (газрын зураг) үлдсэн зайг эзэлнэ. */
  const [colL, setColL] = useState(350);
  const [colR, setColR] = useState(376);
  useEffect(() => {
    const l = +(localStorage.getItem("emc-col-l") || 0);
    const r = +(localStorage.getItem("emc-col-r") || 0);
    if (l >= 240) setColL(Math.min(l, 620));
    if (r >= 240) setColR(Math.min(r, 620));
  }, []);

  function startDrag(e: React.PointerEvent, side: "L" | "R") {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = side === "L" ? colL : colR;
    const move = (ev: PointerEvent) => {
      const d = side === "L" ? ev.clientX - x0 : x0 - ev.clientX;
      const w = Math.max(240, Math.min(620, w0 + d));
      if (side === "L") setColL(w); else setColR(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dragging");
      /* Хадгалалт нь move бүрт биш, чирч дуусахад */
      const cur = side === "L" ? "emc-col-l" : "emc-col-r";
      localStorage.setItem(cur, String(side === "L" ? colLRef.current : colRRef.current));
    };
    document.body.classList.add("dragging");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const colLRef = useRef(colL); colLRef.current = colL;
  const colRRef = useRef(colR); colRRef.current = colR;

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* Esc: эхлээд дэлгэц дүүрэн горимоос гарна, дараа нь шүүлт цуцална —
         хоёуланг нь нэг дарахад хийвэл газрын зургаас гарангуутаа
         сонголтоо ч алдчихдаг байх байв. */
      if (e.key === "Escape") {
        if (mapMax) setMapMax(false); else clearAll();
      }
      if (e.key === "ArrowLeft" && m > 1) setM(m - 1);
      if (e.key === "ArrowRight" && m < 6) setM(m + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [m, setM, clearAll, mapMax, setMapMax]);


  return (
    <div className="app">
      {/* ---------------------------------------------------------- толгой */}
      <header className="head">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo" src="/logo.svg" alt="Erdenet Mining Corporation" />
          <b>{t.appName}</b>
        </div>

        <div className="hspacer" />

        {/* Сарын шүүлт — ArcGIS Dashboards-ийн толгойн сонгогч шиг доош
            нээгддэг жагсаалт. Бүх KPI, чарт, газрын зураг энэ сараар
            шинэчлэгдэнэ; ← / → товчоор ч солигдоно. */}
        <MonthSelect label={t.lMonth} value={m} onChange={setM}
                     options={MON_L[lang].map((n, i) => ({ v: i + 1, n, k: ROMAN[i] }))} />

        {/* Ганц товч — шилжих горимынхоо дүрсийг харуулна:
            харанхуйд нар (→ өдөр), цайварт сар (→ шөнө) */}
        <button className="themebtn" onClick={() => setTheme(isDark ? "light" : "dark")}
                title={isDark ? t.thLight : t.thDark} aria-label={t.thTheme}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {isDark ? (
              <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
              </>
            ) : (
              <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
            )}
          </svg>
        </button>
        {/* Хэлний ганц товч — горимын товчтой адил ШИЛЖИХ хэлээ харуулна */}
        <button className="themebtn langbtn" onClick={() => setLang(lang === "mn" ? "en" : "mn")}
                title={lang === "mn" ? "English" : "Монгол"}
                aria-label={lang === "mn" ? "Switch to English" : "Монгол хэл рүү шилжих"}>
          {lang === "mn" ? "EN" : "МН"}
        </button>
      </header>

      {/* ------------------------------------------------------------ гол */}
      <div className="main" style={{ gridTemplateColumns: `${colL}px 6px minmax(0,1fr) 6px ${colR}px` }}>
        <div className="col scroll">
          {/* `flex:1` байсан нь хаялбар цөөн үед панелийн доор том хоосон
              зай үлдээж байв. Одоо агуулгаараа багтана, шаардвал агшина. */}
          <div className="panel" style={{ flex: "0 1 auto" }}>
            <div className="ph">
              <h2>{t.pBench}</h2>
            </div>
            <div className="pb tight"><BenchRail /></div>
          </div>

          {/* Түвшний дэлгэрэнгүй карт — хаялбарын жагсаалтын ЯГ доор,
              нэг сэдвийн хоёр харагдац зэрэгцэнэ. */}
          <div className="panel grow">
            <div className="ph">
              <DetailCardTitle />
            </div>
            <DetailBody />
          </div>
        </div>

        <div className="split" onPointerDown={(e) => startDrag(e, "L")} />

        <div className="col">
          <Kpis />
          {/* `maxed` үед панел нь grid-ээс салж бүх цонхыг эзэлнэ.
              ArcGIS SceneView контейнерийнхээ хэмжээг ажигладаг тул
              гараар resize дуудах шаардлагагүй. */}
          <div className={"panel map" + (mapMax ? " maxed" : "")} style={{ flex: 1 }}>
            <MineScene />
          </div>
        </div>

        <div className="split" onPointerDown={(e) => startDrag(e, "R")} />

        {/* Баруун багана нь багтахгүй болоход бүхэлдээ гүйлгэгдэнэ —
            эс тэгвэл доод талын түвшний карт шахагдаж алга болдог. */}
        <div className="col scroll">
          <div className="panel" style={{ flex: "none" }}>
            <div className="ph"><h2>{t.tlTitle}</h2></div>
            <div className="pb tight"><Timeline /></div>
          </div>
          <div className="panel" style={{ flex: "none" }}>
            <div className="ph"><h2>{t.chDest}</h2></div>
            <div className="pb tight"><DestChart /></div>
          </div>
          {/* Энэ ба Cu/Mo панел баганын үлдсэн өндрийг хуваан дүүргэнэ —
              том дэлгэцэнд доор хоосон зай үлдэхгүй */}
          <div className="panel fill">
            <div className="ph"><h2>{t.chBench2}</h2></div>
            <div className="pb tight"><BenchLine /></div>
          </div>
          {/* Cu, Mo НЭГ панелд — элемент ба агуулга ⇄ металлыг дотроос нь солино */}
          <ElementPanel />
        </div>
      </div>

      <Tooltip />
    </div>
  );
}

/** ArcGIS Dashboards-ийн толгойн «category selector» — товч дээр шошго ба
 *  сонгосон утга, дарахад доор нь радио жагсаалт. Гадна дарах, Esc-ээр хаагдана. */
function MonthSelect({ label, value, options, onChange }: {
  label: string; value: number;
  options: { v: number; n: string; k: string }[];
  onChange: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc, true); };
  }, [open]);
  const cur = options.find((o) => o.v === value);
  return (
    <div className="dsel" ref={ref}>
      <button className="dsel-btn" aria-haspopup="listbox" aria-expanded={open}
              onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" />
        </svg>
        <span className="dsel-l">{label}</span>
        <b>{cur?.n ?? "—"}</b>
        <svg className="dsel-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <ul className="dsel-pop" role="listbox" aria-label={label}>
          {options.map((o) => (
            <li key={o.v} role="option" aria-selected={o.v === value}
                onClick={() => { onChange(o.v); setOpen(false); }}>
              <i aria-hidden="true" />
              <span>{o.n}</span>
              <small>{o.k}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* DetailCard нь гарчиг + бие хоёрыг хамт буцаадаг тул хуваая */
function DetailCardTitle() {
  const { sel, t } = useStore();
  if (!sel) return <h2>{t.dBench}</h2>;
  if (sel.kind === "bench") return <h2>{`${t.dBench} ${sel.tuv} м`}</h2>;
  if (sel.kind === "block") return <h2>{t.blkTitle}</h2>;
  return <h2>{sel.title}</h2>;
}

function DetailBody() {
  return <DetailCard />;
}
