import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import esriConfig from "@arcgis/core/config";
import esriId from "@arcgis/core/identity/IdentityManager";
import Basemap from "@arcgis/core/Basemap";
import Camera from "@arcgis/core/Camera";
import Extent from "@arcgis/core/geometry/Extent";
import WebScene from "@arcgis/core/WebScene";
import Color from "@arcgis/core/Color";
import SceneView from "@arcgis/core/views/SceneView";
import Theme from "@arcgis/core/views/Theme";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import TileLayer from "@arcgis/core/layers/TileLayer";
import MapImageLayer from "@arcgis/core/layers/MapImageLayer";
import ImageryLayer from "@arcgis/core/layers/ImageryLayer";
import type Layer from "@arcgis/core/layers/Layer";
import LabelClass from "@arcgis/core/layers/support/LabelClass";
import BuildingFilter from "@arcgis/core/layers/support/BuildingFilter";
import PopupTemplate from "@arcgis/core/PopupTemplate";
import { fromJSON as rendererFromJSON } from "@arcgis/core/renderers/support/jsonUtils";
import DirectLineMeasurementAnalysis from "@arcgis/core/analysis/DirectLineMeasurementAnalysis";
import AreaMeasurementAnalysis from "@arcgis/core/analysis/AreaMeasurementAnalysis";
import SliceAnalysis from "@arcgis/core/analysis/SliceAnalysis";
import SlicePlane from "@arcgis/core/analysis/SlicePlane";
import ElevationProfileAnalysis from "@arcgis/core/analysis/ElevationProfileAnalysis";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import { serviceLabelField, whereOf, type Extent4326, type LayerInfo, type MapLayer, type PolyPaint } from "./MapWidget";
import type { RuntimeFilter } from "./types";

esriConfig.assetsPath = "https://js.arcgis.com/4.34/@arcgis/core/assets";

const JADE = "#34d0ae";
const GROUND_Z = 1300;
const START_TILT = 58;
const START_FOV = 55;
/** Албан ёсны хоёр scene: зүүн тал бодит (mesh), баруун тал схем (multipatch). BIM (АБК) хоёуланд нь бий. */
const SCENE_MESH = "638b9f2b27e648398c01ed047c044954";
const SCENE_MULTIPATCH = "d6d031c558ed47e781626d76e2391ada";
const ABK_EXTENT = { xmin: 104.1394, ymin: 49.0372, xmax: 104.1406, ymax: 49.038, spatialReference: { wkid: 4326 } };

type ToolKind = "line" | "area" | "slice" | "profile";

const ICON: Record<ToolKind | "layers" | "building" | "swipe", string> = {
  line: "M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2",
  area: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10",
  slice: "M4 4h16M12 2v20M4 20h16M4 4l8 8-8 8M20 4l-8 8 8 8",
  profile: "M3 19l5-8 4 4 4-9 5 13zM3 21h18",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  building: "M5 21V5l9-2v18M14 9l5 2v10M3 21h18M8 8h3M8 12h3M8 16h3",
  swipe: "M12 3v18M8 8l-4 4 4 4M16 8l4 4-4 4",
};

const TOOLS: { kind: ToolKind; label: string; title: string; hint: string }[] = [
  { kind: "line", label: "Зай", title: "Зай хэмжих", hint: "Эхлэл, төгсгөлийн цэг дээр дарна. Зай нь уул, уурхайн гадаргаас хэмжигдэнэ." },
  { kind: "area", label: "Талбай", title: "Талбай хэмжих", hint: "Цэгүүдээ дарж, сүүлийн цэг дээр давхар дарж дуусгана." },
  { kind: "slice", label: "Зүсэлт", title: "Зүсэлт", hint: "Гадарга дээр дарж зүсэх хавтгайгаа тавина. Дараа нь чирж байрлал, хэмжээг нь өөрчилнө." },
  { kind: "profile", label: "Профайл", title: "Өндрийн профайл", hint: "Шугамын цэгүүдээ дарж, сүүлийн цэг дээр давхар дарна." },
];

type Quantity = { value: number; unit: string } | null | undefined;

