import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, Dataset, DatasetStats, Department, Overview } from "../api";
import { ChartTooltip, axisProps, fmt } from "../components/ui";

const AGG = { sum: "Нийлбэр", mean: "Дундаж", count: "Тоо" } as const;

export default function Analytics({ departments }: { departments: Department[] }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [depCode, setDepCode] = useState("");
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [column, setColumn] = useState("");
  const [agg, setAgg] = useState<keyof typeof AGG>("sum");
  const [series, setSeries] = useState<{ period: string; value: number }[]>([]);

  useEffect(() => {
    api.overview().then(setOverview);
  }, []);

  useEffect(() => {
    if (!depCode && departments.length) setDepCode(departments[0].code);
  }, [departments, depCode]);

  useEffect(() => {
    if (!depCode) return;
    api.datasets(depCode).then((ds) => {
      setDatasets(ds);
      setDatasetId(ds[0]?.id ?? null);
    });
  }, [depCode]);

  useEffect(() => {
    setStats(null);
    setColumn("");
    if (datasetId) api.stats(datasetId).then(setStats);
  }, [datasetId]);

  const dataset = datasets.find((d) => d.id === datasetId);
  const numericCols = stats ? Object.keys(stats.numeric) : [];

  useEffect(() => {
    if (!column && numericCols.length) setColumn(numericCols[0]);
  }, [numericCols, column]);

  useEffect(() => {
    if (datasetId && column && dataset?.date_column) api.series(datasetId, column, agg).then(setSeries);
    else setSeries([]);
  }, [datasetId, column, agg, dataset?.date_column]);

  const depColor = departments.find((d) => d.code === depCode)?.color ?? "var(--series-1)";

  return (
    <>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Бичлэгийн тоо, хэлтсээр</h2>
        {overview && (
          <ResponsiveContainer width="100%" height={Math.max(180, overview.departments.length * 34)}>
            <BarChart data={overview.departments} layout="vertical" margin={{ left: 20, right: 40 }}>
              <CartesianGrid horizontal={false} stroke="var(--grid)" />
              <XAxis type="number" {...axisProps} allowDecimals={false} />
              <YAxis type="category" dataKey="name" {...axisProps} width={110} axisLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="records" name="Бичлэг" radius={[0, 4, 4, 0]} barSize={18}>
                {overview.departments.map((d) => (
                  <Cell key={d.code} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <h2>Хүснэгтийн чиг хандлага</h2>
        <div className="toolbar">
          <label className="field">
            Хэлтэс
            <select value={depCode} onChange={(e) => setDepCode(e.target.value)}>
              {departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Хүснэгт
            <select value={datasetId ?? ""} onChange={(e) => setDatasetId(Number(e.target.value))} disabled={!datasets.length}>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Үзүүлэлт
            <select value={column} onChange={(e) => setColumn(e.target.value)} disabled={!numericCols.length}>
              {numericCols.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Нэгтгэл
            <select value={agg} onChange={(e) => setAgg(e.target.value as keyof typeof AGG)}>
              {Object.entries(AGG).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!datasets.length ? (
          <div className="empty">Энэ хэлтэст дата алга.</div>
        ) : !dataset?.date_column ? (
          <div className="empty">Энэ хүснэгтэд огнооны багана танигдаагүй тул цаг хугацааны график гаргах боломжгүй.</div>
        ) : series.length === 0 ? (
          <div className="empty">Сонгосон үзүүлэлтэд тоон утга алга.</div>
        ) : (
          <>
            <div className="note" style={{ marginBottom: 6 }}>
              {column} — сарын {AGG[agg].toLowerCase()}
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="period" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} width={56} tickFormatter={(v) => fmt(v, 1)} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--axis)" }} />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={column}
                  stroke={depColor}
                  strokeWidth={2}
                  dot={series.length < 40 ? { r: 4, strokeWidth: 2, stroke: "var(--surface-1)", fill: depColor } : false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface-1)" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}

        {stats && numericCols.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 16, maxHeight: 280 }}>
            <table>
              <thead>
                <tr>
                  <th>Үзүүлэлт</th>
                  <th className="num">Бага</th>
                  <th className="num">Дундаж</th>
                  <th className="num">Их</th>
                  <th className="num">Нийлбэр</th>
                </tr>
              </thead>
              <tbody>
                {numericCols.map((c) => (
                  <tr key={c} className={`clickable ${c === column ? "selected" : ""}`} onClick={() => setColumn(c)}>
                    <td>{c}</td>
                    <td className="num">{fmt(stats.numeric[c].min, 2)}</td>
                    <td className="num">{fmt(stats.numeric[c].mean, 2)}</td>
                    <td className="num">{fmt(stats.numeric[c].max, 2)}</td>
                    <td className="num">{fmt(stats.numeric[c].sum, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
