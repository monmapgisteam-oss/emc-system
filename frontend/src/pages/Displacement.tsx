import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, MonitoringPoint, PointAnalysis, Status } from "../api";
import MapView from "../components/MapView";
import { ChartTooltip, STATUS, STATUS_HEX, StatTile, StatusBadge, axisProps, fmt, fmtDate } from "../components/ui";

const WINDOWS = [1, 3, 7, 14];
const ORDER: Status[] = ["alarm", "warning", "normal", "no_data"];

const tickDate = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const timeAxis = (domainMax?: number) => ({
  ...axisProps,
  dataKey: "t",
  type: "number" as const,
  scale: "time" as const,
  domain: ["dataMin", domainMax ? Math.max(domainMax, 0) : "dataMax"] as [string, number | string],
  tickFormatter: tickDate,
});
const tooltipDate = (l: string | number) => fmtDate(new Date(Number(l)).toISOString(), true);

function SeriesLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i
            style={
              i.dashed
                ? { background: `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` }
                : { background: i.color }
            }
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function PointDetail({ analysis, onSaved }: { analysis: PointAnalysis; onSaved: () => void }) {
  const { point, summary } = analysis;
  const [warn, setWarn] = useState(point.warning_velocity);
  const [alarm, setAlarm] = useState(point.alarm_velocity);
  useEffect(() => {
    setWarn(point.warning_velocity);
    setAlarm(point.alarm_velocity);
  }, [point.id, point.warning_velocity, point.alarm_velocity]);

  const data = useMemo(
    () => analysis.series.map((s) => ({ ...s, t: new Date(s.measured_at).getTime() })),
    [analysis.series],
  );
  const failureMs = summary.predicted_failure_at ? new Date(summary.predicted_failure_at).getTime() : undefined;
  const save = async () => {
    await api.updatePoint(point.id, { warning_velocity: warn, alarm_velocity: alarm });
    onSaved();
  };

  return (
    <div className="card disp-detail">
      <div className="toolbar" style={{ justifyContent: "space-between", margin: 0 }}>
        <div>
          <h2 style={{ margin: 0 }}>
            {point.code} {point.name && <span className="note">· {point.name}</span>}
          </h2>
          <div className="note" style={{ marginTop: 2 }}>
            {point.sector ?? "Хэсэг тодорхойгүй"} · {point.instrument} · {summary.count} хэмжилт ·{" "}
            {fmtDate(summary.first_at)} – {fmtDate(summary.last_at)}
          </div>
        </div>
        <StatusBadge status={summary.status} />
      </div>
      {point.note && <div className="note">{point.note}</div>}

      <div className="disp-tiles">
        <StatTile label="Нийт шилжилт (3D)" value={`${fmt(summary.total_mm)} мм`} />
        <StatTile
          label="Хэвтээ / Босоо"
          value={`${fmt(summary.horizontal_mm)} / ${fmt(summary.vertical_mm)}`}
          hint={summary.bearing_deg !== null ? `Чиглэл ${fmt(summary.bearing_deg, 0)}°` : undefined}
        />
        <StatTile label="Хурд" value={`${fmt(summary.velocity, 2)} мм/хоног`} hint={`Сүүлийн ${summary.window_days} хоногоор`} />
        <StatTile label="Хурдатгал" value={`${fmt(summary.acceleration, 3)}`} hint="мм/хоног²" />
        <StatTile
          label="Нуралтын урьдчилсан хугацаа"
          value={summary.predicted_failure_at ? fmtDate(summary.predicted_failure_at) : "Илрээгүй"}
          hint={
            summary.predicted_failure_at
              ? `${fmt(summary.days_to_failure)} хоногийн дараа · R² ${fmt(summary.prediction_r2, 2)}`
              : "Урвуу хурд буурах хандлага алга"
          }
        />
      </div>

      <div className="disp-charts">
        <div className="disp-chart">
          <h2>Хуримтлагдсан шилжилт, мм</h2>
          <SeriesLegend
            items={[
              { label: "3D", color: "var(--series-1)" },
              { label: "Хэвтээ", color: "var(--series-2)" },
              { label: "Босоо (dZ)", color: "var(--series-3)" },
            ]}
          />
          <div className="disp-chart-area">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis {...timeAxis()} />
              <YAxis {...axisProps} axisLine={false} width={48} />
              <ReferenceLine y={0} stroke="var(--axis)" />
              <Tooltip content={<ChartTooltip labelFormat={tooltipDate} unit=" мм" />} cursor={{ stroke: "var(--axis)" }} />
              <Line dataKey="d3" name="3D" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="dh" name="Хэвтээ" stroke="var(--series-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="dz" name="Босоо (dZ)" stroke="var(--series-3)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          </div>
        </div>

        <div className="disp-chart">
          <h2>Шилжилтийн хурд, мм/хоног</h2>
          <SeriesLegend
            items={[
              { label: "Хурд", color: "var(--series-1)" },
              { label: `Анхааруулах босго (${fmt(point.warning_velocity)})`, color: STATUS_HEX.warning, dashed: true },
              { label: `Аюулын босго (${fmt(point.alarm_velocity)})`, color: STATUS_HEX.alarm, dashed: true },
            ]}
          />
          <div className="disp-chart-area">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis {...timeAxis()} />
              <YAxis {...axisProps} axisLine={false} width={48} />
              <ReferenceLine y={point.warning_velocity} stroke={STATUS_HEX.warning} strokeDasharray="4 3" strokeWidth={1.5} />
              <ReferenceLine y={point.alarm_velocity} stroke={STATUS_HEX.alarm} strokeDasharray="4 3" strokeWidth={1.5} />
              <Tooltip content={<ChartTooltip labelFormat={tooltipDate} unit=" мм/хоног" />} cursor={{ stroke: "var(--axis)" }} />
              <Line dataKey="velocity" name="Хурд" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          </div>
        </div>

        <div className="disp-chart">
          <h2>Урвуу хурд (1/v), хоног/мм — Fukuzono арга</h2>
          <SeriesLegend
            items={[
              { label: "1/v", color: "var(--series-1)" },
              ...(failureMs ? [{ label: "Урьдчилсан нуралт", color: STATUS_HEX.alarm, dashed: true }] : []),
            ]}
          />
          <div className="disp-chart-area">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis {...timeAxis(failureMs)} />
              <YAxis {...axisProps} axisLine={false} width={48} />
              {failureMs && <ReferenceLine x={failureMs} stroke={STATUS_HEX.alarm} strokeDasharray="4 3" strokeWidth={1.5} />}
              <Tooltip content={<ChartTooltip labelFormat={tooltipDate} />} cursor={{ stroke: "var(--axis)" }} />
              <Line dataKey="inv_velocity" name="1/v" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          </div>
          <div className="note">
            Урвуу хурд тэг рүү шугаман буурч байвал нуралтын хугацааг шугамын тэгтэй огтлолцох цэгээр тооцно. Сүүлийн 10
            хэмжилтэд R² ≥ 0.6 үед л харуулна.
          </div>
        </div>

        <div className="disp-chart">
          <h2>Хурдны босго тохируулах</h2>
          <div className="toolbar">
            <label className="field">
              Анхааруулах, мм/хоног
              <input type="number" step="0.1" value={warn} onChange={(e) => setWarn(Number(e.target.value))} />
            </label>
            <label className="field">
              Аюултай, мм/хоног
              <input type="number" step="0.1" value={alarm} onChange={(e) => setAlarm(Number(e.target.value))} />
            </label>
            <button onClick={save} style={{ alignSelf: "flex-end" }} disabled={warn >= alarm}>
              Хадгалах
            </button>
          </div>
          {warn >= alarm && <div className="error">Анхааруулах босго аюулын босгоос бага байх ёстой</div>}
          <div className="note">
            Төлөв: хурд ≥ аюулын босго эсвэл нуралт ≤ 7 хоног → Аюултай; хурд ≥ анхааруулах босго эсвэл нуралт ≤ 30 хоног →
            Анхааруулга.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Displacement() {
  const [params, setParams] = useSearchParams();
  const [windowDays, setWindowDays] = useState(3);
  const [points, setPoints] = useState<MonitoringPoint[]>([]);
  const [filter, setFilter] = useState<Status | "">("");
  const [analysis, setAnalysis] = useState<PointAnalysis | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedId = Number(params.get("point")) || null;

  const loadPoints = () => api.points(windowDays).then(setPoints);
  useEffect(() => {
    loadPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays]);

  const loadAnalysis = () => {
    if (selectedId) api.pointAnalysis(selectedId, windowDays).then(setAnalysis);
    else setAnalysis(null);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadAnalysis, [selectedId, windowDays]);

  const counts = useMemo(() => {
    const c: Partial<Record<Status, number>> = {};
    points.forEach((p) => {
      const s = p.summary?.status ?? "no_data";
      c[s] = (c[s] ?? 0) + 1;
    });
    return c;
  }, [points]);

  const visible = points
    .filter((p) => !filter || p.summary?.status === filter)
    .sort(
      (a, b) =>
        ORDER.indexOf(a.summary?.status ?? "no_data") - ORDER.indexOf(b.summary?.status ?? "no_data") ||
        (b.summary?.velocity ?? 0) - (a.summary?.velocity ?? 0),
    );

  const select = (id: number) => setParams({ point: String(id) });

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      const r = await api.importMeasurements(f);
      setMsg({
        ok: true,
        text: `${r.inserted} хэмжилт нэмэгдлээ, ${r.skipped_duplicates} давхардсан алгасав, ${r.created_points} шинэ цэг бүртгэгдэв`,
      });
      loadPoints();
      loadAnalysis();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="disp">
      <div className="disp-head">
        <label className="field">
          Хурд тооцох цонх
          <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w} хоног
              </option>
            ))}
          </select>
        </label>
        <div className="disp-counts" role="group" aria-label="Төлөвөөр шүүх">
          {ORDER.map((s) => (
            <button
              key={s}
              className={filter === s ? "active" : ""}
              onClick={() => setFilter(filter === s ? "" : s)}
              title={filter === s ? "Шүүлтүүр цуцлах" : `Зөвхөн «${STATUS[s].label}» цэгүүд`}
            >
              <StatusBadge status={s} />
              <b>{counts[s] ?? 0}</b>
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto" }}>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => importFile(e.target.files?.[0])} />
          <button
            onClick={() => fileRef.current?.click()}
            title="Файлын баганууд: point_code, measured_at, x, y, z (метр, UTM эсвэл орон нутгийн координат). Шинэ цэг автоматаар бүртгэгдэнэ."
          >
            Хэмжилт оруулах (CSV/Excel)
          </button>
        </div>
      </div>
      {msg && <div className={msg.ok ? "ok" : "error"} style={{ margin: 0 }}>{msg.text}</div>}

      <div className="disp-main">
        <div className="disp-left">
          <div className="card disp-map">
            <div className="legend">
              {ORDER.map((s) => (
                <span key={s}>
                  <i className="sq" style={{ background: STATUS_HEX[s], borderRadius: "50%" }} />
                  {STATUS[s].label}
                </span>
              ))}
            </div>
            <MapView
              height="100%"
              onSelect={select}
              points={visible
                .filter((p) => p.lat !== null && p.lon !== null)
                .map((p) => ({
                  id: p.id,
                  lat: p.lat!,
                  lon: p.lon!,
                  color: STATUS_HEX[p.summary?.status ?? "no_data"],
                  label: `${p.code} — ${STATUS[p.summary?.status ?? "no_data"].label}`,
                  detail: `${fmt(p.summary?.velocity, 2)} мм/хоног · нийт ${fmt(p.summary?.total_mm)} мм`,
                  selected: p.id === selectedId,
                }))}
            />
          </div>
          <div className="card disp-table">
            {points.length === 0 ? (
              <div className="empty">Хяналтын цэг бүртгэгдээгүй байна. Хэмжилтийн файл оруулна уу.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Цэг</th>
                      <th>Хэсэг</th>
                      <th>Төлөв</th>
                      <th className="num">Хурд</th>
                      <th className="num">Нийт, мм</th>
                      <th>Сүүлийн хэмжилт</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr key={p.id} className={`clickable ${p.id === selectedId ? "selected" : ""}`} onClick={() => select(p.id)}>
                        <td>{p.code}</td>
                        <td>{p.sector ?? "—"}</td>
                        <td>
                          <StatusBadge status={p.summary?.status ?? "no_data"} />
                        </td>
                        <td className="num">{fmt(p.summary?.velocity, 2)}</td>
                        <td className="num">{fmt(p.summary?.total_mm)}</td>
                        <td>{fmtDate(p.summary?.last_at, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {analysis ? (
          <PointDetail analysis={analysis} onSaved={() => (loadPoints(), loadAnalysis())} />
        ) : (
          <div className="card disp-detail disp-empty">
            {points.length > 0 ? "Дэлгэрэнгүйг харахын тулд газрын зураг эсвэл хүснэгтээс цэг сонгоно уу." : ""}
          </div>
        )}
      </div>
    </div>
  );
}