const num = (v: number, digits = 0) => v.toLocaleString("en-US", { maximumFractionDigits: digits });
const METERS: Record<string, number> = { meters: 1, kilometers: 1000, centimeters: 0.01, millimeters: 0.001, feet: 0.3048 };
const SQ_METERS: Record<string, number> = { "square-meters": 1, "square-kilometers": 1e6, hectares: 1e4 };

function fmtLength(q: Quantity): string {
  if (!q) return "—";
  const m = q.value * (METERS[q.unit] ?? 1);
  return Math.abs(m) >= 1000 ? `${num(m / 1000, 3)} км` : `${num(m, 2)} м`;
}

function fmtArea(q: Quantity): string {
  if (!q) return "—";
  const m2 = q.value * (SQ_METERS[q.unit] ?? 1);
  return m2 >= 10000 ? `${num(m2 / 10000, 2)} га` : `${num(m2, 1)} м²`;
}

type Row = [string, string];

function rowsOf(kind: ToolKind, r: any): Row[] {
  if (!r) return [];
  if (kind === "line") {
    const h = r.horizontalDistance?.value ?? 0;
    const v = r.verticalDistance?.value ?? 0;
    return [
      ["Шууд зай", fmtLength(r.directDistance)],
      ["Хэвтээ зай", fmtLength(r.horizontalDistance)],
      ["Өндрийн зөрүү", fmtLength(r.verticalDistance)],
      ["Налуу", h > 0 ? `${num((Math.atan(Math.abs(v) / h) * 180) / Math.PI, 1)}°` : "—"],
    ];
  }
  if (kind === "area") return [["Талбай", fmtArea(r.area)], ["Периметр", fmtLength(r.perimeter)]];
  return [];
}

function makeAnalysis(kind: ToolKind): any {
  if (kind === "line") return new DirectLineMeasurementAnalysis({ unit: "meters" });
  if (kind === "area") return new AreaMeasurementAnalysis({ unit: "square-meters" });
  if (kind === "slice") return new SliceAnalysis();
  return new ElevationProfileAnalysis({
    displayUnits: { distance: "meters", elevation: "meters" },
    profiles: [
      { type: "scene", color: JADE },
      { type: "ground", color: "#a7ecd9" },
    ],
  } as never);
}

/** Олон янзын нэртэй цэгийн шошго энэ масштабаас ойртуулахад л гарна (2D-ийн zoom 16) */
const MANY_POINTS_SCALE = 9028;

/** Бүх давхаргад нэг загвар. 2D-ийн адил хоосон, 1-3 оронтой тоо, GUID-г гаргахгүй. */
const labelClass = (field: string, point: boolean, minScale: number) =>
  new LabelClass({
    labelExpressionInfo: {
      expression: `var t = Trim(Text($feature["${field}"])); IIF((Count(t) <= 3 && !IsNan(Number(t))) || (Count(t) >= 32 && Find(" ", t) < 0), "", t)`,
    },
    ...(point ? { labelPlacement: "above-center" } : {}),
    minScale,
    symbol: {
      type: "label-3d",
      symbolLayers: [{ type: "text", material: { color: "#f2fbf8" }, halo: { color: [7, 18, 15, 0.9], size: 1 }, font: { family: "Arial Unicode MS", weight: "bold" }, size: 8.5 }],
    },
  } as never);

const polyFill = (hex: string) => {
  const color = new Color(hex);
  color.a = 0.32;
  return { type: "simple-fill", color, outline: { color: hex, width: 1.2 } };
};

