import type { ReactNode } from "react";
import type { Status } from "../api";

export const STATUS: Record<Status, { label: string; color: string; icon: string }> = {
  normal: { label: "Хэвийн", color: "var(--status-good)", icon: "✓" },
  warning: { label: "Анхааруулга", color: "var(--status-warning)", icon: "!" },
  alarm: { label: "Аюултай", color: "var(--status-critical)", icon: "▲" },
  no_data: { label: "Дата хүрэлцээгүй", color: "var(--status-none)", icon: "–" },
};

// Leaflet-ийн SVG дүрс CSS хувьсагч уншдаггүй тул hex хэрэглэнэ
export const STATUS_HEX: Record<Status, string> = {
  normal: "#0ca30c",
  warning: "#fab219",
  alarm: "#d03b3b",
  no_data: "#898781",
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className="badge">
      <span className={`sw ${status}`} style={{ background: s.color }} aria-hidden>
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export const fmt = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "—" : v.toLocaleString("mn-MN", { maximumFractionDigits: digits });

export const fmtDate = (iso: string | null | undefined, withTime = false) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return withTime ? `${date} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : date;
};

type TooltipEntry = { name?: string; value?: number | string; color?: string; dataKey?: string | number };

export function ChartTooltip({
  active,
  payload,
  label,
  labelFormat = (l) => String(l),
  unit = "",
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  labelFormat?: (l: string | number) => string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="t">{labelFormat(label ?? "")}</div>
      {payload
        .filter((p) => p.value !== null && p.value !== undefined)
        .map((p) => (
          <div className="row" key={String(p.dataKey)}>
            <span className="dot" style={{ background: p.color }} />
            <span className="nm" title={String(p.name ?? "")}>{p.name}</span>
            <b>
              {typeof p.value === "number" ? fmt(p.value, 2) : p.value}
              {unit}
            </b>
          </div>
        ))}
    </div>
  );
}

export const axisProps = {
  stroke: "var(--axis)",
  tick: { fill: "var(--text-muted)", fontSize: 11 },
  tickLine: false,
} as const;
