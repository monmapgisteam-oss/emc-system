"use client";

import { useId, useState } from "react";
import { C, COL_NAMES } from "@/lib/config";
import { blocksAt, grp } from "@/lib/excel";
import { fmt } from "@/lib/format";
import { MON_L } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import styles from "./BenchDetail.module.css";

const COPY = {
  mn: {
    block: "Блок", total: "Нийт олборлосон хүдэр", breakdown: "Үзүүлэлтийн задаргаа",
    expand: "Бүгдийг дэлгэх", collapse: "Бүгдийг хураах", cutoff: "Захын агуулга 0.25%",
    reserve: "Олборлосон нөөц", dilution: "Бохирдол ба хаягдал", destinations: "Хүдрийн хуваарилалт",
    subgrade: "Балансын бус хүдэр", rock: "Хоосон чулуулаг, уулын цул",
    rates: "Хувийн үзүүлэлтүүд", cu: "Зэс · Cu", mo: "Молибден · Mo",
    reserveTotal: "Нийт нөөц", ofReserve: "Нийт нөөцөөс", cuName: "Зэс", moName: "Молибден",
    rows: ["Олборлосон нөөц", "Үйлдвэрт шилжүүлсэн нөөц", "Агуулахад гаргасан хүдэр",
      "Нэмэгдсэн бохирдол", "Хаягдлын хувь", "Бохирдлын хувь", "Баяжуулах үйлдвэрт",
      "Овоолго 12", "Овоолго 14", "Овоолго 8а", "Нийт олборлосон хүдэр",
      "Овоолго 9а, 8, 9", "Овоолго 9б", "Хоосон чулуулаг · 1, 4, 11", "Нийт уулын цул"],
  },
  en: {
    block: "Block", total: "Total ore mined", breakdown: "Detailed breakdown",
    expand: "Expand all", collapse: "Collapse all", cutoff: "Cut-off grade 0.25%",
    reserve: "Mined reserve", dilution: "Dilution and reject", destinations: "Ore destinations",
    subgrade: "Sub-grade ore", rock: "Waste and total rock",
    rates: "Rates", cu: "Copper · Cu", mo: "Molybdenum · Mo",
    reserveTotal: "Total reserve", ofReserve: "Of the total reserve", cuName: "Copper", moName: "Molybdenum",
    rows: ["Mined reserve", "Reserve sent to concentrator", "Ore sent to storage",
      "Added dilution", "Reject rate", "Dilution rate", "To concentrator",
      "Stockpile 12", "Stockpile 14", "Stockpile 8a", "Total ore mined",
      "Piles 9a, 8, 9", "Pile 9b", "Waste rock · piles 1, 4, 11", "Total rock moved"],
  },
} as const;