function makeLayer(lyr: MapLayer, where: string, paint?: PolyPaint, labelField?: string | null): Layer | null {
  const common = { id: lyr.id, url: lyr.url, title: lyr.title, opacity: lyr.opacity, visible: lyr.visible };
  if (lyr.kind === "tiled") return new TileLayer(common);
  if (lyr.kind === "dynamic") return new MapImageLayer(common);
  if (lyr.kind === "imagery") return new ImageryLayer(common);
  const drawing = lyr.drawingInfo as { renderer?: object } | null | undefined;
  const fields = lyr.popup?.fields ?? [];
  const layer = new FeatureLayer({
    ...common,
    definitionExpression: where,
    outFields: ["*"],
    ...(fields.length
      ? { popupTemplate: new PopupTemplate({ title: lyr.popup?.title ?? lyr.title, content: [{ type: "fields", fieldInfos: fields.map((f) => ({ fieldName: f.name, label: f.label })) }] }) }
      : { popupEnabled: false }),
  });
  try {
    if (paint) {
      layer.renderer = {
        type: "unique-value",
        field: paint.field,
        defaultSymbol: polyFill("#8a9a96"),
        uniqueValueInfos: [...paint.colors].map(([value, color]) => ({ value, symbol: polyFill(color) })),
      } as never;
    } else if (JSON.stringify(drawing?.renderer ?? "").includes("CIMPolygonSymbol")) {
      // 3D нь CIM талбайг зурж чаддаггүй
      layer.renderer = { type: "simple", symbol: polyFill(JADE) } as never;
    } else if (drawing?.renderer) {
      layer.renderer = rendererFromJSON(drawing.renderer) as FeatureLayer["renderer"];
    }
  } catch {
    // Тэмдэглэгээ нь 3D-д таарахгүй бол сервисийн өөрийнхийг хэрэглэнэ
  }
  layer.screenSizePerspectiveEnabled = false;
  // Цэг, шугам газраар биш, мэш, барилгын дээгүүр байрлана. Геометрийн Z-г хэрэглэхгүй: зарим сервист Z нь
  // далайн түвшний өндөр эсвэл 0 тул кабель агаарт хөвж, талбай газрын доор орж, хэмжилт буруу болдог.
  layer.when(async () => {
    layer.elevationInfo = (layer.geometryType === "polygon"
      ? { mode: "on-the-ground" }
      : { mode: "relative-to-scene", featureExpressionInfo: { expression: "0" } }) as never;
    // Шошгоны талбар 2D-ээс: Геомэдээллийн сан нь webmap, сервисийнхийг шууд авна
    const field = labelField !== undefined ? labelField : lyr.labelField ?? serviceLabelField((layer.sourceJSON ?? {}) as LayerInfo);
    layer.labelingInfo = null;
    if (!field || !layer.fields?.some((f) => f.name === field)) return;
    const point = layer.geometryType === "point";
    let minScale = 0;
    if (point) {
      const names = await layer
        .queryFeatures({ where, returnGeometry: false, groupByFieldsForStatistics: [field], outStatistics: [{ statisticType: "count", onStatisticField: field, outStatisticFieldName: "n" }] } as never)
        .then((r) => r.features.length, () => Infinity);
      if (names > 50) minScale = MANY_POINTS_SCALE;
    }
    layer.labelingInfo = [labelClass(field, point, minScale)];
    layer.labelsVisible = true;
  }, () => {});
  return layer;
}

function registerToken(layers: MapLayer[], token: string | null) {
  if (!token) return;
  const servers = new Set(["https://www.arcgis.com/sharing/rest"]);
  for (const lyr of layers) {
    const i = lyr.url.indexOf("/rest/services");
    if (i > 0 && lyr.url.includes(".arcgis.com")) servers.add(lyr.url.slice(0, i + "/rest/services".length));
  }
  for (const server of servers) esriId.registerToken({ server, token });
}

function ensureTheme() {
  if (document.getElementById("esri-theme")) return;
  const link = document.createElement("link");
  link.id = "esri-theme";
  link.rel = "stylesheet";
  link.href = `${esriConfig.assetsPath}/esri/themes/dark/main.css`;
  document.head.append(link);
}

const openScene = (id: string) => {
  const scene = new WebScene({ portalItem: { id } });
  scene.when(() => {
    if (scene.ground) scene.ground.surfaceColor = "#0b1a16" as never;
  }, () => {});
  return scene;
};

const findBim = (scene: WebScene): any => scene.allLayers.find((l) => l.type === "building-scene");

