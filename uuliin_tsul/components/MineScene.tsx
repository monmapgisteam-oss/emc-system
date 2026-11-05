"use client";

/* ==========================================================================
   ArcGIS SceneView — бүхэлдээ browser талд ажиллана.
   page.tsx-ээс  dynamic(..., { ssr: false })  -ээр дуудагдана.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Map from "@arcgis/core/Map";
import Basemap from "@arcgis/core/Basemap";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import DirectLineMeasurement3D from "@arcgis/core/widgets/DirectLineMeasurement3D";
import AreaMeasurement3D from "@arcgis/core/widgets/AreaMeasurement3D";
import Expand from "@arcgis/core/widgets/Expand";
import SceneView from "@arcgis/core/views/SceneView";
import SliceAnalysis from "@arcgis/core/analysis/SliceAnalysis";
import SlicePlane from "@arcgis/core/analysis/SlicePlane";
import VirtualLighting from "@arcgis/core/views/3d/environment/VirtualLighting";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import IntegratedMeshLayer from "@arcgis/core/layers/IntegratedMeshLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import TileLayer from "@arcgis/core/layers/TileLayer";
import ElevationLayer from "@arcgis/core/layers/ElevationLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Mesh from "@arcgis/core/geometry/Mesh";
import Point from "@arcgis/core/geometry/Point";
import * as wmUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import * as geodeticDensifyOperator from "@arcgis/core/geometry/operators/geodeticDensifyOperator";
import Polyline from "@arcgis/core/geometry/Polyline";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import { executeForIds, executeQueryJSON } from "@arcgis/core/rest/query";
import esriConfig from "@arcgis/core/config";

import { useStore } from "@/lib/store";
import { MON_L } from "@/lib/i18n";
import {
  SVC, C, COL_NAMES, ELEV_URL, GROUND_OPACITY, GROUND_NM,
  BU_TYPE, BLD_COLOR, PILE_COLOR, PILE_HEX, PILE_EDGE, PILE_EDGE_HEX,
  PILE2COL, TRUCK_COLOR, pileWhere, PIT_SVC,
} from "@/lib/config";
import { cuOf, metalSum, moOf, sumCol } from "@/lib/excel";
import {
  loadDests, loadParked, loadTailLine, FlowSim,
  type Dest, type Truck,
} from "@/lib/flow";
import { fmt, hex, num1 } from "@/lib/format";
import { createTailings, type TailingsFlow } from "@/lib/tailings";
import {
  BLOCK_TEXT, NO_SLICE, blockAt, buildBlockMesh, loadBlockData,
  type BlockData, type BlockModelMeta, type BlockSlice,
  blockDetail,
} from "@/lib/blockModel";
import { MONTH_COLORS, paintMonths, pitColors, type PitColors } from "@/lib/pitSurface";
import { fetchPitMesh, loadPitGrid, type PitGrid } from "@/lib/pitSource";
import { compileHazardZones, hazardLevelAt, type HazardIndex } from "@/lib/hazards";
import { createHazardAlerts, type HazardAlerts } from "@/lib/hazardAlerts";
import { buildTruckTelemetry, type TruckTelemetry, type TerrainElevationSample } from "@/lib/truckTelemetry";
import { placeExcavators } from "@/lib/excavators";
import { loadImGround, type GroundSampler } from "@/lib/imGround";
import BlockLegend, { BlockSlicePanel } from "./BlockLegend";
import TruckTelemetryStrip from "./TruckTelemetryStrip";
import TailingsInspector from "./TailingsInspector";

/** @arcgis/core-ийн assets-ыг node_modules-оос хуулахгүйгээр CDN-ээс авна */
esriConfig.assetsPath = "https://js.arcgis.com/4.34/@arcgis/core/assets";

/* «Зөвхөн уурхай» горимд тээврийн замыг сарын мэш дээр наах тохиргоо.
   ROAD_STEP: замын цэгүүдийн хоорондох хамгийн их зай. Мэшийн тор 5 м
   тул түүнээс нягт авбал зам шатлалыг огтлохгүй дагана.
   ROAD_LIFT: мэшийн гадаргуугаас дээш өргөх өндөр. Яг гадаргуу дээр
   зурвал шугам мэштэй гүнээрээ тэнцэж тасархай харагдана. */
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];
/** Аюулын түвшин 1/2/3-ын өнгө (HAZARD_MAP сервисийн өнгөнөөс) */
const HAZARD_COLORS = ["#8bd12f", "#f5a524", "#e8413a"];
const ROAD_STEP = 4;      // м
/* Блокийн оройн өнгийг (Cu ангилал) цагаанаар үржүүлж хэвээр харуулна;
   нимгэн бараан ирмэг нь 5 м-ийн нүд бүрийг ялгана. */
const BLOCK_SYMBOL = {
  type: "mesh-3d",
  symbolLayers: [{ type: "fill",
    material: { color: [255, 255, 255, 1], colorMixMode: "multiply" },
    edges: { type: "solid", color: [10, 18, 26, 0.45], size: 0.5 } }],
} as any;
const ROAD_LIFT = 1.5;    // м
const TAIL_DEPTH = 30;     // төв тэнхлэгийн гүн, м (гадаргуугаас доош)
const PIPE_D = 2;          // хоолойн диаметр, м

interface MeshInfo { url: string; lon: number; lat: number; z: number }
type HeightSampler = (lon: number, lat: number) => number;

/** WGS84-ийн муруйлтын радиусаар lon/lat-ийн нэг градусын метр (зүүн, хойд) */
function enuScale(lat: number): [number, number] {
  const A = 6378137, E2 = 0.00669437999014, R = Math.PI / 180;
  const sl = Math.sin(lat * R), w = 1 - E2 * sl * sl;
  return [R * (A / Math.sqrt(w)) * Math.cos(lat * R), R * (A * (1 - E2) / (w * Math.sqrt(w)))];
}

/**
 * Контейнерийн өндөр хоёр кадр дараалан тогтвортой болтол хүлээнэ.
 *
 * SceneView үүсэх агшинд контейнер нь 0 өндөртэй байвал ArcGIS анхны
 * кадраа хоосноор зурдаг. React-ийн hydration + dynamic import дуусах үед
 * grid-ийн байрлал хараахан суугаагүй байж болзошгүй тул хэмжээ суусны
 * ДАРАА л view үүсгэнэ.
 */
