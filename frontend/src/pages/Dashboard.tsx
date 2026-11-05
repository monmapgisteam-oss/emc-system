import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Department } from "../api";
import { DeptIcon } from "../components/icons";
import { DashboardProvider, PrefsCtx } from "../dashboard/context";
import MapWidget from "../dashboard/MapWidget";
import { IndicatorWidget, SerialChartWidget } from "../dashboard/widgets";
import "../dashboard/dashboard.css";
import type { DashboardDef, Widget } from "../dashboard/types";

const HOLES = "ef613a0502c74faf9ed7ed95412dd4e0";
const DUMPS = "d794edd303ad4a788a91b9378dfc0461";
const LAND = "e1ec8b20a6d347e68e64349abf134d50";
const LICENCES = "b84bc4b55e2d45d99e2e85cb8aaf08c3";
const CABLES = "8cbeb0e832c345c88edf491a518af092";
const CABLE_SURVEY = "a7183226293c4b2788e7b00164fba242";
const TREES = "25408bc53b2142ec91ca41b0720f644c";
const DUST = "2fc14c08d9994d64aa7a3ae0beeb5ac7";

const JADE = "#34d0ae";

type Metric = { item: string; widget: string; label: string; icon: string; unit: string };

/** Үзүүлэлтүүд хэлтсийн самбарын индикаторыг шууд ашиглана: тоо нь самбартайгаа үргэлж ижил */
const METRICS: Record<string, Metric[]> = {
  GMH: [
    { item: HOLES, widget: "a050a4da", label: "Өрөмдсөн цооног", icon: "holes", unit: "ш" },
    { item: HOLES, widget: "ee661e9e", label: "Цооногийн нийт гүн", icon: "depth", unit: "м" },
    { item: DUMPS, widget: "fbfe6078", label: "Овоолгын хүдэр", icon: "ore", unit: "мян.тн" },
    { item: LAND, widget: "83427b8c", label: "Нэгж талбар", icon: "parcel", unit: "ш" },
    { item: LAND, widget: "763c3bfc", label: "Газрын хэмжээ", icon: "parcel", unit: "га" },
    { item: LICENCES, widget: "9d648b13", label: "Лиценз", icon: "licence", unit: "ш" },
  ],
  COM: [
    { item: CABLES, widget: "b9749e13", label: "Физик кабель", icon: "cable", unit: "м" },
    { item: CABLES, widget: "7ad9738a", label: "Шилэн кабель", icon: "cable", unit: "м" },
    { item: CABLE_SURVEY, widget: "39ed8593", label: "Хийсэн засвар", icon: "worked", unit: "ш" },
  ],
  BOH: [
    { item: TREES, widget: "2cadc59b", label: "Нийт мод", icon: "tree", unit: "ш" },
    { item: TREES, widget: "95eadb59", label: "Ногоон талбай", icon: "parcel", unit: "га" },
    { item: DUST, widget: "64d767a3", label: "Тоосны дэгдэлт", icon: "wind", unit: "удаа" },
  ],
};

/** Он жилийн chart-ууд: газрын бүртгэлийнх зурагтай нэг шүүлтүүртэй */
const CHARTS = [
  { item: LAND, widget: "efe35614", code: "GMH" },
  { item: HOLES, widget: "emc-year-depth", code: "GMH" },
  { item: CABLES, widget: "8a024fd9", code: "COM" },
];

type Defs = Record<string, DashboardDef>;

function labelled(w: Widget, m: Metric): Widget {
  const text = (t: string) => ({ textInfo: { text: t } });
  return { ...w, icon: m.icon, iconWide: false, unit: m.unit, defaultSettings: { ...w.defaultSettings, topSection: text(m.label), middleSection: text("{value}"), bottomSection: text("") } };
}