/** Сонгосон давхар бүрэн, доод нь тунгалаг, дээд нь нуугдана. `null` бол бүх барилга. */
function showLevel(bim: any, level: number | null) {
  bim.allSublayers.forEach((s: any) => {
    if (s.modelName === "FullModel") s.visible = true;
    if (s.modelName === "Overview") s.visible = false;
  });
  bim.activeFilterId = null;
  bim.filters.removeAll();
  if (level === null) return;
  const filter = new BuildingFilter({
    name: "Давхар",
    filterBlocks: [
      { title: "Сонгосон", filterExpression: `BldgLevel = ${level}`, filterMode: { type: "solid" } },
      { title: "Доод", filterExpression: `BldgLevel < ${level}`, filterMode: { type: "x-ray" } },
    ],
  } as never);
  bim.filters.add(filter);
  bim.activeFilterId = filter.id;
}

type BimLevel = { value: number; label: string };

/** BldgLevel (0, 1, 2…) ба нэр («Level - 2», «Level 1»…) хоёулаа өсөх дарааллаар тохирно. Дээд давхар эхэнд. */
async function readLevels(bim: any): Promise<BimLevel[]> {
  const stats = bim.summaryStatistics;
  await stats?.load();
  const fields: any[] = stats?.fields ?? [];
  const values: number[] = (fields.find((f) => f.fieldName === "BldgLevel")?.mostFrequentValues ?? []).map(Number).sort((a: number, b: number) => a - b);
  const names: number[] = (fields.find((f) => f.fieldName === "BldgLevel_Desc")?.mostFrequentValues ?? [])
    .map((d: string) => Number(String(d).replace(/[^\d-]/g, "")))
    .sort((a: number, b: number) => a - b);
  return values.map((value, i) => ({ value, label: `${names.length === values.length ? names[i] : value} давхар` })).reverse();
}

export type MapView2D = { lat: number; lng: number; zoom: number };

/** 2D-ийн харагдацтай ижил хэмжээг харуулах камер. `zoom` далайн түвшнээс бодогддог тул өндөр газарт камер гадаргад наалдана. */
const cameraFor = ({ lat, lng, zoom }: MapView2D, widthPx: number, heightPx: number) => {
  const rad = Math.PI / 180;
  // Камерын fov нь диагоналийн өнцөг
  const visible = ((156543 * Math.cos(lat * rad)) / 2 ** zoom) * Math.hypot(widthPx, heightPx);
  const distance = visible / 2 / Math.tan((START_FOV / 2) * rad);
  return new Camera({
    position: { longitude: lng, latitude: lat - (distance * Math.sin(START_TILT * rad)) / 111320, z: GROUND_Z + distance * Math.cos(START_TILT * rad) },
    heading: 0,
    tilt: START_TILT,
    fov: START_FOV,
  });
};

/** cameraFor-ын урвуу: 3D-ээс 2D руу буцахад ижил хэмжээ хадгална */
const zoomFor = (view: SceneView) => {
  const rad = Math.PI / 180;
  const { center, camera, width, height } = view;
  const lat = center.latitude ?? 0;
  const north = ((camera.position.latitude ?? 0) - lat) * 111320;
  const east = ((camera.position.longitude ?? 0) - (center.longitude ?? 0)) * 111320 * Math.cos(lat * rad);
  const up = (camera.position.z ?? 0) - (center.z ?? GROUND_Z);
  const visible = 2 * Math.hypot(north, east, up) * Math.tan((camera.fov / 2) * rad);
  return Math.log2((156543 * Math.cos(lat * rad) * Math.hypot(width, height)) / visible);
};

