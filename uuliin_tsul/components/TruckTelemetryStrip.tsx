"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TruckTelemetry } from "@/lib/truckTelemetry";
import styles from "./TruckTelemetryStrip.module.css";

interface TruckTelemetryStripProps {
  trucks: readonly TruckTelemetry[];
  lang: "mn" | "en";
  onSelect?: (id: number) => void;
  selectedId?: number | null;
  emptyState?: "loading" | "hidden" | "empty";
}

const COPY = {
  mn: {
    label: "Тээврийн хэрэгслийн үзүүлэлт",
    loaded: "АЧААТАЙ",
    empty: "ХООСОН",
    parked: "ЗОГССОН",
    incline: "НАЛУУ",
    nearest: "ОЙР МАШИН",
    metres: "М",
    inclineHint: "Газрын гадаргын загварын өндрөөс тооцсон дагуу налуу.",
    nearestHint: "Хамгийн ойр машины газарзүйн хэвтээ зай.",
    caution: "Аюулын бүс",
    warning: "Өндөр аюултай бүс",
    unknown: "Аюулын бүсийн мэдээлэл байхгүй",
    previous: "Өмнөх машинууд",
    next: "Дараах машинууд",
    select: "Газрын зураг дээр харах",
    loading: "Машинуудын мэдээллийг ачаалж байна…",
    hidden: "Машинуудыг харуулахын тулд тээврийн урсгалыг асаана уу.",
    noTrucks: "Харуулах машин байхгүй.",
  },
  en: {
    label: "Haul truck telemetry",
    loaded: "LOADED",
    empty: "EMPTY",
    parked: "PARKED",
    incline: "INCLINE",
    nearest: "NEAREST TRUCK",
    metres: "M",
    inclineHint: "Longitudinal incline estimated from terrain model elevations.",
    nearestHint: "Horizontal geographic distance to the nearest truck.",
    caution: "Hazard zone",
    warning: "High hazard zone",
    unknown: "Hazard zone data unavailable",
    previous: "Previous trucks",
    next: "Next trucks",
    select: "Show on map",
    loading: "Loading haul trucks…",
    hidden: "Turn on truck flow to show haul trucks.",
    noTrucks: "No haul trucks to display.",
  },
} as const;