function waitStableSize(el: HTMLElement, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };

    /* Хамгаалалт нь rAF-ээс ГАДНА байх ёстой. Хэрэв rAF ажиллахгүй бол
       (арын таб, headless орчин) rAF доторх шалгалт хэзээ ч биелэхгүй тул
       газрын зураг мөнхөд «ачаалж байна» гэж үлдэнэ. */
    const guard = setTimeout(finish, timeoutMs);

    let last = -1, same = 0;
    const tick = () => {
      if (done) return;
      const h = el.clientHeight, w = el.clientWidth;
      if (h > 0 && w > 0 && h === last) {
        if (++same >= 2) { clearTimeout(guard); return finish(); }
      } else {
        same = 0;
      }
      last = h;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export default function MineScene() {
  const store = useStore();
  const { m, setM, lang, t, toggleDest, clearAll, setTip, setSel, mapMax, setMapMax } = store;

  const divRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<SceneView | null>(null);
  const mapRef = useRef<Map | null>(null);
  const layersRef = useRef<Record<string, any>>({});
  const meshLoad = useRef<Record<number, Promise<Mesh | null>>>({});
  /* Сарын гадаргуугийн өнгө (байгалийн + өөрчлөлт) — нэг удаа тооцно */
  const pitColorCache = useRef<Record<number, PitColors>>({});
  /* «Нийт» горим: сар бүрийн өөрчлөлтийн маск ба тэдгээрээр будсан өнгө */
  const allMasks = useRef<Promise<{ month: number; mask: Set<number> }[]> | null>(null);
  const pitAllCache = useRef<Record<number, Uint8Array>>({});
  /* Сар бүрийн мэш дээр наасан замын геометр (тооцоо удаан тул нэг удаа) */
  const roadIsoCache = useRef<Record<number, Promise<Polyline[]>>>({});
  const heightGridCache = useRef<Record<number, Promise<HeightSampler | null>>>({});
  const telemetryTerrain = useRef<{ month: number; sample: HeightSampler | null } | null>(null);
  /* «Зөвхөн уурхай» горим асаалттай эсэх — ArcGIS-ийн watch дотор
     React-ийн төлөв хуучирдаг тул ref-ээр уншина */
  const isoRef = useRef(false);
  const bldCache = useRef<Record<string, any>>({});
  const meshInfo = useRef<Record<string, MeshInfo>>({});
  /** Бодит мэшийн шүүсэн газрын тор — ачаалагдвал машин түүн дээр байрлана */
  const imGround = useRef<GroundSampler | null>(null);
  /** Питийн мэшийн эх цэг ба 5 м-ийн тор — AGOL-оос татсан гадаргууг үүн дээр буулгана */
  const pitGrid = useRef<PitGrid | null>(null);
  const blockInfo = useRef<BlockModelMeta | null>(null);
  const blockCache = useRef<Record<number, Promise<BlockData>>>({});
  const blockReq = useRef(0);
  const blockFrame = useRef<number | null>(null);
  /* Сонгогдсон сар / хэл нь event handler дотор шинэ утгаараа хэрэгтэй */
  const stateRef = useRef({ m, lang, t, mapMax });
  stateRef.current = { m, lang, t, mapMax };
  const clearHover = useRef<(() => void) | null>(null);

  const [ready, setReady] = useState(false);
  /* Газрын зургийн зүүн дээд буланд (суурь зургийн дүрсийн доор) суух
     товчнуудын сав. ArcGIS-ийн UI-д `view.ui.add`-аар нэмж, доторх
     товчнуудыг React portal-аар зурна. Компонент зөвхөн хөтөч дээр
     ажилладаг (ssr: false) тул `document` бэлэн байна. */
  const [btnHost] = useState(() => {
    const d = document.createElement("div");
    d.className = "mapbtns esri-component";
    return d;
  });
  /* Блокийн зүсэлтийн самбарын сав — Esri Expand-ийн агуулга, React portal-аар зурна */
  const [sliceHost] = useState(() => document.createElement("div"));
  const sliceExpand = useRef<Expand | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [hasBlocks, setHasBlocks] = useState(false);
  const [blkSlice, setBlkSlice] = useState<BlockSlice>(NO_SLICE);
  /* Гадаргуугийн өөрчлөлт: унтраалттай / өмнөх сараас / бүх сарын нийт */
  const [pitChange, setPitChange] = useState<"off" | "month" | "all">("month");
  const [changeHa, setChangeHa] = useState<number | null>(null);
  const [allChg, setAllChg] = useState<{ total: number; byMonth: Record<number, number> } | null>(null);
  const blkRef = useRef({ slice: blkSlice, change: pitChange });
  blkRef.current = { slice: blkSlice, change: pitChange };
  const [layersOpen, setLayersOpen] = useState(false);
  const [groundStep, setGroundStep] = useState(0);
  const [tailInspect, setTailInspect] = useState(false);
  const [tailStatus, setTailStatus] = useState<"loading" | "ready" | "error">("loading");
  const [tailTransparency, setTailTransparency] = useState(0);
  const [tailSliced, setTailSliced] = useState(false);
  const tailSlice = useRef<SliceAnalysis | null>(null);
  const tailFocusRequest = useRef(0);
  const tailTransparencyRef = useRef(tailTransparency);
  tailTransparencyRef.current = tailTransparency;
  const tailInspection = useRef<{
    camera: SceneView["camera"]; groundOpacity: number; tailsVisible: boolean;
  } | null>(null);
  const [pitUrl, setPitUrl] = useState("");
  const [pitMsg, setPitMsg] = useState<{ text: string; cls: string }>({ text: "", cls: "" });
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [hazardStatus, setHazardStatus] = useState<"loading" | "ready" | "error">("loading");
  const hazardStatusRef = useRef(hazardStatus);
  hazardStatusRef.current = hazardStatus;
  const [truckTelemetry, setTruckTelemetry] = useState<TruckTelemetry[]>([]);
  const [selectedTruck, setSelectedTruck] = useState<number | null>(null);
  const truckFocusRequest = useRef(0);
  const hazardZones = useRef<HazardIndex>([]);
  const hazardAlerts = useRef<HazardAlerts | null>(null);
  const hazardAbort = useRef<AbortController | null>(null);
  const flowFrame = useRef<number | null>(null);
  const simRef = useRef<FlowSim | null>(null);
  const destsRef = useRef<Dest[]>([]);
  const parkedRef = useRef<Truck[]>([]);
  /* Байнгын Graphic обьектууд — давталт бүрт ДАХИН ҮҮСГЭХГҮЙ (анивчихаас сэргийлнэ) */
  const truckGfx = useRef<Graphic[]>([]);
  const truckKey = useRef<string[]>([]);
  const excavatorGfx = useRef<Graphic[]>([]);
  const excavatorScale = useRef(0);
  const prevBasemap = useRef<Basemap | null>(null);
  const prevEnvironment = useRef<Pick<SceneView["environment"],
    "background" | "lighting" | "atmosphereEnabled" | "starsEnabled"> | null>(null);
  const tailFlow = useRef<TailingsFlow | null>(null);
  const tailAbort = useRef<AbortController | null>(null);

  /* --------------------------------------------------------- эхлүүлэх */
  useEffect(() => {
    if (!divRef.current || viewRef.current) return;
    let cancelled = false;
    let disposed: (() => void) | null = null;

    waitStableSize(divRef.current).then(() => {
      if (cancelled || viewRef.current) return;
      disposed = init();
    });

    function init() {
    let disposeHover: (() => void) | undefined;

    /** Одоогийн өнгөний горим. `data-theme` байхгүй бол ҮС-ийн тохиргоо. */
    const isDark = () => {
      const a = document.documentElement.getAttribute("data-theme");
      if (a === "dark") return true;
      if (a === "light") return false;
      return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    };

    /* Esri-гийн СОНГОДОГ (растер) суурь зургууд — API key шаарддаггүй.
       Вектор хувилбарууд (…-vector) түлхүүр шаарддаг тул орсонгүй. */
    const BM_IDS = ["satellite", "hybrid", "topo", "streets", "gray",
                    "dark-gray", "terrain", "oceans", "osm",
                    "national-geographic"];

    const L = layersRef.current;

    /* ТЭЭВРИЙН ЗАМ — машин яг үүгээр явна (Road_truck_SL, 32 шугам, 76 км).
       Өмнөх хоёр давхаргыг бүрмөсөн орлоно: `Engineering_EMC/22` (CAD-ийн
       зурган давхарга, граф болдоггүй) ба `Road_truck`.
       Сервисийн өөрийн дүрслэл нимгэн саарал тул уншигдахуйц болгов. */
    L.roadNet = new FeatureLayer({
      url: SVC.roadTruck, title: "road-net", popupEnabled: false,
      /* `on-the-ground` БИШ. Тэр нь ArcGIS-ийн дэлхийн DEM-д шаддаг ба
         энэ талбайд DEM бараг хавтгай ≈1310 м. Ил уурхайн дотор бодит
         гадаргуу 200 м гүн тул зам питийн ханан дээр агаарт зурагдаж,
         машин (бодит мэш дээр явдаг) замаас хол зайд байх мэт харагдаж
         байв. Хоёулаа НЭГ гадаргуу дээр байх ёстой. */
      elevationInfo: { mode: "relative-to-scene", offset: 0 },
      /* Анхдагчаар УНТРААЛТТАЙ — зурган дээр хиймэл өнгөт зураас
         илүүдэж, хиймэл дагуулын зурган дээрх жинхэнэ замыг халхалдаг.
         Машин энэ сүлжээгээр л явна; «Давхарга»-аас асааж болно. */
      visible: false,
    });

    L.dam = new FeatureLayer({
      url: SVC.dam, title: "dam", outFields: ["Date"], popupEnabled: false,
      elevationInfo: { mode: "on-the-ground" },
      /* Далангийн сервис 2024/01-ээс эхэлдэг — 2023 оны мөр байхгүй */
      definitionExpression: "Date = '2024/01'",
    });

    /* АЮУЛЫН БҮСИЙН ЗУРАГ — `code` 1/2/3. Сервисийн өнгийг (ногоон, улбар
       шар, улаан) хадгалаад хагас тунгалаг дүүргэлт + тод хүрээ болгов —
       доорх уурхайн зураг уншигдана. Анхдагчаар УНТРААЛТТАЙ. */
    L.hazard = new FeatureLayer({
      url: SVC.hazard, title: "hazard", outFields: ["code", "Name", "Shape__Area"],
      popupEnabled: false, visible: false,
      elevationInfo: { mode: "on-the-ground" },
      renderer: {
        type: "unique-value", field: "code",
        uniqueValueInfos: HAZARD_COLORS.map((c, i) => ({
          value: i + 1,
          symbol: { type: "simple-fill", color: hex(c, 0.34),
                    outline: { color: hex(c, 0.95), width: 1.6 } },
        })),
      } as any,
    });

    /* Рендерерийг ДАРАХГҮЙ — сервис дээрх өөрийнх нь симбологи ажиллана:
       type1 "1" -> бүдэг шар (БҮ) · "2" -> цагаан (энгийн барилга).
       Утга нь ТЭМДЭГТ МӨР хэлбэртэй тул тоогоор дарж бичих гэж оролдвол
       бүх барилга defaultSymbol рүү унаж саарал болно. */
    L.bld = new SceneLayer({ url: SVC.bld, title: "buildings", popupEnabled: false });

    L.pile2d = new FeatureLayer({
      url: SVC.pile2d, title: "pile-2d", outFields: ["dugaar", "NAME"],
      popupEnabled: false, elevationInfo: { mode: "on-the-ground" },
      definitionExpression: pileWhere("dugaar"),
      /* Овоолго тутамд ЯГ НЭГ полигон — тунгалаг байдал давхарлахгүй тул
         бүх овоолго ижил хэмжээгээр нэвт харагдана. */
      labelsVisible: true,
      labelingInfo: [{
        labelExpressionInfo: { expression: "$feature.dugaar" },
        labelPlacement: "above-center",
        symbol: {
          type: "label-3d",
          symbolLayers: [{
            type: "text", size: 9,
            material: { color: [232, 245, 241, 1] },
            halo: { color: [7, 18, 15, 0.85], size: 1.2 },
            font: { family: "sans-serif", weight: "bold" },
          }],
          verticalOffset: { screenLength: 20, maxWorldLength: 600, minWorldLength: 24 },
          callout: { type: "line", size: 0.8, color: [232, 245, 241, 0.55] },
        },
      }] as any,
    });

    /**
     * Өнгөний горимоос хамаарах рендерерүүд.
     *
     * ArcGIS-ийн симбол өнгөө ҮҮСЭХ АГШИНД авдаг тул өдөр/шөнө солиход
     * өөрөө шинэчлэгддэггүй. Тиймээс тэдгээрийг энд төвлөрүүлж, горим
     * солигдох бүрт дахин тавина (store.tsx-аас `emc-theme` эвент ирнэ).
     * Овоолгын 3D ба барилгын давхарга энд ОРООГҮЙ — тэдний рендерерийг
     * дарахгүй, сервисийн өөрийнхөөр нь үлдээнэ.
     */
    function applyTheme() {
      const d = isDark();
      L.roadNet.renderer = {
        type: "simple",
        /* Нарийн шугам. Урьд нь 7 px байсан нь маршрутын өнгөт шугамын
           «хүрээ» болох зорилготой байсан ба тэр давхарга хасагдсан тул
           одоо шаардлагагүй — зузаан шугам зурган дээр давамгайлдаг. */
        symbol: { type: "simple-line", width: 2, cap: "round", join: "round",
                  color: hex(d ? "#e8d9a8" : "#7a6636", 0.85) },
      } as any;
      L.roadIso?.graphics.forEach((g: Graphic) => { g.symbol = roadSymbol(); });
      L.dam.renderer = {
        type: "simple",
        symbol: { type: "simple-fill", color: hex(d ? "#4b93a2" : "#3f7f8c", 0.42),
                  outline: { color: hex(d ? "#7fd4e6" : "#12525f", 1), width: 2.5 } },
      } as any;
      /* Овоолгын ГАДНА тойрог — улаан, өнгөний горимоос үл хамаарна.
         Бүх овоолго нэг хул шар өнгөтэй болсон тул зөвхөн энэ зураас ба
         нэрийн шошго л тэднийг бие биеэс нь ялгана. */
      /* Хул шар дүүргэлт + УЛААН гадна тойрог. Овоолгуудыг өнгөөр нь
         ялгахгүй — улаан хил ба нэрийн шошго ялгана. */
      L.pile2d.renderer = {
        type: "simple",
        symbol: {
          type: "simple-fill",
          color: [PILE_COLOR[0], PILE_COLOR[1], PILE_COLOR[2], 0.3],
          outline: { color: PILE_EDGE, width: 1 },
        },
      } as any;
    }
    applyTheme();
    window.addEventListener("emc-theme", applyTheme);

    /* Овоолгын 3D эзэлхүүн — анхдагчаар УНТРААЛТТАЙ.
       Сервист овоолго бүр олон битүү блокоос бүрдэнэ (Овоолго 12 — 20,
       Овоолго 9 — 19, харин Овоолго 1 — 1). Тунгалаг байдал давхарлахад
       үржигддэг тул (харагдах хувь = (1−α)^2N) нэг α-гаар ЖИГД тунгалаг
       болгох боломжгүй: α = 0.34 үед Овоолго 1 нь 44 %, Овоолго 12 нь
       0.03 % нэвт харагдана. Тиймээс овоолгыг ДООРХ 2D мөрөөр — овоолго
       тутамд ЯГ НЭГ гадаргуугаар — үзүүлнэ. Бодит 3D хэлбэрийг нь
       фотограмметрийн мэш аль хэдийн харуулж байна.
       Хэрэгтэй бол «Давхарга»-аас асааж болно. */
    L.pile3d = new SceneLayer({
      url: SVC.pileScene, title: "pile-3d", outFields: ["RefName", "NAME"],
      popupEnabled: false, definitionExpression: pileWhere("RefName"),
      visible: false, opacity: 0.34,
      renderer: {
        type: "simple",
        symbol: {
          type: "mesh-3d",
          symbolLayers: [{
            type: "fill",
            material: { color: PILE_COLOR, colorMixMode: "replace" },
          }],
        },
      } as any,
    });

    /* Ил уурхайн БОДИТ гадаргуу (фотограмметр). Гараар зассан DWG-ийн
       сарын мэшийг ОРЛОХГҮЙ — хоёулаа хэрэгтэй:
         · энэ нь бодит харагдац, машин үүн дээр явна;
         · DWG-ийн сарын мэш нь I–VI сарын ӨӨРЧЛӨЛТИЙГ харуулна
           («Зөвхөн уурхай» горимд бараан дэвсгэр дээр гарна). */
    L.im = new IntegratedMeshLayer({ url: SVC.pitMesh3d, title: "pit-reality-mesh" });

    L.pitMesh = new GraphicsLayer({
      title: "pit-mesh", elevationInfo: { mode: "absolute-height" }, visible: false,
    });
    /* «Зөвхөн уурхай» горимын тээврийн зам. Сарын DWG мэш нь энгийн
       графикийн давхарга тул `relative-to-scene` түүнийг харгалздаггүй.
       Бодит мэш нуугдахад зам үл үзэгдэх газрын DEM (≈1310 м) дагаж
       питийн дээгүүр хөвж байв. Иймээс замын цэг бүрийн өндрийг сарын
       мэшээс авч, абсолют өндрөөр тусад нь зурна. Харагдах эсэхийг
       «Тээврийн зам» товч удирдана (syncRoadIso). */
    /* БЛОК ЗАГВАР — сарын хэмжилтүүдийн хооронд олборлосон блокууд
       (I:/EMC/Block, tools/build_block_mesh.py). Тухайн сарын пит дээр
       «энэ хугацаанд авсан эзэлхүүн» болж сууна. Мэшийг lib/blockModel.ts
       хөтөч дээр үүсгэнэ (зүсэлт, блок бүрийн мэдээлэл). */
    L.blocks = new GraphicsLayer({
      title: "blocks", elevationInfo: { mode: "absolute-height" }, visible: false,
    });
    L.roadIso = new GraphicsLayer({
      title: "road-iso", visible: false,
      elevationInfo: { mode: "absolute-height", offset: ROAD_LIFT },
    });
    /* Урсгалын давхаргууд ГАЗРЫН ГАДАРГУУД НААЛДАНА.
       `absolute-height` дээр өндрийг өөрсдөө тооцох шаардлагатай болж,
       ил уурхайн ёроолоос (≈1177 м) эхэлсэн зам гадаргуугийн (≈1310 м)
       ДООГУУР орж, машинууд далдарч байсан. Налуу өнцгөөс харахад дов
       толгод бага зэргийн өргөлтийг ч халхалдаг. `on-the-ground` үед
       ArcGIS шугамыг гадаргуу дагуулж, цэгүүдийг гадаргуунд шахдаг —
       машин хэзээ ч агаарт хөвөхгүй, газрын дор ч орохгүй. */
    /* Урсгалын давхаргууд ГАЗРЫН ГАДАРГУУД НААЛДАНА.
       `relative-to-scene` нь өндрийг гадаргуу биш, СЦЕН ДАВХАРГЫН (овоолго,
       барилга) ОРОЙгоос тоолдог тул зам овоолгын мэшийн дээгүүр гарч
       агаарт өлгөгдөж байв. Жинхэнэ тээврийн замын геометр орж ирснээр
       зам овоолгуудыг тойрч өнгөрдөг болсон тул `on-the-ground` дээр
       далдрах асуудал бараг байхгүй. */
    /* Бодит мэш орж ирснээр газрын ЖИНХЭНЭ гадаргуу нь ArcGIS-ийн
       хавтгай дэлхийн DEM биш, харин тэр мэш болов. `on-the-ground` нь
       DEM-д шаддаг тул машин питийн дотор газрын дор орох байсан.
       `relative-to-scene` нь сцен давхаргын (мөн бодит мэшийн) гадаргууг
       дагадаг — геометрийн z нь тэр гадаргуугаас дээших шилжилт (=0). */
    const onScene = { mode: "relative-to-scene", offset: 0 } as const;
    L.trucks = new GraphicsLayer({ title: "trucks", elevationInfo: onScene });
    L.excavators = new GraphicsLayer({ title: "excavators", elevationInfo: onScene });
    const alerts = createHazardAlerts();
    hazardAlerts.current = alerts;
    L.truckAlerts = alerts.layer;
    /* Хаягдлын хоолой нь ГАЗАР ДООР — гадаргуугаас 12 м доош.
       Харагдахын тулд «Газрын гадаргуу» тохиргоог «Хагас» эсвэл
       «Унтраах» болгоно. Ус ба хоолойн өндрийг нэг DEM-ээс тооцно. */
    L.tails  = new GraphicsLayer({
      title: "tailings",
      elevationInfo: { mode: "absolute-height" },
    });

    const map = new Map({
      basemap: Basemap.fromId("satellite")!,
      layers: [L.im, L.roadNet, L.dam, L.hazard, L.bld, L.pile2d, L.pile3d, L.pitMesh, L.blocks, L.roadIso,
               L.tails, L.trucks, L.excavators, L.truckAlerts],
    });
    map.ground.layers.add(new ElevationLayer({ url: ELEV_URL }));
    map.ground.opacity = GROUND_OPACITY[0];
    map.ground.navigationConstraint = { type: "none" } as any;
    /* «Тээврийн зам» товчийг дарахад «Зөвхөн уурхай» горимын зам дагана */
    reactiveUtils.watch(() => L.roadNet.visible, () => { syncRoadIso(); });
    /* Машин, экскаваторыг мэшийн шүүсэн торон дээр `absolute-height`-аар
       байрлуулна (lib/imGround.ts). Тор ачаалагдахгүй бол `relative-to-scene`
       хэвээр үлдэнэ. */
    loadImGround().then((dem) => {
      if (layersRef.current !== L || !L.trucks) return;
      imGround.current = dem;
      const abs = { mode: "absolute-height", offset: 0 } as const;
      L.trucks.elevationInfo = abs;
      L.excavators.elevationInfo = abs;
      alerts.layer.elevationInfo = abs;
      drawTrucks();
      placeExcavatorsZ();
    }).catch((e) => console.warn("im_dem ачаалж чадсангүй — машин мэшийн LOD-г дагана:", e));
    /* Бодит мэшийг унтраахад машин газрын гадаргуу руу буух ёстой */
    reactiveUtils.watch(() => L.im.visible, () => { drawTrucks(); placeExcavatorsZ(); });
    mapRef.current = map;

    const host = divRef.current;
    if (!host) return () => {};
    let view: SceneView;

    /* SceneView-г нэг л удаа үүсгэнэ. Өмнө нь хэмжээ зөрөхөд view-г устгаад
       дахин үүсгэдэг «засвар» байсан — тэр нь газрын зургийг бүрмөсөн
       хоосон үлдээж байсан тул хассан. Жинхэнэ шалтгаан нь ArcGIS-ийн
       загварын хуудас ачаалагдаагүйд байв (app/layout.tsx-ийг үз). */
    function buildView() {
      view = new SceneView({
        container: host!,
        map,
        alphaCompositingEnabled: true,
        qualityProfile: "high",
        camera: {
          position: { longitude: 104.1, latitude: 48.94, z: 5200 }, tilt: 58, heading: 18,
        },
        environment: { lighting: { directShadowsEnabled: false } } as any,
        ui: {
          components: ["zoom", "compass", "navigation-toggle"],
          padding: { top: 12, right: 12, bottom: 12, left: 12 },
        } as any,
        popup: { autoOpenEnabled: false } as any,
      });
      /* Esri-гийн СУУРЬ ЗУРГИЙН ГАЛЕРЕЙ — зүүн дээд буланд икон, дарахад
         нээгдэнэ. Нэрсийг нь ОРЧУУЛАХГҮЙ, Esri-гийнхээр нь үлдээнэ.
         Урьд нь энд өөрсдийн 4 товчтой самбар байсныг орлоно. */
      view.ui.add(
        new Expand({
          view,
          expandIcon: "basemap",
          group: "top-left",
          content: new BasemapGallery({
            view,
            source: BM_IDS.map((id) => Basemap.fromId(id)).filter(Boolean) as Basemap[],
          }),
        }),
        "top-left",
      );
      /* Блок моделийн ЗҮСЭЛТ — суурь зургийн дүрсийн доор өөрийн дүрстэй,
         үргэлж харагдана (зүсэлт сонгоход Open pit горим руу шилжинэ). */
      sliceExpand.current = new Expand({
        view, group: "top-left", expandIcon: "slice",
        expandTooltip: stateRef.current.t.sliceTip, content: sliceHost,
      });
      view.ui.add(sliceExpand.current, "top-left");
      /* Esri-гийн ХЭМЖИЛТ — шулуун зай (хэвтээ/босоо зөрүүтэй) ба талбай.
         Суурь зургийн дүрсийн доор; нэг бүлэгт тул нэг нь нээгдэхэд нөгөө
         нь хаагдана. */
      const tt = stateRef.current.t;
      view.ui.add([
        new Expand({ view, group: "top-left", expandIcon: "measure-line",
                     expandTooltip: tt.measLine, content: new DirectLineMeasurement3D({ view }) }),
        new Expand({ view, group: "top-left", expandIcon: "measure-area",
                     expandTooltip: tt.measArea, content: new AreaMeasurement3D({ view }) }),
      ], "top-left");
      /* Open pit · Давхарга · Бүтэн дэлгэц — суурь зургийн дүрсийн доор */
      view.ui.add(btnHost, "top-left");

      viewRef.current = view;
      return view;
    }

    buildView();
    /* Машины анхааруулга нь бүсийн өнгөт давхаргын харагдацаас үл хамаарна. */
    const alertVisibility = reactiveUtils.watch(
      () => L.trucks.visible,
      (shown) => { alerts.layer.visible = shown; },
      { sync: true },
    );
    void loadHazardZones();

    /* --------- питийн мэшийн байрлалын мэдээлэл --------- */
    fetch("/data/pit_mesh.json")
      .then((r) => r.json())
      .then(async (j) => {
        meshInfo.current = j;
        /* Сарын гадаргуу AGOL-оос (PIT_SVC) — тор ачаалагдахгүй бол GLB-ээр */
        pitGrid.current = await loadPitGrid().catch((e) => {
          console.warn("pit_grid.json ачаалж чадсангүй — GLB ашиглана:", e);
          return null;
        });
        const g = pitGrid.current;
        if (g) {
          for (const k of Object.keys(PIT_SVC)) {
            meshInfo.current[k] ??= { url: "", lon: g.lon, lat: g.lat, z: g.z };
          }
        }
        /* Блок загвар байхгүй байсан ч газрын зураг ажиллах ёстой */
        blockInfo.current = await fetch("/data/blocks.json")
          .then((r) => (r.ok ? r.json() : null)).catch(() => null);
        setHasBlocks(!!blockInfo.current);
        return view.when();
      })
      .then(() => {
        if (cancelled) return;
        setReady(true);
        /* ?flow=0 — материалын урсгалыг унтраана (оношилгоо/гүйцэтгэл) */
        const flowOn = !/[?&]flow=0/.test(location.search);
        /* Хоёр goTo зэрэг ажиллуулж болохгүй — сүүлд дуусаад байгаа нь
           нөгөөгөө дардаг. Урсгал асаалттай үед хүрээг `frameFlow` тогтооно
           (уурхай + бүх хүлээн авагч), эсрэг тохиолдолд зөвхөн пит. */
        showBlocks();
        showMesh(stateRef.current.m).then(() => {
          if (!flowOn) zoomTo(L.pitMesh, undefined, 1.15);
        });
        disposeHover = wireHover(view);
        syncVisible();
        if (flowOn) startFlow();
      })
      .catch(() => setReady(true));

      return () => {
        disposeHover?.();
        window.removeEventListener("emc-theme", applyTheme);
        if (flowFrame.current !== null) cancelAnimationFrame(flowFrame.current);
        flowFrame.current = null;
        tailAbort.current?.abort();
        tailFlow.current?.destroy();
        tailFlow.current = null;
        if (tailSlice.current) {
          view.analyses.remove(tailSlice.current);
          tailSlice.current.destroy();
        }
        tailSlice.current = null;
        ++tailFocusRequest.current;
        tailInspection.current = null;
        hazardAbort.current?.abort();
        hazardAbort.current = null;
        alertVisibility.remove();
        alerts.destroy();
        hazardAlerts.current = null;
        hazardZones.current = [];
        excavatorGfx.current = [];
        excavatorScale.current = 0;
        view.destroy();
        viewRef.current = null;
      };
    }

    return () => { cancelled = true; if (disposed) disposed(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ================================================== материалын урсгал
     Ил уурхайгаас хүлээн авагч бүр рүү. Машины ТОО нь Excel-ийн тухайн
     сарын тонны хувиар хуваарилагдана — олон тонн бол олон машин.
     Баяжуулах үйлдвэрээс хаягдлын далан руу хаягдал хоолойгоор урсахыг
     долгионтой усны гадаргуу, урсгал дагасан хөөсөөр үзүүлнэ. */
  async function startFlow() {
    const view = viewRef.current;
    if (!view) return;
    const [dests, parked, path] = await Promise.all([
      loadDests(), loadParked(), loadTailLine(),
    ]);
    if (viewRef.current !== view) return;
    destsRef.current = dests;
    /* Зогсоолын шугам дээрх хөдөлгөөнгүй машинууд (уурхайн ажлын талбай,
       үйлдвэрийн орчим). Сар солиход өөрчлөгдөхгүй тул нэг л удаа. */
    parkedRef.current = parked;

    /* Хаягдлын ГАЗАР ДООРХ хоолой — жинхэнэ шугам (Bayjuulah_hayagdal_line) */
    const controller = new AbortController();
    tailAbort.current = controller;
    setTailStatus("loading");
    void createTailings(view, layersRef.current.tails, path, TAIL_DEPTH, PIPE_D, controller.signal)
      .then((flow) => {
        if (controller.signal.aborted || viewRef.current !== view) {
          flow.destroy();
          return;
        }
        tailFlow.current = flow;
        flow.setPipeOpacity(1 - tailTransparencyRef.current / 100);
        setTailStatus(flow.inspectionTarget ? "ready" : "error");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setTailStatus("error");
          console.warn("Хаягдлын урсгал ачаалж чадсангүй:", error);
        }
      });

    rebuildFlow();
    if (dests.length) frameFlow();
    else zoomTo(layersRef.current.pitMesh, undefined, 1.15);

    let last = performance.now();
    let truckElapsed = 0;
    let waterElapsed = 0;
    let telemetryElapsed = 0;
    let waterMonth = 0;
    let waterQuantity = 0;
    const tick = () => {
      if (viewRef.current !== view) return;
      const now = performance.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      truckElapsed += dt;
      waterElapsed += dt;
      telemetryElapsed += dt;
      if (truckElapsed >= 0.12) {
        simRef.current?.step(truckElapsed);
        if (layersRef.current.trucks?.visible) drawTrucks();
        if (layersRef.current.excavators?.visible) drawExcavators();
        truckElapsed = 0;
      }
      if (telemetryElapsed >= 0.5) {
        if (stateRef.current.mapMax) refreshTruckTelemetry();
        telemetryElapsed = 0;
      }
      if (waterElapsed >= 1 / 30) {
        if (waterMonth !== stateRef.current.m) {
          waterMonth = stateRef.current.m;
          waterQuantity = sumCol(waterMonth, C.AGU) + sumCol(waterMonth, C.BOH);
        }
        tailFlow.current?.update(waterElapsed, waterQuantity);
        waterElapsed = 0;
      }
      flowFrame.current = requestAnimationFrame(tick);
    };
    tick();
  }

  function focusTailings(detail = true) {
    const target = tailFlow.current?.inspectionTarget;
    const view = viewRef.current;
    if (!view || !target) return;
    const inspectionSession = tailInspection.current;
    const request = ++tailFocusRequest.current;
    const span = detail ? target.span : Math.max(180, TAIL_DEPTH * 6);
    const focusZ = target.z + (detail ? 0 : TAIL_DEPTH * 0.35);
    const heading = (target.heading + 90) % 360;
    const tilt = detail ? 62 : 55;
    const distance = span * 1.2;
    const horizontal = distance * Math.sin(tilt * Math.PI / 180);
    const bearing = heading * Math.PI / 180;
    const initial = view.camera.clone();
    initial.heading = heading;
    initial.tilt = tilt;
    initial.position = new Point({
      longitude: target.lon - Math.sin(bearing) * horizontal / (111320 * Math.cos(target.lat * Math.PI / 180)),
      latitude: target.lat - Math.cos(bearing) * horizontal / 111320,
      z: focusZ + distance * Math.cos(tilt * Math.PI / 180),
      spatialReference: { wkid: 4326 },
    });
    void view.goTo(initial, { duration: 900 }).then(() => {
      if (request !== tailFocusRequest.current || tailInspection.current !== inspectionSession
          || view.destroyed || view.interacting) return;
      // Fit a local section, keeping the smaller pipe's true diameter. The
      // overview includes terrain above it; the detail view shows moving water.
      const angle = target.heading * Math.PI / 180;
      const dx = Math.sin(angle) * span / 2 / (111320 * Math.cos(target.lat * Math.PI / 180));
      const dy = Math.cos(angle) * span / 2 / 111320;
      const a = view.toScreen(new Point({ longitude: target.lon - dx, latitude: target.lat - dy, z: focusZ }));
      const b = view.toScreen(new Point({ longitude: target.lon + dx, latitude: target.lat + dy, z: focusZ }));
      if (!a || !b) return;
      const width = Math.hypot(b.x - a.x, b.y - a.y);
      const wanted = Math.min(view.width * 0.70, view.height * 1.7);
      const ratio = width / Math.max(1, wanted);
      if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 0.08) return;
      // SceneView's reported scale is ground-relative even for an underground
      // target. Scale the actual camera-to-target distance to preserve framing.
      const camera = view.camera.clone();
      const position = camera.position.clone();
      if (position.longitude == null || position.latitude == null || position.z == null) return;
      position.longitude = target.lon + (position.longitude - target.lon) * ratio;
      position.latitude = target.lat + (position.latitude - target.lat) * ratio;
      position.z = focusZ + (position.z - focusZ) * ratio;
      camera.position = position;
      return view.goTo(camera, { duration: 350 });
    }).catch(() => {});
  }

  function closeTailInspection(restoreCamera = true) {
    const previous = tailInspection.current;
    const view = viewRef.current, map = mapRef.current;
    if (!previous || !view || !map) return;
    tailInspection.current = null;
    ++tailFocusRequest.current;
    setTailInspect(false);
    view.animation?.stop();
    clearTailSlice();
    changeTailTransparency(0);
    map.ground.opacity = previous.groundOpacity;
    if (layersRef.current.tails) layersRef.current.tails.visible = previous.tailsVisible;
    if (restoreCamera) view.goTo(previous.camera, { duration: 700 }).catch(() => {});
    syncVisible();
  }

  function inspectTailings() {
    if (!tailFlow.current?.inspectionTarget || !viewRef.current || !mapRef.current) return;
    ++truckFocusRequest.current;
    if (isoRef.current) applyIsolate(false);
    if (!tailInspection.current) {
      tailInspection.current = {
        camera: viewRef.current.camera.clone(),
        groundOpacity: mapRef.current.ground.opacity,
        tailsVisible: layersRef.current.tails.visible,
      };
    }
    layersRef.current.tails.visible = true;
    // Start with an intact, opaque pipe beneath visible terrain. Tools reveal
    // the liquid only when requested, without replacing the map environment.
    clearTailSlice();
    changeTailTransparency(0);
    changeTailGroundTransparency(65);
    setTailInspect(true);
    setLayersOpen(false);
    syncVisible();
    focusTailings(false);
  }

  function changeTailTransparency(value: number) {
    const transparency = Math.max(0, Math.min(100, value));
    setTailTransparency(transparency);
    tailTransparencyRef.current = transparency;
    tailFlow.current?.setPipeOpacity(1 - transparency / 100);
  }

  /* Газрын тунгалаг байдлын гулсуурыг хассан — хоолой харагдахын тулд
     самбар нээгдэхэд газрыг автоматаар 65 % тунгалаг болгоно. */
  function changeTailGroundTransparency(value: number) {
    const transparency = Math.max(0, Math.min(100, value));
    if (mapRef.current) mapRef.current.ground.opacity = 1 - transparency / 100;
  }

  function clearTailSlice() {
    if (tailSlice.current) {
      viewRef.current?.analyses.remove(tailSlice.current);
      tailSlice.current.destroy();
    }
    tailSlice.current = null;
    tailFlow.current?.setCutaway(false);
    setTailSliced(false);
  }

  function toggleTailSlice() {
    const view = viewRef.current, flow = tailFlow.current, map = mapRef.current;
    const target = flow?.inspectionTarget;
    if (!view || !flow || !target || !map) return;
    if (tailSlice.current) { clearTailSlice(); return; }
    const analysis = new SliceAnalysis({
      // Cut terrain locally. The pipe's curved cutaway is applied to its own
      // mesh so the liquid stays complete when the terrain is sliced away.
      excludedLayers: [layersRef.current.tails],
      excludeGroundSurface: false,
      shape: new SlicePlane({
        position: new Point({ longitude: target.lon, latitude: target.lat, z: target.z + PIPE_D,
          spatialReference: { wkid: 4326 } }),
        heading: target.heading, tilt: 0,
        width: target.span * 2, height: target.span * 2,
      }),
    });
    tailSlice.current = analysis;
    view.analyses.add(analysis);
    flow.setCutaway(true);
    setTailSliced(true);
    focusTailings();
  }

  function toggleTailTransparency() {
    const enabled = tailTransparencyRef.current > 0;
    changeTailTransparency(enabled ? 0 : 85);
    if (!enabled) focusTailings();
  }

  /** Уурхай + бүх хүлээн авагчийг нэг дор багтаасан камер.
      Питэд наалдсан зумаар тээвэрлэлт огт уншигдахгүй байсан. */
  function frameFlow() {
    const v = viewRef.current;
    if (!v || !destsRef.current.length) return;
    /* Маршрутын БҮХ орой — уурхай, хүлээн авагч, замууд бүгд багтана */
    const all = destsRef.current.flatMap((d) => d.path);
    if (!all.length) return;
    const lons = all.map((p) => p[0]);
    const lats = all.map((p) => p[1]);
    const pad = 0.002;
    v.goTo({
      target: {
        type: "extent", spatialReference: { wkid: 4326 },
        xmin: Math.min(...lons) - pad, xmax: Math.max(...lons) + pad,
        ymin: Math.min(...lats) - pad, ymax: Math.max(...lats) + pad,
      },
      tilt: 45, heading: 6,
    } as any, { duration: 1400 }).catch(() => {});
  }



  function rebuildFlow() {
    const L = layersRef.current;
    if (!destsRef.current.length || !L.trucks) return;
    clearHover.current?.();

    const sim = new FlowSim(destsRef.current, stateRef.current.m, 14, parkedRef.current);
    simRef.current = sim;

    /* Маршрутыг ТУСГАЙ ШУГАМААР ЗУРАХГҮЙ. Урьд нь чиглэл бүрийг өнгөт
       шугамаар давхарлаж байсан нь `Road_truck_SL` замын дээгүүр гарч,
       өөр нэг зам мэт уншигдаж байв. Одоо газрын зураг дээр ЗӨВХӨН
       сервисийн зам харагдана; бүх машин шар Haul Truck, харин тонны
       хэмжээг машины ТОО илэрхийлнэ. */
    L.trucks.removeAll();
    truckGfx.current = sim.trucks.map(() => new Graphic());
    truckKey.current = sim.trucks.map(() => "");
    L.trucks.addMany(truckGfx.current);
    L.excavators.removeAll();
    excavatorGfx.current = placeExcavators(parkedRef.current).map((placement, index) => new Graphic({
      geometry: new Point({
        longitude: placement.lon, latitude: placement.lat, z: 0,
        spatialReference: { wkid: 4326 },
      }),
      attributes: { excavatorNumber: index + 1, truckId: placement.truckId, heading: placement.heading },
    }));
    L.excavators.addMany(excavatorGfx.current);
    placeExcavatorsZ();
    excavatorScale.current = 0;
    drawTrucks();
    drawExcavators();
    setSelectedTruck(null);
    if (stateRef.current.mapMax) refreshTruckTelemetry();
  }

  /** Геометрийг нэг удаа WGS84-өөр авна; машин хөдлөх бүрт сервер асуухгүй. */
  async function loadHazardZones() {
    const view = viewRef.current;
    if (!view) return;
    hazardAbort.current?.abort();
    const controller = new AbortController();
    hazardAbort.current = controller;
    hazardZones.current = [];
    hazardAlerts.current?.sync([], truckHeight());
    setHazardStatus("loading");
    try {
      const options = { signal: controller.signal };
      /* REST query нь давхаргын анхны load алдааг кэшлэхгүй; retry ажиллана. */
      const ids = await executeForIds(SVC.hazard, { where: "1=1" }, options);
      const features: Graphic[] = [];
      /* Бүс нэмэгдсэн ч сервисийн maxRecordCount-аас болж хэсэг нь алга болохгүй. */
      for (let start = 0; start < ids.length; start += 500) {
        const result = await executeQueryJSON(SVC.hazard, {
          objectIds: ids.slice(start, start + 500),
          outFields: ["code"], returnGeometry: true,
          outSpatialReference: { wkid: 4326 },
        }, options);
        if (result.exceededTransferLimit) throw new Error("Incomplete hazard geometry");
        features.push(...result.features);
      }
      if (controller.signal.aborted || viewRef.current !== view) return;
      hazardZones.current = compileHazardZones(features.map((feature) => ({
        attributes: feature.attributes,
        geometry: feature.geometry?.type === "polygon" ? feature.geometry : null,
      })));
      setHazardStatus("ready");
      syncTruckAlerts();
    } catch (error: unknown) {
      if (controller.signal.aborted || viewRef.current !== view) return;
      console.warn("Аюулын бүс ачаалж чадсангүй:", error);
      setHazardStatus("error");
    }
  }

  function syncTruckAlerts() {
    const sim = simRef.current;
    if (!sim) return;
    hazardAlerts.current?.sync(sim.trucks.map((truck) => ({
      id: truck.id, lon: truck.lon, lat: truck.lat, z: vehicleZ(truck.lon, truck.lat),
      level: hazardLevelAt(hazardZones.current, truck.lon, truck.lat),
    })), truckHeight());
  }

  /** Картын налуу: уурхайн сарын мэш, гадна нь ачаалагдсан газрын өндөр. */
  function sampleTruckElevation(lon: number, lat: number): TerrainElevationSample | null {
    const terrain = telemetryTerrain.current;
    if (!terrain || terrain.month !== stateRef.current.m) return null;
    const height = terrain.sample?.(lon, lat);
    if (height != null && Number.isFinite(height)) return { height, source: "mesh" };
    const elevation = groundAt(lon, lat);
    return elevation != null ? { height: elevation, source: "ground" } : null;
  }

  /** Ачаалагдсан газрын гадаргуугийн өндөр (DEM), м */
  function groundAt(lon: number, lat: number): number | null {
    const sampler = viewRef.current?.groundView.elevationSampler;
    if (!sampler) return null;
    let x = lon, y = lat;
    if (sampler.spatialReference.isWebMercator) [x, y] = wmUtils.lngLatToXY(lon, lat);
    else if (!sampler.spatialReference.isWGS84) return null;
    const extent = sampler.extent;
    if (!extent || x < extent.xmin || x > extent.xmax || y < extent.ymin || y > extent.ymax) return null;
    const elevation = sampler.elevationAt(x, y);
    return Number.isFinite(elevation) && elevation !== sampler.noDataValue ? elevation : null;
  }

  /** Машины абсолют өндөр: бодит мэш харагдаж байвал түүний шүүсэн тор,
   *  мэшээс гадна эсвэл мэш унтарсан бол газрын гадаргуу. Тор ачаалагдаагүй
   *  үед 0 — давхарга `relative-to-scene` хэвээр тул гадаргуугаас тоолно. */
  function vehicleZ(lon: number, lat: number, prev = 0): number {
    const dem = imGround.current;
    if (!dem) return 0;
    const z = layersRef.current.im?.visible ? dem(lon, lat) : NaN;
    return Number.isFinite(z) ? z : groundAt(lon, lat) ?? prev;
  }

  function placeExcavatorsZ() {
    for (const g of excavatorGfx.current) {
      const p = g.geometry as Point;
      g.geometry = new Point({
        longitude: p.longitude, latitude: p.latitude, z: vehicleZ(p.longitude!, p.latitude!, p.z ?? 0),
        spatialReference: { wkid: 4326 },
      });
    }
  }

  function refreshTruckTelemetry() {
    setTruckTelemetry(buildTruckTelemetry(
      simRef.current?.trucks ?? [],
      sampleTruckElevation,
      (lon, lat) => hazardStatusRef.current === "ready" ? hazardLevelAt(hazardZones.current, lon, lat) : null,
    ));
  }

  async function focusTruck(id: number) {
    const view = viewRef.current, sim = simRef.current;
    if (!view || !sim || !layersRef.current.trucks?.visible) return;
    if (tailInspection.current) closeTailInspection(false);
    const request = ++truckFocusRequest.current;
    const month = stateRef.current.m;
    const index = sim.trucks.findIndex((truck) => truck.id === id);
    const graphic = truckGfx.current[index];
    if (!graphic?.geometry) return;
    setSelectedTruck(id);
    const sample = telemetryTerrain.current?.month === month
      ? telemetryTerrain.current.sample : await heightGrid(month).catch(() => null);
    if (request !== truckFocusRequest.current || viewRef.current !== view || stateRef.current.m !== month ||
        simRef.current !== sim || !stateRef.current.mapMax || !layersRef.current.trucks?.visible) return;
    const truck = sim.trucks[index];
    const height = sample?.(truck.lon, truck.lat);
    const elevation = height != null && Number.isFinite(height) ? height
      : sampleTruckElevation(truck.lon, truck.lat)?.height;
    // The quarry floor is below the world DEM used by goTo(Graphic).
    const target = elevation == null ? graphic : new Point({
      longitude: truck.lon, latitude: truck.lat, z: elevation + truckHeight() / 2,
      spatialReference: { wkid: 4326 },
    });
    view.goTo({ target, scale: 1000, tilt: 60 }, { duration: 900 }).catch(() => {});
  }

  useEffect(() => {
    if (!mapMax || !ready) return;
    let cancelled = false;
    telemetryTerrain.current = null;
    refreshTruckTelemetry();
    void heightGrid(m).then((sample) => {
      if (cancelled) return;
      telemetryTerrain.current = { month: m, sample };
      refreshTruckTelemetry();
    }).catch(() => {
      if (cancelled) return;
      telemetryTerrain.current = { month: m, sample: null };
      refreshTruckTelemetry();
    });
    return () => { cancelled = true; };
  }, [mapMax, ready, m]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !ready) return;
    view.ui.padding = { top: 12, right: 12, bottom: mapMax ? 164 : 12, left: 12 };
  }, [mapMax, ready]);

  /**
   * Машины хэмжээ.
   *
   * Загварын хэмжээ (7.90 x 6.15 x 12.88 м) нь уурхай + овоолгыг хамарсан
   * хүрээнд пикселийн доогуур ордог тул масштабаас хамааруулж бага зэрэг
   * томруулна.
   *
   * ГЭХДЭЭ ХЭТ ТОМРУУЛЖ БОЛОХГҮЙ. Өмнө нь дээд хязгаар 40 м байсан
   * (өргөн зумд 33 м -> 68 м урт). Ийм ӨНДӨР биет налуу камерт
   * суурьнаасаа хэдэн арван метр тонгойж, машинууд замаас гарсан мэт
   * болж байв. Мөн дүрслэлийн урт нь мөргөлдөөнөөс сэргийлэх зайнаас
   * их байвал зайг хангасан ч НҮДЭНД давхцаж харагддаг: 29 м урт үед
   * давхцал 471, 19 м үед 383 болдгийг хэмжсэн. Одоо 11 м-ээр
   * (≈23 м урт) таслав.
   *
   * Хэмжээг алхамчилсан тул тэмдэгт байнга солигдож анивчихгүй
   * (`truckKey`-г үз).
   */
  function truckHeight() {
    const sc = viewRef.current?.scale ?? 20000;
    const h = Math.max(6.2, Math.min(11, sc / 2200));
    return Math.round(h * 2) / 2;
  }

  function drawTrucks() {
    const sim = simRef.current;
    if (!sim) return;
    sim.trucks.forEach((tr, i) => {
      const g = truckGfx.current[i];
      if (!g) return;
      g.geometry = new Point({
        longitude: tr.lon, latitude: tr.lat,
        z: vehicleZ(tr.lon, tr.lat, (g.geometry as Point | null)?.z ?? 0),
        spatialReference: { wkid: 4326 },
      });
      const hb = Math.round(tr.heading / 4) * 4;
      const th = truckHeight();
      const modelUrl = tr.loaded && !tr.parked
        ? "/data/truck-loaded.glb?v=haul-v3"
        : "/data/truck.glb?v=haul-v3";
      const key = modelUrl + "|" + hb + "|" + th;
      if (truckKey.current[i] === key) return;
      truckKey.current[i] = key;
      g.symbol = {
        type: "point-3d",
        symbolLayers: [{
          // Native GLB materials preserve yellow paint, black tires and cab glass.
          type: "object", resource: { href: modelUrl },
          height: th, heading: hb, anchor: "bottom",
        }],
      } as any;
      g.attributes = {
        truckId: tr.id, displayNumber: i + 1,
        dest: tr.dest, destName: tr.destName, loaded: tr.loaded,
      };
    });
    syncTruckAlerts();
  }

  function drawExcavators() {
    const scale = truckHeight() / 6.15;
    if (excavatorScale.current === scale) return;
    excavatorScale.current = scale;
    for (const graphic of excavatorGfx.current) {
      graphic.symbol = {
        type: "point-3d",
        symbolLayers: [{
          type: "object", resource: { href: "/data/excavator.glb?v=excavator-v9-inward-cavity" },
          // Native GLB height; keep machinery at the same scale as the trucks.
          height: 5.9054 * scale, heading: graphic.attributes.heading, anchor: "bottom",
        }],
      } as any;
    }
  }


  function syncVisible() {
    const L = layersRef.current;
    const v: Record<string, boolean> = {};
    for (const k of Object.keys(L)) v[k] = !!L[k]?.visible;
    setVisible(v);
  }

  function meshSymbol(iso: boolean) {
    /* «Open pit» горимд оройн өнгө (байгалийн өнгө + өөрчлөлт) харагдана */
    return {
      type: "mesh-3d",
      symbolLayers: [{ type: "fill",
        material: iso ? { color: [255, 255, 255, 1], colorMixMode: "multiply" }
                      : { color: hex("#8d7f70", 1), colorMixMode: "replace" } }],
    } as any;
  }

  /** Сарын питийн гадаргуу: AGOL-ын 3D object давхаргаас (lib/pitSource.ts),
   *  амжилтгүй бол тухайн сарын локал GLB-ээр (public/data/pit_NN.glb). */
  function loadPitMesh(month: number): Promise<Mesh | null> {
    const cached = meshLoad.current[month];
    if (cached) return cached;
    const info = meshInfo.current[String(month)];
    if (!info) return Promise.resolve(null);
    const glb = () => info.url
      ? Mesh.createFromGLTF(
          new Point({ longitude: info.lon, latitude: info.lat, z: info.z, spatialReference: { wkid: 4326 } }),
          info.url,
        )
      : Promise.reject(new Error(`${month}-р сарын GLB байхгүй`));
    const svc = PIT_SVC[month], grid = pitGrid.current;
    const load = svc && grid
      ? fetchPitMesh(svc, grid).catch((e) => {
          console.warn(`${month}-р сарын гадаргууг AGOL-оос ачаалж чадсангүй — GLB ашиглана:`, e);
          return glb();
        })
      : glb();
    return meshLoad.current[month] = load.catch((e) => {
      console.warn("Питийн гадаргуу ачаалж чадсангүй:", e);
      delete meshLoad.current[month];
      return null;
    });
  }

  /** Сарын гадаргууг байгалийн өнгөөр, асаалттай бол өмнөх сараас
   *  өөрчлөгдсөн хэсгийг улаанаар будна (lib/pitSurface.ts). */
  async function pitColorsFor(month: number): Promise<PitColors | null> {
    const mesh = await loadPitMesh(month);
    if (!mesh) return null;
    if (!pitColorCache.current[month]) {
      const prev = month > 1 ? await loadPitMesh(month - 1) : null;
      pitColorCache.current[month] ??= pitColors(mesh, prev);
    }
    return pitColorCache.current[month];
  }

  /** II…VI сарын өөрчлөлтийн маскууд — нэг удаа тооцоод нийт талбайг гаргана */
  function loadAllMasks() {
    return allMasks.current ??= (async () => {
      const out: { month: number; mask: Set<number> }[] = [];
      const byMonth: Record<number, number> = {};
      const union = new Set<number>();
      let cell = 5;
      const months = Object.keys(meshInfo.current).map(Number).filter((k) => k > 1).sort((a, b) => a - b);
      for (const k of months) {
        const pc = await pitColorsFor(k);
        if (!pc?.mask) continue;
        out.push({ month: k, mask: pc.mask });
        byMonth[k] = pc.changedHa;
        cell = pc.cell;
        pc.mask.forEach((c) => union.add(c));
      }
      setAllChg({ total: (union.size * cell * cell) / 10000, byMonth });
      return out;
    })();
  }

  async function paintPit(month: number) {
    const mesh = await loadPitMesh(month);
    const pc = await pitColorsFor(month);
    if (!mesh || !pc) return;
    const mode = blkRef.current.change;
    let arr = mode === "month" && pc.change ? pc.change : pc.base;
    if (mode === "all") {
      const masks = await loadAllMasks();
      arr = pitAllCache.current[month] ??= paintMonths(mesh, pc.base, masks);
    }
    if (blkRef.current.change !== mode) return;   // хүлээх зуур горим солигдсон
    if (mesh.vertexAttributes.color !== arr) {
      mesh.vertexAttributes.color = arr;
      mesh.vertexAttributesChanged();
    }
    if (stateRef.current.m === month) setChangeHa(pc.change ? pc.changedHa : null);
  }

  async function showMesh(month: number) {
    const L = layersRef.current;
    const mesh = await loadPitMesh(month);
    if (stateRef.current.m !== month) return;
    if (!mesh) { L.pitMesh.removeAll(); return; }
    /* Өнгийг нэмэхээс ӨМНӨ будна — хуучин сарын мэш шинэ нь бэлэн болтол
       үлдэх тул солих үед анивчихгүй */
    await paintPit(month);
    if (stateRef.current.m !== month) return;
    L.pitMesh.removeAll();
    L.pitMesh.add(new Graphic({ geometry: mesh, symbol: meshSymbol(isoRef.current) }));
    syncRoadIso();
  }

  /** Сонгосон сарын (өмнөх сараас тэр сар хүртэл) олборлосон блокийг
   *  зүсэлтийг тооцон зурна. Хугацаа нь толгойн сартай үргэлж ижил. */
  async function showBlocks() {
    const L = layersRef.current, meta = blockInfo.current;
    const { slice } = blkRef.current;
    const month = stateRef.current.m;
    const info = meta?.months[String(month)];
    const req = ++blockReq.current;
    if (!meta || !info) { L.blocks.removeAll(); return; }
    let data: BlockData;
    try {
      data = await (blockCache.current[month] ??= loadBlockData(meta, info));
    } catch (e) {
      delete blockCache.current[month];
      console.warn("Блокийн өгөгдөл ачаалж чадсангүй:", e);
      return;
    }
    if (req !== blockReq.current) return;
    const mesh = buildBlockMesh(data, meta, slice);
    L.blocks.removeAll();
    if (mesh) L.blocks.add(new Graphic({ geometry: mesh, symbol: BLOCK_SYMBOL }));
  }

  /** Тээврийн замын тэмдэг — энгийн горимын замтай ижил өнгө, зузаан */
  function roadSymbol() {
    return (layersRef.current.roadNet?.renderer as any)?.symbol?.clone();
  }

  /** Сарын питийн мэшээс өндрийн тор уншина. Мэшийн оройнууд 5 м-ийн
   *  тогтмол тор дээр байрлана: x = зүүн, y = хойд, z = дээш (эх цэгээс
   *  метрээр). ArcGIS-ийн `meshUtils.createElevationSampler` энэ мэш дээр
   *  өндөр олдоггүй (газарзүйн координаттай мэш) тул торыг өөрсдөө уншина. */
  function heightGrid(month: number): Promise<HeightSampler | null> {
    if (!heightGridCache.current[month]) {
      heightGridCache.current[month] = readHeightGrid(month).catch((error: unknown) => {
        delete heightGridCache.current[month];
        throw error;
      });
    }
    return heightGridCache.current[month];
  }

  async function readHeightGrid(month: number): Promise<HeightSampler | null> {
    const info = meshInfo.current[String(month)];
    if (!info) return null;
    const mesh = await loadPitMesh(month);
    if (!mesh) return null;
    const pos = mesh.vertexAttributes.position;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] < x0) x0 = pos[i]; if (pos[i] > x1) x1 = pos[i];
      if (pos[i + 1] < y0) y0 = pos[i + 1]; if (pos[i + 1] > y1) y1 = pos[i + 1];
    }
    /* Торны алхам: хоёр хөрш оройн хамгийн бага зай */
    let cell = Infinity;
    for (let i = 3; i < Math.min(pos.length, 30000); i += 3) {
      const d = Math.abs(pos[i] - pos[i - 3]);
      if (d > 0.01 && d < cell) cell = d;
    }
    const cols = Math.round((x1 - x0) / cell) + 1;
    const rows = Math.round((y1 - y0) / cell) + 1;
    const h = new Float32Array(cols * rows).fill(NaN);
    for (let i = 0; i < pos.length; i += 3) {
      const c = Math.round((pos[i] - x0) / cell);
      const r = Math.round((pos[i + 1] - y0) / cell);
      h[r * cols + c] = pos[i + 2] + info.z;
    }
    /* Газарзүйн координатыг эх цэгийн орон нутгийн (зүүн, хойд) метр рүү
       хөрвүүлэх WGS84-ийн муруйлтын радиусууд */
    const A = 6378137, E2 = 0.00669437999014, R = Math.PI / 180;
    const sl = Math.sin(info.lat * R), w = 1 - E2 * sl * sl;
    const kE = R * (A / Math.sqrt(w)) * Math.cos(info.lat * R);
    const kN = R * (A * (1 - E2) / (w * Math.sqrt(w)));
    /** lon/lat -> мэшийн гадаргуугийн абсолют өндөр (мэшээс гадна бол NaN) */
    return (lon: number, lat: number) => {
      const fc = ((lon - info.lon) * kE - x0) / cell;
      const fr = ((lat - info.lat) * kN - y0) / cell;
      const c = Math.floor(fc), r = Math.floor(fr);
      if (c < 0 || r < 0 || c >= cols - 1 || r >= rows - 1) return NaN;
      const tc = fc - c, tr = fr - r;
      const v00 = h[r * cols + c], v01 = h[r * cols + c + 1];
      const v10 = h[(r + 1) * cols + c], v11 = h[(r + 1) * cols + c + 1];
      if ([v00, v01, v10, v11].some(Number.isNaN)) {
        /* Мэшийн ирмэг — хамгийн ойрын утгатай орой */
        const near = [[tr, tc, v00], [tr, 1 - tc, v01], [1 - tr, tc, v10], [1 - tr, 1 - tc, v11]]
          .filter((q) => !Number.isNaN(q[2]))
          .sort((p, q) => p[0] + p[1] - q[0] - q[1]);
        return near.length ? near[0][2] : NaN;
      }
      return (v00 * (1 - tc) + v01 * tc) * (1 - tr) + (v10 * (1 - tc) + v11 * tc) * tr;
    };
  }

  /** Замыг сарын мэш дээр наана: нягтруулж, цэг бүрийн өндрийг мэшээс
   *  авна. Мэшийн гадна гарсан хэсгийг тасалж хаяна — тэнд харагдах
   *  гадаргуу байхгүй тул зам агаарт өлгөгдөнө. */
  async function drapeRoads(month: number): Promise<Polyline[]> {
    const L = layersRef.current;
    const sample = await heightGrid(month);
    if (!sample) return [];
    const sr = { wkid: 4326 } as any;
    const fs = await L.roadNet.queryFeatures({
      where: "1=1", returnGeometry: true, returnZ: false, outSpatialReference: sr,
    });
    if (!geodeticDensifyOperator.isLoaded()) await geodeticDensifyOperator.load();
    const out: Polyline[] = [];
    for (const f of fs.features) {
      const g = f.geometry as Polyline | null;
      if (!g) continue;
      const flat = new Polyline({ paths: g.paths, spatialReference: sr });
      const dense = geodeticDensifyOperator.execute(flat, ROAD_STEP, { unit: "meters" } as any) as Polyline;
      const runs: number[][][] = [];
      for (const path of dense.paths) {
        let run: number[][] = [];
        for (const [lon, lat] of path) {
          const z = sample(lon, lat);
          if (!Number.isNaN(z)) { run.push([lon, lat, z]); continue; }
          if (run.length > 1) runs.push(run);
          run = [];
        }
        if (run.length > 1) runs.push(run);
      }
      if (runs.length) out.push(new Polyline({ paths: runs, hasZ: true, spatialReference: sr }));
    }
    return out;
  }

  /** «Зөвхөн уурхай» горимд замыг мэш дээр наасан хувилбараар солино.
   *  Энгийн замыг тунгалаг болгож нуух нь «Давхарга» самбарын товчийг
   *  асаалттай хэвээр үлдээнэ. */
  async function syncRoadIso() {
    const L = layersRef.current;
    if (!L.roadIso) return;
    const iso = isoRef.current;
    L.roadNet.opacity = iso ? 0 : 1;
    if (!iso || !L.roadNet.visible) { L.roadIso.visible = false; return; }
    const month = stateRef.current.m;
    if (!meshInfo.current[String(month)]) return;
    let job = roadIsoCache.current[month];
    if (!job) {
      job = drapeRoads(month);
      roadIsoCache.current[month] = job;
      job.catch((e) => {
        console.warn("Замыг мэш дээр нааж чадсангүй:", e);
        delete roadIsoCache.current[month];
      });
    }
    const lines = await job.catch(() => [] as Polyline[]);
    if (stateRef.current.m !== month || !isoRef.current || !L.roadNet.visible) return;
    const sym = roadSymbol();
    L.roadIso.removeAll();
    L.roadIso.addMany(lines.map((geometry) => new Graphic({ geometry, symbol: sym })));
    L.roadIso.visible = true;
  }

  function zoomTo(lyr: any, where?: string, pad = 1.6) {
    const view = viewRef.current;
    if (!lyr || !view) return;
    if (tailInspection.current) closeTailInspection(false);
    lyr.visible = true;
    const go = (ext: any) => ext && view.goTo({ target: ext.expand(pad), tilt: 58 });
    /* GraphicsLayer дээр queryExtent байдаггүй */
    if (lyr.graphics) { go(lyr.graphics.getItemAt(0)?.geometry?.extent); return; }
    if (lyr.queryExtent) {
      lyr.queryExtent(where ? { where } : undefined)
        .then((r: any) => go(r?.extent), () => go(lyr.fullExtent));
    } else go(lyr.fullExtent);
  }

  /* ---------------------------------------------------------------------
     Multipatch_EMC-ийн I3S кэш дээр атрибутын буфер шилжсэн:
       hitTest -> ner алга · type1 = 1081751420 (хог) ·
       OBJECTID нь FeatureServer-ийн FID-тэй таарахгүй.
     Сервис публиш хийхэд гарсан алдаа тул клиентээс засах боломжгүй.
     Тиймээс атрибутыг FeatureServer-ээс байршлаар нь асууна.
  --------------------------------------------------------------------- */
  async function bldLookup(mapPoint: any) {
    const ll = toLonLat(mapPoint);
    if (!ll) return null;
    const key = ll[0].toFixed(5) + "," + ll[1].toFixed(5);
    if (key in bldCache.current) return bldCache.current[key];

    const geom = JSON.stringify({ x: ll[0], y: ll[1], spatialReference: { wkid: 4326 } });
    const q = `${SVC.bldFS}/query?f=json&returnGeometry=false&outFields=FID,ner,type1` +
              `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
              `&geometry=${encodeURIComponent(geom)}`;
    try {
      const d = await (await fetch(q)).json();
      const fs: any[] = d?.features ?? [];
      /* Хөл давхцвал БҮ-ийнхийг эрхэмлэнэ — харагдах өнгө нь type1-ээс шалтгаална */
      const pick = fs.find((f) => num1(f.attributes?.type1) === BU_TYPE) ?? fs[0];
      const rec = pick?.attributes ?? null;
      bldCache.current[key] = rec;
      return rec;
    } catch {
      bldCache.current[key] = null;
      return null;
    }
  }

  function toLonLat(pt: any): [number, number] | null {
    if (!pt) return null;
    try {
      const wkid = pt.spatialReference?.wkid ?? pt.spatialReference?.latestWkid;
      if (wkid === 102100 || wkid === 3857) {
        const g: any = wmUtils.webMercatorToGeographic(pt);
        return [g.x ?? g.longitude, g.y ?? g.latitude];
      }
      if (pt.longitude != null) return [pt.longitude, pt.latitude];
      return [pt.x, pt.y];
    } catch { return pt?.x != null ? [pt.x, pt.y] : null; }
  }

  /* ------------------------------------------------------------- hover */
  function wireHover(view: SceneView) {
    let pending = false;
    let disposed = false, revision = 0, equipment = false;
    let frame: number | null = null;
    let last: { x: number; y: number; clientX: number; clientY: number } | null = null;
    const container = view.container as HTMLDivElement;
    const clear = () => {
      ++revision;
      last = null;
      equipment = false;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      setTip(null);
      container.style.cursor = "";
    };
    clearHover.current = clear;
    const schedule = () => {
      if (disposed || pending || frame !== null || !last) return;
      frame = requestAnimationFrame(() => { frame = null; void check(); });
    };
    const check = async () => {
      if (!last || disposed || pending || view.destroyed) return;
      const pointer = last, request = revision;
      const isCurrent = () => !disposed && !view.destroyed &&
        viewRef.current === view && request === revision;
      pending = true;
      try {
        const res = await view.hitTest({ x: pointer.x, y: pointer.y });
        if (!isCurrent()) return;
        const h = hitInfo(res);
        equipment = h?.kind === "truck" || h?.kind === "excavator" || h?.kind === "truckAlert";
        if (!h) { setTip(null); container.style.cursor = ""; return; }
        container.style.cursor = equipment ? "" : "pointer";
        void showFor(h, pointer.clientX, pointer.clientY, isCurrent);
      } catch {
        if (isCurrent()) clear();
      } finally {
        pending = false;
        if (request !== revision) schedule();
      }
    };
    const move = view.on("pointer-move", (ev) => {
      if (view.interacting || !view.stationary) { clear(); return; }
      ++revision;
      const r = container.getBoundingClientRect();
      last = { x: ev.x, y: ev.y, clientX: ev.x + r.left, clientY: ev.y + r.top };
      schedule();
    });
    const leave = view.on("pointer-leave", clear);
    // Recheck a vehicle under a resting cursor as the simulated fleet moves.
    const refresh = window.setInterval(() => {
      if (equipment) schedule();
    }, 150);
    const navigation = reactiveUtils.watch(() => view.stationary, (stationary) => {
      if (!stationary) clear();
    });
    const visibility = reactiveUtils.watch(
      () => [layersRef.current.trucks.visible, layersRef.current.excavators.visible],
      clear,
    );

    const click = view.on("click", async (ev) => {
      const h = hitInfo(await view.hitTest(ev));
      /* ArcGIS Dashboard шиг: ХООСОН зай дээр дарахад сонголт цуцлагдана.
         Урьд нь газрын зургаас тавьсан шүүлтийг зөвхөн Esc товч арилгадаг
         байсан тул хэрэглэгч гацдаг байв. */
      if (!h) { clearAll(); return; }
      if (h.kind === "blocks") {
        /* Блок дээр дарахад — зүүн талын картад бүх талбар. Ижил блок дээр
           дахин дарвал цуцлагдана (бусад сонголттой адил toggle). */
        const meta = blockInfo.current;
        const { slice } = blkRef.current;
        const { m: mm, lang: lg } = stateRef.current;
        const data = await blockCache.current[mm]?.catch(() => null);
        const b = meta && data && h.mapPoint ? pickBlock(data, meta, slice, h.mapPoint, view) : -1;
        if (!meta || !data || b < 0) return;
        const d = blockDetail(data, meta, b, lg, ROMAN, fmt);
        setSel((prev) => (prev?.kind === "block" && prev.id === d.id ? null : { kind: "block", ...d }));
        return;
      }
      if (h.kind === "hazard" || h.kind === "truckAlert" ||
          h.kind === "truck" || h.kind === "excavator") return;
      if (h.kind === "pitmesh") { toggleIsolate(); return; }
      if (h.kind === "bld") {
        const rec = await bldLookup(h.mapPoint);
        if (rec && num1(rec.type1) === BU_TYPE) {
          /* Мөн адил феатур дээр дахин дарвал цуцлагдана */
          toggleDest({ ci: C.BU, title: t.bu,
                       featName: "type1 = 1" + (rec.ner ? "  ·  " + rec.ner : "") });
        }
        return;
      }
      if (h.kind === "pile") {
        const ci = PILE2COL[h.name];
        if (ci === undefined) return;
        toggleDest({ ci, title: h.name, featName: "RefName = " + h.name });
      }
    });
    return () => {
      disposed = true;
      clear();
      clearHover.current = null;
      window.clearInterval(refresh);
      move.remove();
      leave.remove();
      click.remove();
      navigation.remove();
      visibility.remove();
    };
  }

  /** Мэшийн гадаргуу дээрх цэгийг (mapPoint) торны блок болгоно. Цэг нь
   *  яг хоёр нүдний зааг дээр байдаг тул камераас холдох чиглэлд 0.3–2.5 м
   *  дотогш алхаж, эхний дүүрсэн нүдийг авна. */
  function pickBlock(data: BlockData, meta: BlockModelMeta, slice: BlockSlice,
                     pt: Point, view: SceneView): number {
    const { lon, lat, z } = data.info;
    const [kE, kN] = enuScale(lat);
    const enu = (p: Point): [number, number, number] =>
      [(p.longitude! - lon) * kE, (p.latitude! - lat) * kN, (p.z ?? 0) - z];
    const hit = enu(pt), cam = enu(view.camera.position);
    const d = [hit[0] - cam[0], hit[1] - cam[1], hit[2] - cam[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    for (const s of [0.3, 0.8, 1.5, 2.5]) {
      const b = blockAt(data, meta, slice,
        hit[0] + (d[0] / len) * s, hit[1] + (d[1] / len) * s, hit[2] + (d[2] / len) * s);
      if (b >= 0) return b;
    }
    return -1;
  }

  function hitInfo(res: any): any {
    const L = layersRef.current;
    // Equipment must win over the ground mesh or hazard polygon underneath it.
    for (const r of res?.results ?? []) {
      if (r.type !== "graphic" || !r.graphic) continue;
      const lyr = r.graphic.layer, a = r.graphic.attributes ?? {};
      if (!lyr?.visible) continue;
      if (lyr === L.truckAlerts) return { kind: "truckAlert", id: a.truckId, code: a.hazardLevel };
      if (lyr === L.trucks && Number.isInteger(a.displayNumber)) {
        return { kind: "truck", number: a.displayNumber };
      }
      if (lyr === L.excavators && Number.isInteger(a.excavatorNumber)) {
        return { kind: "excavator", number: a.excavatorNumber };
      }
    }
    for (const r of res?.results ?? []) {
      if (r.type !== "graphic" || !r.graphic) continue;
      const lyr = r.graphic.layer, a = r.graphic.attributes ?? {};
      if (lyr === L.blocks) return { kind: "blocks", mapPoint: r.mapPoint };
      if (lyr === L.pitMesh) return { kind: "pitmesh" };
      /* SceneLayer-ийн атрибут эвдэрсэн тул зөвхөн байршлыг нь авна */
      if (lyr === L.bld) return { kind: "bld", mapPoint: r.mapPoint };
      if (lyr === L.pile3d) return { kind: "pile", name: a.RefName };
      if (lyr === L.pile2d) return { kind: "pile", name: a.dugaar };
      if (lyr === L.hazard) return { kind: "hazard", code: num1(a.code), area: num1(a.Shape__Area) };
    }
    return null;
  }

  async function showFor(h: any, x: number, y: number, isCurrent: () => boolean) {
    const { m: mm, lang: lg, t } = stateRef.current;
    const names = COL_NAMES[lg];

    if (h.kind === "truck" || h.kind === "excavator") {
      setTip({ x, y, title: `${h.kind === "truck" ? "TRUCK" : t.tExcavator} ${h.number}`, rows: [] });
      return;
    }
    if (h.kind === "hazard" || h.kind === "truckAlert") {
      const c = Math.min(Math.max(Math.round(h.code) || 0, 0), 3);
      const truckIndex = simRef.current?.trucks.findIndex((truck) => truck.id === h.id) ?? -1;
      setTip({ x, y, title: h.kind === "truckAlert" ? (truckIndex >= 0 ? `TRUCK ${truckIndex + 1}` : t.lyTrucks) : t.hzTitle,
               rows: [
                 { label: t.hzLevel, value: `${c} · ${t.hzNames[c] ?? ""}`, color: HAZARD_COLORS[c - 1] ?? null },
                 ...(h.kind === "hazard" ? [{ label: t.hzArea, value: fmt(h.area / 10000, 1) }] : []),
               ] });
      return;
    }
    if (h.kind === "blocks") {
      /* Курсорын доорх ГАНЦ блок: гадаргуу дээрх цэгээс харах чиглэлийн
         дагуу бага зэрэг дотогш орж, тэр нүдний блокийг торноос хайна. */
      const meta = blockInfo.current, view = viewRef.current;
      const { slice } = blkRef.current;
      const data = await blockCache.current[mm]?.catch(() => null);
      if (!isCurrent()) return;
      const b = meta && data && view && h.mapPoint ? pickBlock(data, meta, slice, h.mapPoint, view) : -1;
      if (!meta || !data || b < 0) { setTip(null); return; }
      const tx = BLOCK_TEXT[lg], cell = meta.cell, c = data.cls[b];
      const sx = data.di[b] * cell[0], sy = data.dj[b] * cell[1], sz = data.dk[b] * cell[2];
      const rl = data.info.rl0 + data.k[b] * cell[2];
      setTip({ x, y, title: tx.classes[c] ?? t.blkTitle,
               key: `${ROMAN[data.info.from]} → ${ROMAN[data.info.to]} · RL ${fmt(rl, 0)}–${fmt(rl + sz, 0)} м`,
               rows: [
                 { label: "Cu", value: `${data.cu[b].toFixed(3)} %`, color: meta.classes[c]?.color },
                 { label: "Mo", value: `${data.mo[b].toFixed(4)} %` },
                 { label: tx.zone, value: tx.types[meta.types[data.typ[b]]] ?? "—" },
                 { label: tx.domain, value: tx.domains[meta.domains[data.dom[b]]] ?? "—" },
                 { label: tx.rclassL, value: tx.rclass[meta.rclass[data.rc[b]]] ?? "—" },
                 { label: tx.density, value: `${data.bd[b].toFixed(2)} ${tx.densityU}` },
                 { label: tx.mass, value: `${fmt(sx * sy * sz * data.bd[b], 0)} ${tx.massU}` },
                 { label: tx.size, value: `${sx} × ${sy} × ${sz} м` },
               ], hint: `${tx.hint} · ${tx.clickHint}` });
      return;
    }
    if (h.kind === "pitmesh") {
      setTip({ x, y, title: t.pit, key: "DWG · multipatch",
               rows: [{ label: t.uM3, value: fmt(sumCol(mm, C.TSUL), 0), color: "var(--g4)" }],
               hint: t.clickIso });
      return;
    }

    if (h.kind === "bld") {
      setTip({ x, y, title: t.bu + " …", key: "Multipatch_EMC · FeatureServer", rows: [] });
      const rec = await bldLookup(h.mapPoint);
      if (!isCurrent()) return;
      if (!rec) { setTip(null); return; }
      if (num1(rec.type1) !== BU_TYPE) {
        setTip({ x, y, title: rec.ner || t.bldPlain,
                 key: `Multipatch_EMC · type1 = ${rec.type1 ?? "—"}`,
                 rows: [{ label: t.ctxOnly, value: "—" }] });
        return;
      }
      const v = sumCol(mm, C.BU);
      const cu = v ? (metalSum(mm, "cut", C.BU) / (v * 1000)) * 100 : 0;
      setTip({ x, y, title: rec.ner || t.bu, key: `${t.bu} · Сар ${mm} · type1 = 1`,
               rows: [
                 { label: names[C.BU].split("—").pop()!.trim(), value: `${fmt(v, 1)} ${t.uKt}`, color: "var(--s1)" },
                 { label: "Cu", value: cu ? cu.toFixed(3) + " %" : "—" },
               ], hint: t.clickPin });
      return;
    }

    /* овоолго */
    const ci = PILE2COL[h.name];
    if (ci === undefined) {
      setTip({ x, y, title: h.name, key: "RefName = " + h.name, rows: [{ label: t.noData, value: "—" }] });
      return;
    }
    const v = sumCol(mm, ci);
    const isM3 = ci === C.HOOSON;
    const col = isM3 ? "var(--s4)" : ci === C.OV9A || ci === C.OV9B ? "var(--s3)" : "var(--s2)";
    const cu = v ? (metalSum(mm, "cut", ci) / (v * 1000)) * 100 : 0;
    const lbl = names[ci].split("—").pop()!.trim();
    setTip({ x, y, title: h.name, key: `Сар ${mm} · ${lbl}`,
             rows: [
               { label: lbl, value: `${v ? fmt(v, 1) : "—"} ${isM3 ? t.uM3 : t.uKt}`, color: col },
               { label: "Cu", value: cu ? cu.toFixed(3) + " %" : "—" },
             ], hint: t.clickPin });
  }

  /* --------------------------------------------------------- тусгаарлах */
  const prevVis = useRef<Record<string, boolean>>({});
  /* «Зөвхөн уурхай» үед ГАНЦХАН энэ давхарга үлдэнэ. Өмнө нь унтраах
     давхаргууд гараар бичигдсэн жагсаалт байсан тул тэнд ороогүй машин,
     хаягдлын урсгал, нэмсэн сервис асаалттай хэвээр үлдэж, «зөвхөн»
     гэдэг нь худал болж байв. Одоо жагсаалтыг давхаргын бүртгэлээс
     гаргаж авна — шинэ давхарга нэмэгдсэн ч мартагдахгүй. */
  const ISO_KEEP = "pitMesh";

  function toggleIsolate() { applyIsolate(!isolated); }

  function applyIsolate(on: boolean) {
    const view = viewRef.current, map = mapRef.current, L = layersRef.current;
    if (!view || !map || isoRef.current === on) return;
    if (tailInspection.current) closeTailInspection(false);
    setIsolated(on);
    isoRef.current = on;

    if (on) {
      prevEnvironment.current = {
        background: view.environment.background?.clone(),
        lighting: view.environment.lighting,
        atmosphereEnabled: view.environment.atmosphereEnabled,
        starsEnabled: view.environment.starsEnabled,
      };
      prevVis.current = {};
      Object.keys(L).forEach((k) => {
        if (k === ISO_KEEP || k === "truckAlerts" || !L[k]) return;
        prevVis.current[k] = L[k].visible;
        L[k].visible = false;
      });
      prevBasemap.current = map.basemap ?? null;
      map.basemap = null as any;
      map.ground.opacity = 0;
      view.environment.background = { type: "color", color: [8, 17, 27, 0] };
      view.environment.atmosphereEnabled = false;
      view.environment.starsEnabled = false;
      /* Камерыг дагасан гэрэл нь эргүүлж харахад шатлал, блокийг тод үлдээнэ. */
      view.environment.lighting = new VirtualLighting({ directShadowsEnabled: true });
    } else {
      /* Унтраасан яг тэр давхаргуудыг өмнөх төлөвт нь буцаана */
      Object.keys(prevVis.current).forEach((k) => {
        if (L[k]) L[k].visible = prevVis.current[k];
      });
      /* Хэрэглэгч галерейгээс сонгосон суурь зургийг сэргээнэ */
      map.basemap = prevBasemap.current ?? Basemap.fromId("satellite")!;
      map.ground.opacity = GROUND_OPACITY[groundStep];
      const environment = prevEnvironment.current;
      if (environment) {
        view.environment.background = environment.background;
        view.environment.lighting = environment.lighting;
        view.environment.atmosphereEnabled = environment.atmosphereEnabled;
        view.environment.starsEnabled = environment.starsEnabled;
      }
    }

    document.body.classList.toggle("isolated", on);
    /* Сарын DWG мэш нь ЗӨВХӨН тусгаарлах горимд гарна — энгийн горимд
       бодит мэштэй яг нэг зайг эзэлж, хоёулаа бүдгэрдэг. Хэрэгтэй бол
       «Давхарга»-аас гараар асааж болно. */
    L.pitMesh.visible = on;
    if (L.blocks) L.blocks.visible = on;
    L.pitMesh.graphics.forEach((g: Graphic) => { g.symbol = meshSymbol(on); });
    if (on) setTimeout(() => zoomTo(L.pitMesh, undefined, 1.05), 60);
    syncRoadIso();
    syncVisible();
  }

  /* ------------------------------------------------ сар солиход мэш солино */
  useEffect(() => {
    if (!ready) return;
    showMesh(m);
    showBlocks();
    rebuildFlow();          /* машины тоо сарын тонноор өөрчлөгдөнө */
  }, [m, ready]); // eslint-disable-line

  /* Блокийн зүсэлт өөрчлөгдөхөд — гулсуулагчийг чирэх үед
     кадр бүрт нэг л удаа дахин зурна */
  useEffect(() => {
    if (!ready) return;
    if (blockFrame.current !== null) cancelAnimationFrame(blockFrame.current);
    blockFrame.current = requestAnimationFrame(() => { blockFrame.current = null; void showBlocks(); });
  }, [blkSlice, ready]); // eslint-disable-line

  /* Зүсэлт сонгоход блок харагдахгүй байвал (энгийн горим, давхарга
     унтраалттай) Open pit горим руу шилжиж, блокийн давхаргыг асаана */
  function changeSlice(next: BlockSlice) {
    if (next.mode !== "off") {
      if (!isoRef.current) applyIsolate(true);
      const L = layersRef.current;
      if (L.blocks && !L.blocks.visible) { L.blocks.visible = true; syncVisible(); }
    }
    setBlkSlice(next);
  }

  /* Өөрчлөлтийн тодруулгыг асаах / унтраах */
  useEffect(() => {
    if (ready) void paintPit(m);
  }, [pitChange]); // eslint-disable-line

  /* ------------------------------------------------------- Esc товчлуур */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && tailInspection.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeTailInspection();
        return;
      }
      if (e.key === "Escape" && isolated) applyIsolate(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  /* --------------------------------------------- ил уурхайн сервис нэмэх */
  async function loadPitService() {
    const url = pitUrl.trim();
    if (!url) return;
    setPitMsg({ text: "…", cls: "" });
    const L = layersRef.current, map = mapRef.current!;
    const Ctor: any = /SceneServer/i.test(url) ? SceneLayer : FeatureLayer;
    const lyr = new Ctor({ url, outFields: ["*"], popupEnabled: false, title: "pit-service" });
    try {
      await lyr.load();
      if (L.pitSvc) map.remove(L.pitSvc);
      L.pitSvc = lyr;
      map.add(lyr);
      L.pitMesh.visible = false;             /* локал GLB-г унтраана */
      setPitMsg({ text: `${t.pitOk} · ${lyr.title ?? url.split("/").slice(-2).join("/")}`, cls: "ok" });
      syncVisible();
    } catch (err: any) {
      setPitMsg({ text: `${t.pitErr}: ${err?.message ?? err}`, cls: "err" });
    }
  }

  /* ------------------------------------------------------------- рендер */
  const L = layersRef.current;
  /* `also` — нэг мөрөөр хамт асаж унтрах давхаргууд */
  const rows: { key: string; n: string; c: string; also?: string[] }[] = [
    ...(L.pitSvc ? [{ key: "pitSvc", n: "Ил уурхай · сервис", c: "var(--g6)" }] : []),
    { key: "im",      n: t.lyIm,     c: "#9aa6b2" },
    { key: "pitMesh", n: t.lyMesh,   c: isolated ? "#c8bfb0" : "#8d7f70" },
    ...(hasBlocks ? [{ key: "blocks", n: t.lyBlocks, c: blockInfo.current?.classes[2]?.color ?? "#f2d132" }] : []),
    { key: "pile3d",  n: t.lyPile3d, c: PILE_HEX },
    { key: "pile2d",  n: t.lyPile2d, c: PILE_EDGE_HEX },
    { key: "dam",     n: t.lyDam,    c: "var(--water)" },
    { key: "hazard",  n: t.lyHazard, c: HAZARD_COLORS[2] },
    { key: "bld",     n: t.lyBld,    c: BLD_COLOR.bu },
    { key: "trucks",  n: t.lyMachines, c: TRUCK_COLOR.bu, also: ["excavators"] },
    { key: "tails",   n: t.lyTails,  c: "var(--water)" },
  ];

  return (
    <>
      {/* Газрын зургийн товчнууд — Esri-ийн зүүн дээд баганад, суурь
          зургийн дүрсийн доор. Нэрийг нь title-д үлдээв. */}
      {createPortal(
        <BlockSlicePanel meta={blockInfo.current} period={m} lang={lang}
                         slice={blkSlice} onSlice={changeSlice} />,
        sliceHost,
      )}
      {createPortal(
        <>
          <button className="esri-widget--button" aria-pressed={isolated} onClick={toggleIsolate}
                  title={t.btnIso} aria-label={t.btnIso}>
            {/* ил уурхай — доош нарийссан шатлал */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 6h19" /><path d="M5 6v3.5h14V6" /><path d="M7.5 9.5V13h9V9.5" />
              <path d="M10 13v3.5h4V13" />
            </svg>
          </button>
          <button className="esri-widget--button" aria-pressed={tailInspect}
                  disabled={tailStatus !== "ready"}
                  onClick={() => tailInspect ? closeTailInspection() : inspectTailings()}
                  title={tailStatus === "loading" ? t.flowLoading : tailStatus === "error" ? t.flowUnavailable : t.flowInspect}
                  aria-label={t.flowInspect}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3c-2.4 3.6-6 7-6 11a6 6 0 0 0 12 0c0-4-3.6-7.4-6-11Z" />
              <path d="M9 14h6m-2-2 2 2-2 2" />
            </svg>
          </button>
          <button className="esri-widget--button" aria-pressed={layersOpen}
                  onClick={() => {
                    if (!layersOpen) closeTailInspection(false);
                    setLayersOpen((v) => !v);
                  }} title={t.btnLayers} aria-label={t.btnLayers}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" /><path d="m3.5 12 8.5 4.5 8.5-4.5" />
              <path d="m3.5 16 8.5 4.5 8.5-4.5" />
            </svg>
          </button>
          {/* Зөвхөн газрын зургийг дэлгэц дүүрэн. Esc-ээр буцна. */}
          <button className="esri-widget--button" aria-pressed={mapMax}
                  onClick={() => setMapMax(!mapMax)}
                  title={(mapMax ? t.btnFullOff : t.btnFull) + " · " + t.btnFullHint}
                  aria-label={mapMax ? t.btnFullOff : t.btnFull}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {mapMax
                ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
            </svg>
          </button>
        </>,
        btnHost,
      )}

      <div className={"mapwrap" + (mapMax ? " with-truck-strip" : "")}>
        <div id="viewDiv" ref={divRef} />
        {tailInspect && (
          <TailingsInspector transparency={tailTransparency}
            sliced={tailSliced} depth={TAIL_DEPTH} diameter={PIPE_D}
            onTransparencyChange={changeTailTransparency}
            onTransparencyToggle={toggleTailTransparency} onSliceToggle={toggleTailSlice}
            onFocus={() => focusTailings()} onOverview={() => focusTailings(false)}
            onClose={() => closeTailInspection()} />
        )}
        {ready && visible.trucks && hazardStatus !== "ready" && (
          <div className="hazard-status" role="status">
            <span>{hazardStatus === "error" ? t.hzUnavailable : t.hzLoading}</span>
            {hazardStatus === "error" && (
              <button className="ghost sm" onClick={() => void loadHazardZones()}>{t.hzRetry}</button>
            )}
          </div>
        )}
        {mapMax && (
          <TruckTelemetryStrip
            trucks={truckTelemetry}
            lang={lang}
            selectedId={selectedTruck}
            onSelect={focusTruck}
            emptyState={!ready ? "loading" : !visible.trucks ? "hidden" : "empty"}
          />
        )}

        {/* Тусгаарлах горимд толгойн сарын сонголт харагдахгүй байж болох
            тул (бүтэн дэлгэц, доош гүйлгэсэн байдал) газрын зураг дээр
            өөрөө нэг хувилбар гаргана. Ижил `setM`-ийг дуудна — хоёр
            газарт хоёр өөр төлөв үүсэхгүй. */}
        {isolated && (
          <div className="mmonths" role="group" aria-label={t.lMonth}>
            {["I", "II", "III", "IV", "V", "VI"].map((lbl, i) => (
              <button key={lbl} aria-pressed={i + 1 === m}
                      aria-label={`${i + 1}-р сар`}
                      /* «Нийт» горимд сарын өнгө доор нь зураас болж гарна */
                      className={pitChange === "all" && MONTH_COLORS[i + 1] ? "mc" : undefined}
                      style={pitChange === "all" && MONTH_COLORS[i + 1]
                        ? { "--mc": `rgb(${MONTH_COLORS[i + 1].join(",")})` } as React.CSSProperties : undefined}
                      title={pitChange === "all" && allChg?.byMonth[i + 1] !== undefined
                        ? `${MON_L[lang][i]}: ${fmt(allChg.byMonth[i + 1], 1)} ${t.uHa}` : undefined}
                      onClick={() => setM(i + 1)}>{lbl}</button>
            ))}
            {/* Өмнөх сарын хэмжилтээс өөрчлөгдсөн гадаргуу — улаанаар;
                «Нийт» — бүх сарынхыг нэгтгэж, сар бүрийг өөр өнгөөр */}
            <span className="mmsep" aria-hidden="true" />
            <button className="mchg" aria-pressed={pitChange === "month" && m > 1} disabled={m === 1}
                    onClick={() => setPitChange((v) => v === "month" ? "off" : "month")}
                    title={m === 1 ? t.chgNone : t.chgHint}>
              <i aria-hidden="true" />
              {t.chgBtn}
              {pitChange === "month" && m > 1 && changeHa !== null && <small>{fmt(changeHa, 1)} {t.uHa}</small>}
            </button>
            <button className="mchg mall" aria-pressed={pitChange === "all"}
                    onClick={() => setPitChange((v) => v === "all" ? "off" : "all")}
                    title={t.chgAllHint}>
              <i aria-hidden="true" />
              {t.chgAll}
              {pitChange === "all" && allChg && <small>{fmt(allChg.total, 1)} {t.uHa}</small>}
            </button>
          </div>
        )}

        {/* Олборлосон блокийн Cu агуулгын тайлбар — «Зөвхөн уурхай» горимд.
            Хугацааг дарахад тэр сарын блок асна, сонгосон хугацааг дахин
            дарвал блок унтарна (самбар хугацааны товчтойгоо үлдэнэ). */}
        {isolated && hasBlocks && blockInfo.current && (
          <BlockLegend
            meta={blockInfo.current}
            period={m}
            lang={lang}
            shown={!!visible.blocks}
            onPeriod={(p) => {
              const lyr = layersRef.current.blocks;
              if (!lyr) return;
              if (p === m && lyr.visible) lyr.visible = false;
              else { setM(p); lyr.visible = true; }
              syncVisible();
            }}
          />
        )}


        {layersOpen && (
          <div className="layerbox">
            <div className="lbh">{t.lyTitle}</div>
            <div>
              {rows.map((r) => {
                const lyr = L[r.key];
                if (!lyr) return null;
                return (
                  <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <button className="lrow" aria-pressed={!!visible[r.key]}
                            onClick={() => {
                              const shown = !lyr.visible;
                              if (r.key === "tails") closeTailInspection(false);
                              lyr.visible = shown;
                              r.also?.forEach((k) => { if (L[k]) L[k].visible = shown; });
                              syncVisible();
                            }}>
                      <span className="sw" style={{ background: r.c }} />
                      <span>{r.n}</span>
                      <span className="tg" />
                    </button>
                    <button className="zoomto" title={r.key === "tails" ? t.flowInspect : t.zoomTo}
                            disabled={r.key === "tails" && tailStatus !== "ready"}
                            onClick={() => r.key === "tails" ? inspectTailings()
                              : zoomTo(lyr, r.key === "bld" ? `type1 = ${BU_TYPE}` : undefined)}>⌖</button>
                  </div>
                );
              })}
            </div>

            <div className="lbh" style={{ marginTop: 4 }}>{t.ground}</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {GROUND_OPACITY.map((o, i) => (
                <button key={i} className="ghost sm" aria-pressed={groundStep === i}
                        onClick={() => { closeTailInspection(false); setGroundStep(i); mapRef.current!.ground.opacity = o; }}>
                  {GROUND_NM[lang][i]}
                </button>
              ))}
            </div>

            <div className="lbsep" />
            <div className="lbh">{t.pitAdd}</div>
            <div className="pitrow">
              <input value={pitUrl} onChange={(e) => setPitUrl(e.target.value)} type="url"
                     spellCheck={false} placeholder="https://services7.arcgis.com/.../SceneServer" />
              <button className="ghost sm" onClick={loadPitService}>{t.btnLoad}</button>
            </div>
            {pitMsg.text && <div className={"lbnote " + pitMsg.cls}>{pitMsg.text}</div>}
          </div>
        )}

        <div className={"loading" + (ready ? " done" : "")}>
          <span className="spin" />
          <span>{t.loadingTxt}</span>
        </div>
      </div>
    </>
  );
}