/** Selected block values stay separate: reserves, shipments and totals overlap. */
export default function BenchDetail({ level }: { level: number }) {
  const { m, t, lang, blk, setBlk } = useStore();
  const copy = COPY[lang];
  const id = useId();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const blocks = blocksAt(m, level);
  const current = blk && blocks.includes(blk) ? blk : blocks[0];
  const data = current ? grp(m, level, current) : null;
  const has = (ci: number) => !!data && !!(data.kt[ci] || data.cu[ci] || data.mo[ci]);
  const groups = [
    { key: "reserve", label: copy.reserve, cols: [C.NOOC, C.BU_U, C.AGU], amount: data?.kt[C.NOOC], unit: t.uKt },
    { key: "dilution", label: copy.dilution, cols: [C.BOH, C.HAY, C.BOHP], amount: data?.kt[C.BOH] || undefined, unit: t.uKt },
    { key: "destinations", label: copy.destinations, cols: [C.BU, C.OV12, C.OV14, C.OV8A], amount: data?.kt[C.NIIT], unit: t.uKt },
    { key: "subgrade", label: copy.subgrade, cols: [C.OV9A, C.OV9B], amount: data ? data.kt[C.OV9A] + data.kt[C.OV9B] : 0, unit: t.uKt },
    { key: "rock", label: copy.rock, cols: [C.HOOSON, C.TSUL], amount: data?.kt[C.TSUL], unit: t.uM3 },
  ].map(group => ({ ...group, cols: group.cols.filter(has) })).filter(group => group.cols.length);
  const allOpen = groups.length > 0 && groups.every(group => open[group.key]);
  const grade = (value: number, decimals: number) => value ? `${value.toFixed(decimals)}%` : "—";
  const quantity = (value: number) => value === 0 ? "0.0" : fmt(value, 1);

  return (
    <div className={styles.card} data-bench-detail={level}>
      <div className={styles.context}>
        <span className={styles.month}>{MON_L[lang][m - 1]}</span>
        <div className={styles.blocks} role="group" aria-label={copy.block}>
          <span>{copy.block}</span>
          {blocks.map(block => (
            <button type="button" key={block} aria-pressed={block === current}
              title={block === "БҮ" ? t.bu : `${copy.block} ${block}`}
              onClick={() => setBlk(block)}>{block === "БҮ" ? (lang === "mn" ? "БҮ" : "Plant") : `№ ${block}`}</button>
          ))}
        </div>
      </div>
      {!data || (!groups.length && !has(C.NIIT)) ? <div className="empty">{t.noData}</div> : (
        <>
          <section className={styles.summary} aria-label={copy.total}>
            <div className={styles.total}>
              <span>{copy.total}</span>
              <div><strong>{quantity(data.kt[C.NIIT])}</strong><span>{t.uKt}</span></div>
            </div>
            <dl className={styles.grades}>
              <div><dt><abbr title={copy.cu}>Cu</abbr></dt><dd>{grade(data.cu[C.NIIT], 3)}</dd></div>
              <div><dt><abbr title={copy.mo}>Mo</abbr></dt><dd>{grade(data.mo[C.NIIT], 4)}</dd></div>
            </dl>
          </section>
          <div className={styles.sectionLabel}>
            <span>{copy.breakdown}</span>
            <button type="button" onClick={() => setOpen(Object.fromEntries(groups.map(group => [group.key, !allOpen])))}>
              {allOpen ? copy.collapse : copy.expand}
            </button>
          </div>
          <div className={styles.groups}>
            {groups.map(group => {
              const expanded = !!open[group.key];
              const sectionId = `${id}-${group.key}`;
              const rates = group.cols.filter(ci => ci === C.HAY || ci === C.BOHP);
              const measures = group.cols.filter(ci => ci !== C.HAY && ci !== C.BOHP);
              return (
                <section key={group.key} className={`${styles.group}${group.key === "reserve" ? ` ${styles.reserveGroup}` : ""}`}>
                  <h3>
                    <button type="button" className={styles.groupToggle} aria-expanded={expanded}
                      aria-controls={sectionId} onClick={() => setOpen(previous => ({ ...previous, [group.key]: !expanded }))}>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
                      <span className={styles.groupTitle}>{group.label}</span>
                      {group.amount !== undefined && <span className={styles.groupAmount}><b>{quantity(group.amount)}</b><small>{group.unit}</small></span>}
                    </button>
                  </h3>
                  <div id={sectionId} hidden={!expanded} className={styles.groupBody}>
                    {group.key === "reserve" && <p className={styles.note}>{copy.cutoff}</p>}
                    <dl className={styles.rows}>
                      {measures.map(ci => (
                        <div key={ci} className={`${styles.row}${group.key === "reserve" ? ` ${ci === C.NOOC ? styles.reserveTotal : styles.reservePart}` : ""}`} data-column={ci}>
                          <dt title={COL_NAMES[lang][ci]}>
                            {ci === C.NOOC ? copy.reserveTotal : copy.rows[ci]}
                            {group.key === "reserve" && ci !== C.NOOC && <small className={styles.rowHint}>{copy.ofReserve}</small>}
                          </dt>
                          <dd className={styles.amount}>{quantity(data.kt[ci])} <small>{ci === C.HOOSON || ci === C.TSUL ? t.uM3 : t.uKt}</small></dd>
                          {(data.cu[ci] !== 0 || data.mo[ci] !== 0) && (
                            <dd className={styles.rowGrades}>
                              <span><abbr title={copy.cu}><span className={styles.gradeSymbol}>Cu</span>{group.key === "reserve" && <span className={styles.gradeName}>{copy.cuName}</span>}</abbr> <b>{grade(data.cu[ci], 3)}</b></span>
                              <span><abbr title={copy.mo}><span className={styles.gradeSymbol}>Mo</span>{group.key === "reserve" && <span className={styles.gradeName}>{copy.moName}</span>}</abbr> <b>{grade(data.mo[ci], 4)}</b></span>
                            </dd>
                          )}
                        </div>
                      ))}
                    </dl>
                    {!!rates.length && <dl className={styles.rates} aria-label={copy.rates}>
                      {rates.map(ci => <div key={ci} data-column={ci}>
                        <dt title={COL_NAMES[lang][ci]}>{copy.rows[ci]}</dt>
                        <dd>{data.kt[ci].toFixed(2)}<small>%</small></dd>
                      </div>)}
                    </dl>}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
