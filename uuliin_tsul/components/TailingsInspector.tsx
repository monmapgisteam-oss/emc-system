"use client";

import { useStore } from "@/lib/store";
import styles from "./TailingsInspector.module.css";

interface Props {
  transparency: number;
  sliced: boolean;
  depth: number;
  diameter: number;
  onTransparencyChange(value: number): void;
  onTransparencyToggle(): void;
  onSliceToggle(): void;
  onFocus(): void;
  onOverview(): void;
  onClose(): void;
}

export default function TailingsInspector({
  transparency, sliced, depth, diameter,
  onTransparencyChange, onTransparencyToggle, onSliceToggle,
  onFocus, onOverview, onClose,
}: Props) {
  const { t } = useStore();
  const stopArrows = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key.startsWith("Arrow")) event.stopPropagation();
  };
  return (
    <section className={styles.panel} aria-labelledby="tailings-inspector-title" title={t.flowRoute}>
      <div className={styles.header}>
        <h3 id="tailings-inspector-title">{t.lyTails}</h3>
        <button type="button" onClick={onClose} aria-label={t.flowClose} title={`${t.flowClose} · Esc`}>×</button>
      </div>
      <p className={styles.dimensions}>{t.flowDepth} {depth} {t.flowMeters} · Ø {diameter} {t.flowMeters}</p>
      <div className={styles.tools} role="group" aria-label={t.flowTools}>
        <button type="button" aria-pressed={transparency > 0} onClick={onTransparencyToggle}
          title={t.flowInspectHint}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
          </svg>
          {t.flowTransparentTool}
        </button>
        <button type="button" aria-pressed={sliced} onClick={onSliceToggle} title={t.flowSliceHint}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="m3 8 9-5 9 5v9l-9 5-9-5V8Zm0 0 9 5 9-5M12 13v9M2 15l20-6" />
          </svg>
          {t.flowSliceTool}
        </button>
      </div>
      <div className={styles.label}>
        <label htmlFor="tailings-transparency">{t.flowTransparency}</label>
        <output htmlFor="tailings-transparency">{transparency}%</output>
      </div>
      <input id="tailings-transparency" className={styles.slider} type="range"
        min={0} max={100} step={1} value={transparency}
        aria-valuetext={`${transparency}%`}
        onKeyDown={stopArrows}
        onChange={(event) => onTransparencyChange(Number(event.target.value))} />
      <div className={styles.actions}>
        <button type="button" onClick={onFocus}>{t.flowFocus}</button>
        <button type="button" onClick={onOverview}>{t.flowOverview}</button>
      </div>
    </section>
  );
}