/** A yellow rigid mining truck; hazard colors belong to its surrounding telemetry. */
function HaulTruck() {
  return (
    <svg className={styles.truck} viewBox="0 0 126 91" aria-hidden="true">
      <ellipse cx="63" cy="81" rx="54" ry="5" fill="#000" opacity=".24" />
      <path d="m39 31 77-8-8 10-16 5-7 21H50Z" fill="currentColor" stroke="#13191c" strokeWidth="1.2" />
      <path d="m39 31 77-8-2-4-78 8Z" fill="currentColor" stroke="#ffe0aa" strokeOpacity=".65" strokeWidth="1.1" />
      <path d="m42 34 68-8-8 8-13 4-6 16-30 3Z" fill="#000" opacity=".15" />
      <path d="m48 33 9 23m5-25 8 23m5-25 7 23m6-25 5 11m7-12 3 8" fill="none" stroke="#ffe0aa" strokeOpacity=".75" strokeWidth="2.2" />
      <path d="m50 34 8 21m6-23 7 21m6-23 6 20m7-22 4 9" fill="none" stroke="#000" strokeOpacity=".4" strokeWidth="1" />
      <path d="m45 54 41 1 12 8-3 8H28l-5-8Z" fill="#22292b" stroke="#080d0f" strokeWidth="1.3" />
      <path d="M17 31h26l8 28-7 7H12l2-17Z" fill="currentColor" stroke="#12191b" strokeWidth="1.5" />
      <path d="m21 35-4 16h22l-4-16Z" fill="#1c333c" stroke="#fee8bd" strokeOpacity=".7" strokeWidth="1.2" />
      <path d="m22 37-3 12h8l-1-12Z" fill="#7099a0" opacity=".75" />
      <path d="M30 36v14m-15 5h26m-26 5h9m16-5 6 5" fill="none" stroke="#151c1f" strokeWidth="1.5" />
      <path d="M16 29h28l2 4H15Z" fill="currentColor" stroke="#ffdfaf" strokeOpacity=".85" strokeWidth="1.2" />
      <path d="M13 64h9m20 0h15m44 0h5M9 67h10" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M11 57v10m-3-9h6m30-19v12m0-10h5" fill="none" stroke="#adb2ac" strokeWidth="1.2" />
      <rect x="16" y="56" width="4" height="3" rx=".6" fill="#fff6cf" />
      <path d="M51 61h16v8H51Z" fill="currentColor" opacity=".7" />
      <path d="M55 62v6m5-6v6" stroke="#1a2327" strokeWidth="1.2" />
      {[30, 89].map((x) => (
        <g key={x}>
          <circle cx={x} cy="70" r="14" fill="#181e20" stroke="#585c59" strokeWidth="2.5" />
          <circle cx={x} cy="70" r="11.5" fill="none" stroke="#999c92" strokeOpacity=".42" strokeWidth="2" strokeDasharray="2 2.8" />
          <circle cx={x} cy="70" r="8.7" fill="currentColor" stroke="#101619" strokeWidth="1.2" />
          <circle cx={x} cy="70" r="5.3" fill="#303a3a" stroke="#ffe1ac" strokeOpacity=".7" strokeWidth="1" />
          <circle cx={x} cy="70" r="2.3" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

function AlertGlyph({ warning = false }: { warning?: boolean }) {
  return warning ? (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m10.3 4.4-7 12.1A2 2 0 0 0 5 19.5h14a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0ZM11 8h2v5h-2Zm1 8.8a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z" fillRule="evenodd" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10.4 3.7a1.6 1.6 0 1 1 3.2 0v.5a6 6 0 0 1 4.4 5.8v3.3l1.6 2.5a1 1 0 0 1-.8 1.5H5.2a1 1 0 0 1-.8-1.5L6 13.3V10a6 6 0 0 1 4.4-5.8Zm-1 15h5.2a2.7 2.7 0 0 1-5.2 0Z" />
    </svg>
  );
}

function SlopeGlyph({ value }: { value: number | null }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d={value === null || value === 0 ? "M5 8h6" : value > 0 ? "m5 9 3-3 3 3" : "m5 7 3 3 3-3"} stroke="#252a28" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DistanceGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8h12M5 5 2 8l3 3m6-6 3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function TruckTelemetryStrip({
  trucks, lang, onSelect, selectedId, emptyState = "empty",
}: TruckTelemetryStripProps) {
  const copy = COPY[lang];
  const trackRef = useRef<HTMLUListElement>(null);
  const showTrucks = emptyState !== "hidden" && emptyState !== "loading" && trucks.length > 0;
  const [scrollState, setScrollState] = useState({ previous: false, next: false });
  const updateScrollState = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const nextState = {
      previous: track.scrollLeft > 2,
      next: track.scrollWidth - track.clientWidth - track.scrollLeft > 2,
    };
    setScrollState((current) =>
      current.previous === nextState.previous && current.next === nextState.next ? current : nextState);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(track);
    return () => observer.disconnect();
  }, [showTrucks, trucks.length, updateScrollState]);

  const scroll = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({
      left: direction * Math.max(280, track.clientWidth * 0.85),
      behavior: reducedMotion ? "instant" : "smooth",
    });
  };

  return (
    <section className={styles.strip} aria-label={copy.label} onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      scroll(event.key === "ArrowLeft" ? -1 : 1);
    }}>
      {!showTrucks ? (
        <div className={styles.emptyState} role="status">
          {emptyState === "loading" ? copy.loading : emptyState === "hidden" ? copy.hidden : copy.noTrucks}
        </div>
      ) : (
        <>
          {(scrollState.previous || scrollState.next) && (
            <div className={styles.navigation}>
              <button type="button" className={styles.scrollButton} onClick={() => scroll(-1)}
                disabled={!scrollState.previous} aria-label={copy.previous} title={copy.previous}>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg>
              </button>
              <button type="button" className={styles.scrollButton} onClick={() => scroll(1)}
                disabled={!scrollState.next} aria-label={copy.next} title={copy.next}>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
              </button>
            </div>
          )}
          <ul ref={trackRef} className={styles.track} onScroll={updateScrollState}
            tabIndex={scrollState.previous || scrollState.next ? 0 : undefined} aria-label={copy.label}>
            {trucks.map((truck) => {
              const hazard = truck.hazardLevel;
              const hasAlert = hazard !== null && hazard > 0;
              const tone = hazard === null ? styles.unknown
                : hazard === 3 ? styles.danger
                : hazard === 2 ? styles.caution
                : hazard === 1 ? styles.lowHazard
                : styles.normal;
              const title = `TRUCK ${truck.displayNumber}`;
              const incline = truck.incline === null ? "—" : `${truck.incline > 0 ? "+" : ""}${truck.incline.toFixed(2)}°`;
              const distance = truck.nearestDistance === null ? "—" : `${Math.round(truck.nearestDistance)} ${copy.metres}`;
              const loadState = truck.parked ? copy.parked : truck.loaded ? copy.loaded : copy.empty;
              const hazardDescription = hazard === null ? copy.unknown : hazard === 3 ? copy.warning : hasAlert ? `${copy.caution} ${hazard}` : "";
              const content = (
                <>
                  <HaulTruck />
                  <div className={styles.details}>
                    <strong className={styles.name}>{title}</strong>
                    <span className={styles.loadState}>{loadState}</span>
                    <span className={styles.metric} title={copy.inclineHint}>
                      {hasAlert && <span className={styles.smallBell}><AlertGlyph /></span>}
                      <SlopeGlyph value={truck.incline} />
                      <span>{copy.incline} {incline}</span>
                    </span>
                    <span className={styles.metric} title={copy.nearestHint}>
                      <DistanceGlyph />
                      <span>{copy.nearest} {distance}</span>
                    </span>
                  </div>
                  {hasAlert && (
                    <span className={styles.alert} role="img"
                      aria-label={hazardDescription}
                      title={hazardDescription}>
                      <AlertGlyph warning={hazard === 3} />
                    </span>
                  )}
                  {hazard === null && <span className={styles.unavailable} title={copy.unknown} aria-label={copy.unknown}>?</span>}
                </>
              );
              const className = `${styles.card} ${tone}${selectedId === truck.id ? ` ${styles.selected}` : ""}`;
              return (
                <li key={truck.id} className={styles.item} data-truck-id={truck.id}>
                  {onSelect ? (
                    <button type="button" className={className} onClick={() => onSelect(truck.id)}
                      aria-pressed={selectedId === truck.id}
                      aria-label={[title, loadState, `${copy.incline} ${incline}`, `${copy.nearest} ${distance}`, hazardDescription, copy.select].filter(Boolean).join(" · ")}>
                      {content}
                    </button>
                  ) : <div className={className}>{content}</div>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
