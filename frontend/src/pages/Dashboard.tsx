import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, MonitoringPoint, Status } from "../api";
import MapView from "../components/MapView";
import { STATUS, STATUS_HEX, axisProps, fmt } from "../components/ui";

const ORDER: Status[] = ["alarm", "warning", "normal", "no_data"];
// Чиг хандлагын шугамын өнгө — ангиллын палитраас дараалан (төлөвийн өнгийг давхар хэрэглэхгүй)
const TREND_COLORS = ["#3987e5", "#d95926", "#9085e9", "#199e70"];
const TREND_MAX = 4;


/** Туршилтын цэгийн «DEMO-» угтварыг хасна */
const shortCode = (code: string) => code.replace(/^DEMO-/i, "");

type Trend = { id: number; code: string; color: string; rows: { t: number; v: number }[] };

/** Анхааруулгатай цэгүүдийн хурдны өөрчлөлт — босго шугамтай */
function VelocityTrend({ trends, warn, alarm }: { trends: Trend[]; warn?: number; alarm?: number }) {
  const navigate = useNavigate();
  const fmtDay = (t: number) => {
    const d = new Date(t);
    return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };
  const thLabel = (v: number, color: string) => ({ value: fmt(v, 1), position: "right" as const, fill: color, fontSize: 10 });
  return (
    <div className="trend">
      <div className="legend trend-legend">
        {trends.map((t) => (
          <span key={t.id} onClick={() => navigate(`/displacement?point=${t.id}`)}>
            <i style={{ background: t.color }} />
            {shortCode(t.code)}
          </span>
        ))}
      </div>
      <div className="trend-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 6, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtDay}
              {...axisProps}
              minTickGap={40}
              allowDuplicatedCategory={false}
            />
            <YAxis {...axisProps} axisLine={false} width={30} tickFormatter={(v: number) => fmt(v, 1)} />
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="chart-tooltip">
                    <div className="t">{new Date(Number(label)).toLocaleString("mn-MN", { dateStyle: "short", timeStyle: "short" })}</div>
                    {payload.map((p) => (
                      <div className="row" key={String(p.name)}>
                        <span className="dot" style={{ background: p.color }} />
                        <span className="nm">{shortCode(String(p.name))}</span>
                        <b>{fmt(Number(p.value), 2)} мм/хоног</b>
                      </div>
                    ))}
                  </div>
                ) : null
              }
            />
            {/* Анхааруулгын, аюулын босго — тоо нь шугамын баруун үзүүрт */}
            {warn !== undefined && (
              <ReferenceLine y={warn} stroke={STATUS_HEX.warning} strokeDasharray="4 4" strokeOpacity={0.7} label={thLabel(warn, STATUS_HEX.warning)} />
            )}
            {alarm !== undefined && (
              <ReferenceLine y={alarm} stroke={STATUS_HEX.alarm} strokeDasharray="4 4" strokeOpacity={0.7} label={thLabel(alarm, STATUS_HEX.alarm)} />
            )}
            {trends.map((t) => (
              <Line
                key={t.id}
                data={t.rows}
                dataKey="v"
                name={t.code}
                stroke={t.color}
                strokeWidth={1.8}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 1.5 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [points, setPoints] = useState<MonitoringPoint[]>([]);
  const [trends, setTrends] = useState<Trend[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.points(3).then(setPoints).catch((e) => setError(e.message));
  }, []);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { alarm: 0, warning: 0, normal: 0, no_data: 0 };
    points.forEach((p) => (c[p.summary?.status ?? "no_data"] += 1));
    return c;
  }, [points]);

  // Хурдаар эрэмбэлсэн цэгүүд — аюултай нь эхэнд
  const ranked = useMemo(
    () =>
      [...points].sort(
        (a, b) =>
          ORDER.indexOf(a.summary?.status ?? "no_data") - ORDER.indexOf(b.summary?.status ?? "no_data") ||
          (b.summary?.velocity ?? -1) - (a.summary?.velocity ?? -1),
      ),
    [points],
  );
  const maxV = Math.max(1, ...points.map((p) => p.summary?.velocity ?? 0));
  const demo = points.some((p) => /^DEMO-/i.test(p.code));

  // Чиг хандлага: анхааруулгатай цэгүүд (байхгүй бол хамгийн хурдан цэгүүд)
  const flagged = ranked.filter((p) => p.summary?.status === "alarm" || p.summary?.status === "warning");
  const trendPoints = useMemo(
    () => (flagged.length ? flagged : ranked.filter((p) => p.summary?.velocity != null)).slice(0, TREND_MAX),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ranked],
  );
  useEffect(() => {
    if (!trendPoints.length) return setTrends(points.length ? [] : null);
    let cancelled = false;
    Promise.all(
      trendPoints.map((p, i) =>
        api
          .pointAnalysis(p.id, 3)
          .then((a) => ({
            id: p.id,
            code: p.code,
            color: TREND_COLORS[i % TREND_COLORS.length],
            rows: a.series.filter((r) => r.velocity != null).map((r) => ({ t: new Date(r.measured_at).getTime(), v: r.velocity as number })),
          }))
          .catch(() => null),
      ),
    ).then((res) => !cancelled && setTrends(res.filter((t): t is Trend => Boolean(t && t.rows.length))));
    return () => {
      cancelled = true;
    };
  }, [trendPoints, points.length]);
  // Босго — бүх цэгт ижил үед л
  const same = (k: "warning_velocity" | "alarm_velocity") => {
    const vals = new Set(trendPoints.map((p) => p[k]));
    return vals.size === 1 ? [...vals][0] : undefined;
  };

  return (
    <>
      {error && <div className="page error">Сервертэй холбогдож чадсангүй: {error}</div>}

      {/* Газрын зураг бүтэн дэлгэцээр, мэдээлэл нь дээр нь хөвөх самбаруудаар */}
      <div className="home2">
        <MapView
          height="100%"
          // Төлөвийн мөр (дээр), цэгийн жагсаалт (баруун), хурдны график (доор)-ын ард цэг орохгүй
          fitPad={(size) => ({ topLeft: [60, 80], bottomRight: [size.x < 1000 ? 260 : 310, Math.max(Math.round(size.y * 0.28), 160) + 40] })}
          onSelect={(id) => navigate(`/displacement?point=${id}`)}
          points={points
            .filter((p) => p.lat !== null && p.lon !== null)
            .map((p) => ({
              id: p.id,
              lat: p.lat!,
              lon: p.lon!,
              color: STATUS_HEX[p.summary?.status ?? "no_data"],
              label: `${p.code} — ${STATUS[p.summary?.status ?? "no_data"].label}`,
              detail: `${fmt(p.summary?.velocity, 2)} мм/хоног · нийт ${fmt(p.summary?.total_mm)} мм`,
              tag: shortCode(p.code),
            }))}
        />

        {/* Төлөв — тоо нь газрын зургийн тайлбар болно */}
        <div className="float status-strip">
          <span className="ttl">Уулын цулын шилжилт</span>
          <span className="total">
            <b>{points.length}</b> цэг
          </span>
          {ORDER.filter((s) => s !== "no_data" || counts.no_data).map((s) => (
            <span key={s} className="st">
              <i style={{ background: STATUS_HEX[s] }} />
              <b style={counts[s] && s !== "no_data" ? { color: STATUS_HEX[s] } : undefined}>{counts[s]}</b>
              {STATUS[s].label}
            </span>
          ))}
          {demo && <span className="chip demo" title="Цэгүүдийн өгөгдөл туршилтынх (DEMO)">Туршилтын өгөгдөл</span>}
        </div>

        <section className="float points-float">
          <header>
            <h3>Цэгүүд</h3>
            <span className="unit">мм/хоног</span>
          </header>
          {!ranked.length ? (
            <div className="empty">Цэг алга</div>
          ) : (
            <ul className="rank">
              {ranked.map((p) => {
                const st = p.summary?.status ?? "no_data";
                const v = p.summary?.velocity;
                const dtf = p.summary?.days_to_failure;
                return (
                  <li
                    key={p.id}
                    className={st}
                    onClick={() => navigate(`/displacement?point=${p.id}`)}
                    title={`${p.code}${p.sector ? ` · ${p.sector}` : ""} — ${STATUS[st].label}`}
                  >
                    <span className="dot" style={{ background: STATUS_HEX[st] }} />
                    <span className="code">{shortCode(p.code)}</span>
                    <span className="bar">
                      <i style={{ width: `${v ? Math.max(2, (v / maxV) * 100) : 0}%`, background: STATUS_HEX[st] }} />
                    </span>
                    <b>{v == null ? "—" : fmt(v, 2)}</b>
                    {st === "alarm" && dtf != null && <small>Нуралт ≈ {fmt(dtf, 1)} хоног</small>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="float trend-float">
          <header>
            <h3>Хурд, мм/хоног</h3>
          </header>
          {trends === null ? (
            <div className="empty">…</div>
          ) : trends.length ? (
            <VelocityTrend trends={trends} warn={same("warning_velocity")} alarm={same("alarm_velocity")} />
          ) : (
            <div className="empty">Хэмжилт алга</div>
          )}
        </section>
      </div>
    </>
  );
}