/** Эрхгүйгээс нээгдээгүй самбарын үзүүлэлт харагдахгүй: зөвхөн баталгаатай тоо */
function Kpi({ metric, def, onOpen }: { metric: Metric; def?: DashboardDef; onOpen: () => void }) {
  const widget = def?.widgets.find((w) => w.id.startsWith(metric.widget));
  if (!def || !widget) return <div className="ov-kpi blank" />;
  return (
    <div className="ov-kpi" role="link" tabIndex={0} title={`${metric.label}: самбар руу орох`} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <DashboardProvider def={def}>
        <IndicatorWidget widget={labelled(widget, metric)} />
      </DashboardProvider>
    </div>
  );
}

/** Нүүр: хэлтэс бүрийн ерөнхий мэдээлэл, зураг, он жилийн chart. Бүх тоо ArcGIS-ийн бодит давхаргаас. */
export default function Dashboard({ departments }: { departments: Department[] }) {
  const navigate = useNavigate();
  const [defs, setDefs] = useState<Defs>({});
  const [landPrefs, setLandPrefs] = useState<Record<string, string> | undefined>();

  useEffect(() => {
    const items = [...new Set([...Object.values(METRICS).flat(), ...CHARTS].map((m) => m.item))];
    items.forEach((item) => {
      api
        .dashboardDef<DashboardDef>(item)
        .then((d) => setDefs((all) => ({ ...all, [item]: d })))
        .catch(() => {});
    });
    api.dashboardLayout(LAND).then((l) => setLandPrefs(l?.prefs ?? undefined), () => {});
  }, []);

  const open = (code: string, item?: string) => {
    if (!item) return navigate(`/dept/${code}`);
    api.dashboards(code).then(
      (list) => {
        const found = list.find((d) => d.item_id === item);
        navigate(found ? `/dept/${code}?view=${found.id}` : `/dept/${code}`);
      },
      () => navigate(`/dept/${code}`),
    );
  };

  const land = defs[LAND];
  const map = land?.widgets.find((w) => w.type === "mapWidget");
  const chartOf = (c: (typeof CHARTS)[number]) => defs[c.item]?.widgets.find((w) => w.id.startsWith(c.widget));

  const body = (
    <div className="ov-body">
      <div className="ov-map">
        {land && map && (
          <PrefsCtx.Provider value={{ version: landPrefs ? 1 : 0, get: (key) => landPrefs?.[key], set: () => {} }}>
            <MapWidget widget={{ ...map, topCaption: undefined }} startBasemap="imagery" />
          </PrefsCtx.Provider>
        )}
      </div>
      <div className="ov-charts">
        {CHARTS.map((c) => {
          const widget = chartOf(c);
          if (!widget) return <div key={c.widget} className="ov-chart blank" />;
          const chart = <SerialChartWidget widget={{ ...widget, chartConfig: { ...widget.chartConfig, endLabelInside: true } }} />;
          return (
            <div key={c.widget} className="ov-chart">
              {c.item === LAND ? chart : <DashboardProvider def={defs[c.item]}>{chart}</DashboardProvider>}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="ov">
      <div className="ov-band">
        {departments.map((d) => {
          const metrics = METRICS[d.code];
          return (
            <section key={d.code} className={`ov-sec ov-${d.code.toLowerCase()}`}>
              <button className="ov-head" onClick={() => open(d.code)} title={`${d.name}: самбарууд`}>
                <DeptIcon code={d.code} color={JADE} size={16} />
                <b>{d.name}</b>
                <span>{d.dashboard_count} самбар ›</span>
              </button>
              {metrics ? (
                <div className="ov-grid" style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))` }}>
                  {metrics.map((m) => (
                    <Kpi key={m.widget} metric={m} def={defs[m.item]} onOpen={() => open(d.code, m.item)} />
                  ))}
                </div>
              ) : (
                <button className="ov-open" onClick={() => open(d.code)}>Самбар нээх ›</button>
              )}
            </section>
          );
        })}
      </div>
      {land ? <DashboardProvider def={land}>{body}</DashboardProvider> : body}
    </div>
  );
}
