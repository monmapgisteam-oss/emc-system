"use client";

import type { MouseEvent } from "react";
import { C, COL_NAMES } from "@/lib/config";
import { sumCol } from "@/lib/excel";
import { fmt } from "@/lib/format";
import { useStore } from "@/lib/store";
import styles from "./DestinationBreakdown.module.css";

const DESTINATIONS = [
  { ci: C.BU, names: ["Баяжуулах үйлдвэр", "Concentrator"] },
  { ci: C.OV12, names: ["Овоолго 12", "Stockpile 12"] },
  { ci: C.OV14, names: ["Овоолго 14", "Stockpile 14"] },
  { ci: C.OV8A, names: ["Овоолго 8а", "Stockpile 8a"] },
  { ci: C.OV9A, names: ["Овоолго 9а · 8 · 9", "Piles 9a, 8, 9"] },
  { ci: C.OV9B, names: ["Овоолго 9б", "Pile 9b"] },
] as const;

const COPY = {
  mn: {
    recipient: "Овоолго", share: "Эзлэх хувь", shareColumn: "Хувь",
  },
  en: {
    recipient: "Stockpile", share: "Share", shareColumn: "Share",
  },
} as const;

export default function DestinationBreakdown() {
  const { m, t, lang, sel, setTip } = useStore();
  const copy = COPY[lang], nameIndex = lang === "mn" ? 0 : 1;
  const level = sel?.kind === "bench" ? sel.tuv : undefined;
  const rows = DESTINATIONS.map(row => ({ ...row, value: sumCol(m, row.ci, level) }));
  // The six ore destinations remain the denominator for every share.
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const quantity = (value: number, decimals = 1) => value === 0 ? "0" : fmt(value, decimals);
  const shareLabel = (share: number) => share > 0 && share < 0.1 ? "<0.1%" : `${share.toFixed(1)}%`;
  const showTip = (event: MouseEvent, ci: number, value: number) => {
    setTip({
      x: event.clientX, y: event.clientY, title: COL_NAMES[lang][ci],
      rows: [
        { label: t.thTot, value: `${quantity(value, 2)} ${t.uKt}` },
        ...(total > 0 ? [{ label: copy.share, value: `${(value / total * 100).toFixed(2)}%` }] : []),
      ],
    });
  };
  const moveTip = (event: MouseEvent) => setTip(previous => previous ? { ...previous, x: event.clientX, y: event.clientY } : previous);

  return (
    <div className={styles.card} data-destination-breakdown>
      <div className={styles.columns} aria-hidden="true">
        <span>{copy.recipient}</span><span>{t.uKt}</span><span>{copy.shareColumn}</span>
      </div>
      <ul className={styles.rows} aria-label={`${copy.recipient} · ${t.uKt}`}>
        {rows.map(row => {
          const share = total > 0 ? row.value / total * 100 : 0;
          const selected = sel?.kind === "dest" && sel.ci === row.ci;
          return (
            <li key={row.ci} data-destination={row.ci} aria-current={selected ? "true" : undefined}
              className={`${styles.row}${selected ? ` ${styles.selected}` : ""}${row.value === 0 ? ` ${styles.zero}` : ""}`}
              onMouseEnter={event => showTip(event, row.ci, row.value)} onMouseMove={moveTip} onMouseLeave={() => setTip(null)}>
              <div className={styles.rowHead}>
                <span className={styles.name}>{row.names[nameIndex]}</span>
                <span className={styles.amount}>{quantity(row.value)}</span>
                <span className={styles.share}>
                  <span>{total > 0 ? shareLabel(share) : "—"}</span>
                  <span className={styles.track} aria-hidden="true"><i style={{ width: `${share}%` }} /></span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