/** Газрын зургийн 3D харагдац: зай, талбай, зүсэлт, өндрийн профайл */
export default function Map3D({
  layers,
  token,
  start,
  onClose,
  filtersFor,
  filterKey,
  layerList = true,
  insetLeft = 0,
  polyPaint,
  labelOf,
  zoomTo,
}: {
  layers: MapLayer[];
  token: string | null;
  start: MapView2D;
  onClose: (view: MapView2D) => void;
  filtersFor?: (layerId: string) => RuntimeFilter[];
  filterKey?: string;
  layerList?: boolean;
  insetLeft?: number;
  polyPaint?: Map<string, PolyPaint>;
  labelOf?: Map<string, string | null>;
  zoomTo?: Extent4326 | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const rightHost = useRef<HTMLDivElement>(null);
  const viewRef = useRef<SceneView | null>(null);
  const rightRef = useRef<SceneView | null>(null);
  const ownLayers = useRef(new Set<string>());
  const session = useRef<{ abort: AbortController; analysis: any; watch: { remove: () => void } } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState("");
  const [tool, setTool] = useState<ToolKind | null>(null);
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [toolError, setToolError] = useState("");
  const [cutGround, setCutGround] = useState(true);
  const [sliceVertical, setSliceVertical] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [swipeOn, setSwipeOn] = useState(false);
  const [swipe, setSwipe] = useState(50);
  const [bimOpen, setBimOpen] = useState(false);
  const [levels, setLevels] = useState<BimLevel[]>([]);
  const [level, setLevel] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(layers.filter((l) => !l.visible).map((l) => l.id)));

  useEffect(() => {
    if (!host.current) return;
    ensureTheme();
    registerToken(layers, token);
    const map = openScene(SCENE_MESH);
    // EMC_Realistic scene-д basemap тохируулаагүй: mesh-ээс гадна хоосон хөх гардаг
    map.when(() => {
      map.basemap = Basemap.fromId("satellite")!;
    }, () => {});
    const view = new SceneView({
      container: host.current,
      map,
      camera: cameraFor(start, host.current.clientWidth, host.current.clientHeight),
      qualityProfile: "high",
      ui: { components: ["zoom", "compass", "navigation-toggle"], padding: { top: 10, left: 10 + insetLeft, right: 10, bottom: 10 } } as never,
      theme: new Theme({ accentColor: JADE, textColor: "#e8f5f1" } as never),
    });
    viewRef.current = view;
    view.when(
      () => {
        setReady(true);
      },
      (e: Error) => setFailed(e.message || "WebGL дэмжигдэхгүй байна"),
    );
    return () => {
      const center = view.center;
      if (center?.latitude != null && center.longitude != null) onClose({ lat: center.latitude, lng: center.longitude, zoom: zoomFor(view) });
      session.current?.abort.abort();
      session.current?.watch.remove();
      session.current = null;
      viewRef.current = null;
      view.destroy();
      map.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncLayers = (scene: WebScene | undefined) => {
    const wanted = new Set(layers.map((l) => l.id));
    // Scene ачаалахдаа давхаргаа дарж бичдэг тул дараа нь нэмнэ
    scene?.when(() => {
      scene.removeMany(scene.layers.filter((l) => ownLayers.current.has(l.id) && !wanted.has(l.id)).toArray());
      for (const lyr of layers) {
        ownLayers.current.add(lyr.id);
        if (scene.findLayerById(lyr.id)) continue;
        const layer = makeLayer(lyr, whereOf(lyr.definitionExpression, filtersFor?.(lyr.id) ?? []), polyPaint?.get(lyr.id), labelOf?.get(lyr.id));
        if (!layer) continue;
        layer.visible = !hidden.has(lyr.id);
        scene.add(layer);
      }
    }, () => {});
  };

  // Swipe: баруун талд хулгана хүрэхгүй (CSS), бүх удирдлага зүүн view-ээр явж, камер нь дагана.
  // Analysis нэг view-д л байж чадна: хэмжилтийн үед баруун талыг нууж, Mesh дээр хэмжинэ.
  useEffect(() => {
    const view = viewRef.current;
    if (!swipeOn || !view || !rightHost.current) return;
    const rightMap = openScene(SCENE_MULTIPATCH);
    const right = new SceneView({ container: rightHost.current, map: rightMap, camera: view.camera, qualityProfile: "high", ui: { components: [] } as never });
    right.popupEnabled = false;
    rightRef.current = right;
    const follow = reactiveUtils.watch(() => view.camera, (c) => {
      if (c) right.camera = c;
    });
    syncLayers(rightMap);
    if (session.current && tool === "slice" && cutGround) setHollowGround(true);
    return () => {
      follow.remove();
      rightRef.current = null;
      right.destroy();
      rightMap.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swipeOn]);

  // Аймаг, сум сонгоход тухайн хил рүү очно
  useEffect(() => {
    if (!zoomTo) return;
    viewRef.current?.goTo({ target: new Extent({ ...zoomTo, spatialReference: { wkid: 4326 } }).expand(1.3), tilt: START_TILT }).catch(() => {});
  }, [zoomTo]);

  // BIM-ийн давхар: swipe-ийн баруун талд ч адил
  useEffect(() => {
    for (const view of [viewRef.current, rightRef.current]) {
      const scene = view?.map as WebScene | undefined;
      scene?.when(() => {
        const bim = findBim(scene);
        bim?.when(() => showLevel(bim, level), () => {});
      }, () => {});
    }
  }, [level, swipeOn]);

  // Давхаргын жагсаалт өөрчлөгдвөл нэмж, хасна
  const layerIds = layers.map((l) => l.id).join("|");
  useEffect(() => {
    registerToken(layers, token);
    for (const view of [viewRef.current, rightRef.current]) syncLayers(view?.map as WebScene | undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerIds, token]);

  // Дашбоардын шүүлтүүр
  useEffect(() => {
    if (!filtersFor) return;
    for (const view of [viewRef.current, rightRef.current]) {
      for (const lyr of layers) {
        const layer = view?.map?.findLayerById(lyr.id);
        if (layer instanceof FeatureLayer) layer.definitionExpression = whereOf(lyr.definitionExpression, filtersFor(lyr.id));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const stop = () => {
    const view = viewRef.current;
    const cur = session.current;
    if (cur) {
      cur.abort.abort();
      cur.watch.remove();
      view?.analyses.remove(cur.analysis);
      session.current = null;
    }
    if (view) view.popupEnabled = true;
    setHollowGround(false);
    setPlacing(false);
    setResult(null);
    setToolError("");
  };

  const begin = async (kind: ToolKind) => {
    const view = viewRef.current;
    if (!view) return;
    stop();
    setTool(kind);
    setPlacing(true);
    view.popupEnabled = false;
    view.closePopup?.();
    const analysis = makeAnalysis(kind);
    if (kind === "slice") {
      analysis.excludeGroundSurface = !cutGround;
      setHollowGround(cutGround);
    }
    view.analyses.add(analysis);
    const abort = new AbortController();
    const mine = { abort, analysis, watch: { remove: () => {} } };
    session.current = mine;
    try {
      const analysisView: any = await view.whenAnalysisView(analysis);
      if (session.current !== mine) return;
      const read = () =>
        kind === "profile"
          ? {
              updating: analysisView.updating,
              results: analysisView.results?.map((r: any) => ({ type: r.profile?.type, samples: r.samples, statistics: r.statistics })) ?? [],
            }
          : { value: analysisView.result, error: analysisView.error };
      mine.watch = reactiveUtils.watch(read, (next: any) => {
        setResult(kind === "profile" ? next : next.value);
        setToolError(next.error ? "Энэ байрлалд тооцоолох боломжгүй байна" : "");
      }, { initial: true });
      await analysisView.place({ signal: abort.signal });
      if (session.current === mine) {
        setPlacing(false);
        if (kind === "slice") orientSlice(analysis, sliceVertical);
      }
    } catch (e) {
      if (session.current === mine && (e as Error).name !== "AbortError") {
        setToolError((e as Error).message);
        setPlacing(false);
      }
    }
  };

  const closeTool = () => {
    stop();
    setTool(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && session.current) closeTool();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleBim = () => {
    const next = !bimOpen;
    setBimOpen(next);
    if (!next) return;
    viewRef.current?.goTo({ target: new Extent(ABK_EXTENT).expand(2.5), tilt: 60 }).catch(() => {});
    const scene = viewRef.current?.map as WebScene | undefined;
    scene?.when(() => {
      const bim = findBim(scene);
      bim?.when(() => readLevels(bim).then(setLevels, () => setLevels([])), () => {});
    }, () => {});
  };

  const toggleLayer = (id: string) => {
    let visible = true;
    for (const view of [viewRef.current, rightRef.current]) {
      const layer = view?.map?.findLayerById(id);
      if (!layer) continue;
      layer.visible = !layer.visible;
      visible = layer.visible;
    }
    setHidden((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Swipe-ийн шугамыг чирнэ. Зүүн талын удирдлагын товчийг бүрхэхгүй. */
  const dragSwipe = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.min(box.width - 20, Math.max(56 + insetLeft, ev.clientX - box.left));
      setSwipe((x / box.width) * 100);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  /** Тавьсан хавтгайг босоо (камер руу харсан) эсвэл хэвтээ болгоно */
  const orientSlice = (analysis: any, vertical: boolean) => {
    const plane = analysis.shape;
    const view = viewRef.current;
    if (!plane || !view) return;
    analysis.shape = new SlicePlane({
      position: plane.position,
      width: plane.width,
      height: plane.height,
      heading: vertical ? view.camera.heading : plane.heading,
      tilt: vertical ? 90 : 0,
    });
  };

  const setSliceOrientation = (vertical: boolean) => {
    setSliceVertical(vertical);
    if (session.current && tool === "slice") orientSlice(session.current.analysis, vertical);
  };

  /** Газар зүсэгдэхэд агаар мандлын манан нүхийг цагаанаар дүүргэдэг тул тэр үед унтраана */
  const setHollowGround = (hollow: boolean) => {
    for (const view of [viewRef.current, rightRef.current]) {
      const environment = view?.environment;
      if (!environment) continue;
      environment.atmosphereEnabled = !hollow;
      environment.starsEnabled = !hollow;
      environment.background = (hollow ? { type: "color", color: "#0b1a16" } : null) as never;
    }
  };

  const setSliceGround = (cut: boolean) => {
    setCutGround(cut);
    if (session.current && tool === "slice") {
      session.current.analysis.excludeGroundSurface = !cut;
      setHollowGround(cut);
    }
  };

  const meta = TOOLS.find((t) => t.kind === tool);
  const rows = tool ? rowsOf(tool, result) : [];
  const profile = useMemo(() => {
    if (tool !== "profile" || !result?.results?.length) return null;
    const usable = result.results.filter((r: any) => r.samples?.some((s: any) => Number.isFinite(s.elevation)));
    const best = usable.find((r: any) => r.type === "scene") ?? usable[0];
    if (!best) return null;
    const clean = best.samples.filter((s: any) => Number.isFinite(s.elevation));
    const step = Math.max(1, Math.floor(clean.length / 300));
    const points = clean.filter((_: unknown, i: number) => i % step === 0).map((s: any) => ({ d: s.distance, e: s.elevation }));
    return { points, stats: best.statistics, scene: best.type === "scene" };
  }, [tool, result]);

  return (
    <div className="map3d">
      <div ref={host} className="map3d-view" />
      <div ref={rightHost} className="map3d-view map3d-right" style={{ clipPath: `inset(0 0 0 ${swipeOn && !tool ? swipe : 100}%)` }} />
      {ready && !failed && swipeOn && !tool && (
        <div className="map3d-swipe" style={{ left: `${swipe}%` }} onPointerDown={dragSwipe} role="separator" aria-label="Mesh, Multipatch харьцуулах шугам">
          <b aria-hidden>‹›</b>
          <em className="l">Mesh</em>
          <em className="r">Multipatch</em>
        </div>
      )}
      {failed && <div className="map3d-failed">3D нээгдсэнгүй: {failed}</div>}
      {ready && !failed && (
        <div className="map3d-side">
          <div className="map3d-tools" role="toolbar" aria-label="3D хэрэгсэл">
            {TOOLS.map((t) => (
              <button key={t.kind} className={tool === t.kind ? "on" : ""} title={t.title} onClick={() => (tool === t.kind ? closeTool() : begin(t.kind))}>
                <svg viewBox="0 0 24 24" aria-hidden><path d={ICON[t.kind]} /></svg>
                <span>{t.label}</span>
              </button>
            ))}
            <i />
            <button className={swipeOn ? "on" : ""} title="Mesh, Multipatch-ийг шугамаар харьцуулах" onClick={() => setSwipeOn(!swipeOn)}>
              <svg viewBox="0 0 24 24" aria-hidden><path d={ICON.swipe} /></svg>
              <span>Swipe</span>
            </button>
            <button className={bimOpen || level !== null ? "on" : ""} title="АБК барилга (BIM): очих, давхраар харах" onClick={toggleBim}>
              <svg viewBox="0 0 24 24" aria-hidden><path d={ICON.building} /></svg>
              <span>BIM</span>
            </button>
            {layerList && layers.length > 0 && (
              <button className={layersOpen ? "on" : ""} title="Давхарга" onClick={() => setLayersOpen(!layersOpen)}>
                <svg viewBox="0 0 24 24" aria-hidden><path d={ICON.layers} /></svg>
                <span>Давхарга</span>
              </button>
            )}
          </div>
          <div className="map3d-cards">
          {bimOpen && (
            <div className="map3d-card map3d-levels">
              <header>
                <b>АБК: давхар</b>
                <button className="x" title="Хаах" aria-label="Хаах" onClick={() => setBimOpen(false)}>×</button>
              </header>
              <button className={level === null ? "on" : ""} onClick={() => setLevel(null)}>Бүх барилга</button>
              {levels.map((l) => (
                <button key={l.value} className={level === l.value ? "on" : ""} onClick={() => setLevel(l.value)}>{l.label}</button>
              ))}
            </div>
          )}
          {layersOpen && (
            <div className="map3d-card">
              <header><b>Давхарга</b></header>
              {layerList && layers.map((l) => (
                <label key={l.id} title={l.title}><input type="checkbox" checked={!hidden.has(l.id)} onChange={() => toggleLayer(l.id)} />{l.title}</label>
              ))}
            </div>
          )}
          {meta && (
            <div className="map3d-card">
              <header>
                <b>{meta.title}</b>
                <button className="x" title="Хаах (Esc)" aria-label="Хаах" onClick={closeTool}>×</button>
              </header>
              {placing && <p className="hint">{meta.hint}</p>}
              {toolError && <p className="err">{toolError}</p>}
              {rows.length > 0 && (
                <dl>
                  {rows.map(([k, v]) => (
                    <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                  ))}
                </dl>
              )}
              {tool === "slice" && (
                <div className="seg">
                  <button className={sliceVertical ? "on" : ""} onClick={() => setSliceOrientation(true)}>Босоо</button>
                  <button className={sliceVertical ? "" : "on"} onClick={() => setSliceOrientation(false)}>Хэвтээ</button>
                </div>
              )}
              {tool === "slice" && (
                <label className="check"><input type="checkbox" checked={cutGround} onChange={(e) => setSliceGround(e.target.checked)} />Газрын гадаргыг зүсэх</label>
              )}
              <button className="again" onClick={() => begin(meta.kind)}>Шинээр эхлэх</button>
            </div>
          )}
          </div>
        </div>
      )}
      {tool === "profile" && profile && (
        <div className="map3d-profile">
          <div className="stats">
            <span><em>Урт</em>{num(profile.stats?.maxDistance ?? 0, 0)} м</span>
            <span><em>Хамгийн бага</em>{num(profile.stats?.minElevation ?? 0, 1)} м</span>
            <span><em>Хамгийн их</em>{num(profile.stats?.maxElevation ?? 0, 1)} м</span>
            <span><em>Өгсөлт</em>{num(profile.stats?.elevationGain ?? 0, 1)} м</span>
            <span><em>Уруудалт</em>{num(profile.stats?.elevationLoss ?? 0, 1)} м</span>
            <span className="src">{profile.scene ? "Мэш, барилгатай гадарга" : "Газрын өндрийн загвар"}</span>
          </div>
          <div className="plot">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={profile.points} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="map3d-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={JADE} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={JADE} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="d" type="number" domain={["dataMin", "dataMax"]} stroke="var(--axis)" tick={{ fill: "var(--text-secondary)", fontSize: 10 }} tickFormatter={(v: number) => `${num(v)} м`} tickLine={false} minTickGap={40} />
                <YAxis domain={["auto", "auto"]} width={50} stroke="var(--axis)" tick={{ fill: "var(--text-secondary)", fontSize: 10 }} tickFormatter={(v: number) => num(v)} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--axis)", fontSize: 12 }}
                  labelFormatter={(v) => `Зай: ${num(Number(v))} м`}
                  formatter={(v) => [`${num(Number(v), 1)} м`, "Өндөр"]}
                />
                <Area type="monotone" dataKey="e" stroke={JADE} strokeWidth={1.5} fill="url(#map3d-fill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
