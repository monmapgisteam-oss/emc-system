"use client";

import { createContext, useContext, useEffect, useMemo, useState,
         type Dispatch, type ReactNode, type SetStateAction } from "react";
import { T, type Lang, type Dict } from "./i18n";
import type { BlockDetail } from "./blockModel";

/** Баруун талын картад юу харуулах вэ */
export type Selection =
  | { kind: "bench"; tuv: number }
  | { kind: "dest"; ci: number; title: string; featName: string }
  | ({ kind: "block" } & BlockDetail)
  | null;

export interface TipRow {
  label: string;
  value: string;
  color?: string | null;
  /** Нийтэд эзлэх хувь (0–100) — өгвөл тусдаа баганад */
  pct?: number;
  /** Дүнгийн мөр — дээрээс зураасаар тусгаарлагдана */
  total?: boolean;
}
export interface TipState {
  x: number;
  y: number;
  title: string;
  key?: string;
  rows: TipRow[];
  hint?: string;
  /** Утгуудын нэгж — толгойн баруун талд нэг удаа бичигдэнэ */
  unit?: string;
}

/** «auto» = үйлдлийн системийн тохиргоог дагана */
export type Theme = "auto" | "light" | "dark";

interface Store {
  m: number;
  setM: (m: number) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  sel: Selection;
  setSel: Dispatch<SetStateAction<Selection>>;
  blk: string | null;
  setBlk: (b: string | null) => void;
  /* ArcGIS Dashboard-ийн зарчим: сонгогдсон элемент дээр ДАХИН дарахад
     шүүлт цуцлагдана. Тиймээс бүх шүүлтийн эх сурвалж «toggle» хэлбэртэй. */
  toggleBench: (tuv: number) => void;
  toggleDest: (d: { ci: number; title: string; featName: string }) => void;
  /** Бүх идэвхтэй шүүлтийг нэг дор цуцална (Esc товч ч үүнийг дуудна) */
  clearAll: () => void;
  /** Газрын зураг дангаараа дэлгэц дүүрэн эсэх */
  mapMax: boolean;
  setMapMax: (v: boolean) => void;
  tip: TipState | null;
  setTip: Dispatch<SetStateAction<TipState | null>>;
  t: Dict;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [m, setMRaw] = useState(1);
  const [lang, setLang] = useState<Lang>("mn");
  const [sel, setSel] = useState<Selection>(null);
  const [blk, setBlk] = useState<string | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");
  const [mapMax, setMapMax] = useState(false);

  /* Хадгалсан сонголтыг сэргээнэ. Серверийн рендэрт localStorage
     байхгүй тул зөвхөн монтлогдсоны дараа уншина. */
  useEffect(() => {
    const v = localStorage.getItem("emc-theme");
    if (v === "light" || v === "dark") setTheme(v);
  }, []);

  /* `data-theme` нь app/globals.css дахь :root[data-theme=...]-ыг асаана.
     «auto» үед атрибутыг ХАСНА — тэгвэл prefers-color-scheme дагана. */
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "auto") {
      el.removeAttribute("data-theme");
      localStorage.removeItem("emc-theme");
    } else {
      el.setAttribute("data-theme", theme);
      localStorage.setItem("emc-theme", theme);
    }
    /* ArcGIS-ийн симболууд өнгөө үүсэх үедээ авдаг тул мэдэгдэнэ */
    window.dispatchEvent(new CustomEvent("emc-theme"));
  }, [theme]);

  /* Сар солиход блокийн сонголт хүчингүй болно */
  const setM = (next: number) => {
    setMRaw(next);
    setBlk(null);
  };

  /* ---------------------------------------------------------- шүүлтүүд
     Дахин дарахад цуцлагдах зарчмыг НЭГ газарт төвлөрүүлэв: рейл,
     газрын зураг, блокийн чипс гурвуулаа эдгээрийг дуудна. Ингэснээр
     «хаанаас тавьсан бол тэндээсээ л авах» гэсэн байдал арилна. */
  const toggleBench = (tuv: number) => {
    setSel((prev) => (prev?.kind === "bench" && prev.tuv === tuv
      ? null
      : { kind: "bench", tuv }));
    /* Түвшин солигдох ч, цуцлагдах ч блокийн шүүлт утгагүй болно */
    setBlk(null);
  };

  const toggleDest = (d: { ci: number; title: string; featName: string }) => {
    setSel((prev) => (prev?.kind === "dest" && prev.ci === d.ci
      ? null
      : { kind: "dest", ...d }));
    setBlk(null);
  };

  const clearAll = () => {
    setSel(null);
    setBlk(null);
  };

  const value = useMemo<Store>(
    () => ({
      m, setM, lang, setLang, sel, setSel, blk, setBlk, tip, setTip,
      toggleBench, toggleDest, clearAll,
      mapMax, setMapMax,
      theme, setTheme,
      t: T[lang] as Dict,
    }),
    [m, lang, sel, blk, tip, theme, mapMax],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore-г StoreProvider дотор дуудна");
  return v;
}
