import L from "leaflet";

/**
 * Esri суурь зургууд (ArcGIS Online-ы basemap gallery-тэй ижил).
 * Raster tile хувилбарыг ашигладаг тул API key шаардлагагүй.
 * Топографи нь ArcGIS Online-ын одоогийнх шиг вектор зураг + сүүдэрлэлт: хуучин raster хувилбар
 * томролт бүрд өөр эх сурвалжтай тул зам, өндрийн шугам, гадарга нь харьцуулахад зөрүүтэй харагддаг.
 */
const AGO = "https://server.arcgisonline.com/ArcGIS/rest/services/";
const tile = (service: string) => `${AGO}${service}/MapServer/tile/{z}/{y}/{x}`;

export type BasemapDef = {
  key: string;
  title: string;
  base: string[];
  reference?: string[];
  maxNativeZoom?: number; // үүнээс том масштабт tile-ыг томруулж харуулна
  /** Вектор зургийн item — WebGL байхгүй эсвэл ачаалж чадаагүй бол `base` raster руу буцна */
  vector?: { item: string; under: string; underMaxZoom: number };
  previewZoom?: number;
};

export const BASEMAPS: BasemapDef[] = [
  // maxNativeZoom — Эрдэнэтийн орчимд Esri бодит зурагтай хамгийн том масштаб (2026-11 шалгасан).
  // Түүнээс цааш «Map data not yet available» гарахын оронд сүүлийн tile-ыг томруулж харуулна.
  { key: "imagery", title: "Хиймэл дагуул (Imagery)", base: [tile("World_Imagery")], maxNativeZoom: 17 },
  {
    key: "hybrid",
    title: "Хиймэл дагуул + нэр (Hybrid)",
    base: [tile("World_Imagery")],
    reference: [tile("Reference/World_Boundaries_and_Places"), tile("Reference/World_Transportation")],
    maxNativeZoom: 17,
  },
  {
    key: "topo",
    title: "Топографи (Topographic)",
    base: [tile("World_Topo_Map")],
    maxNativeZoom: 17,
    vector: { item: "7dc6cea0b1764a1f9af2e679f642f0f5", under: tile("Elevation/World_Hillshade"), underMaxZoom: 13 },
  },
  { key: "streets", title: "Гудамж (Streets)", base: [tile("World_Street_Map")], maxNativeZoom: 17 },
  { key: "terrain", title: "Гадаргын хэлбэр (Terrain)", base: [tile("World_Terrain_Base")], reference: [tile("Reference/World_Reference_Overlay")], maxNativeZoom: 9, previewZoom: 9 },
  { key: "hillshade", title: "Сүүдэрлэлт (Hillshade)", base: [tile("Elevation/World_Hillshade")], maxNativeZoom: 13 },
  { key: "dark", title: "Бараан саарал (Dark Gray)", base: [tile("Canvas/World_Dark_Gray_Base")], reference: [tile("Canvas/World_Dark_Gray_Reference")], maxNativeZoom: 16 },
  { key: "light", title: "Цайвар саарал (Light Gray)", base: [tile("Canvas/World_Light_Gray_Base")], reference: [tile("Canvas/World_Light_Gray_Reference")], maxNativeZoom: 16 },
  { key: "natgeo", title: "National Geographic", base: [tile("NatGeo_World_Map")], maxNativeZoom: 12, previewZoom: 12 },
  { key: "osm", title: "OpenStreetMap", base: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"] },
];

/** Webmap-ын basemap нэр/URL-аас манай жагсаалтын түлхүүр */
export function basemapKeyFor(title?: string | null, urls: string[] = []): string {
  const t = (title ?? "").toLowerCase();
  const u = urls.join(" ").toLowerCase();
  if (t.includes("hybrid")) return "hybrid";
  if (t.includes("imagery") || u.includes("world_imagery")) return "imagery";
  if (t.includes("topo") || u.includes("topo")) return "topo";
  if (t.includes("street") || t.includes("navigation")) return "streets";
  if (t.includes("terrain")) return "terrain";
  if (t.includes("hillshade") || u.includes("hillshade")) return "hillshade";
  if (t.includes("dark")) return "dark";
  if (t.includes("gray") || t.includes("grey")) return "light";
  if (t.includes("national geographic") || u.includes("natgeo")) return "natgeo";
  if (t.includes("openstreetmap") || t.includes("osm")) return "osm";
  return "imagery";
}

// Эрдэнэтийн уурхайн орчмын нэг tile — сонголтын жижиг зурагт
const PREVIEW_AT = { lat: 49.021, lon: 104.122 };
function preview(b: BasemapDef): string {
  const z = b.previewZoom ?? 12;
  const n = 2 ** z;
  const lat = (PREVIEW_AT.lat * Math.PI) / 180;
  const x = Math.floor(((PREVIEW_AT.lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n);
  return b.base[0].replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

const STORE_KEY = "emc-basemap";

const webglOk = () => {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
};

/** Өндрийн тэмдэгтүүд («1557 m») Эрдэнэтийн орчмыг бүрхэж байсан тул хоорондын зайг ихэсгэж сийрэгжүүлнэ */
const tuneStyle = (hideLabels?: RegExp) => (style: { layers: { id: string; layout?: Record<string, unknown> }[] }) => {
  for (const l of style.layers) {
    if (l.id === "Spot elevation") l.layout = { ...l.layout, "text-padding": 70 };
    if (hideLabels?.test(l.id)) l.layout = { ...l.layout, visibility: "none" };
  }
  return style;
};

const LAND_BG = "#edede6";

type GlBridge = {
  _glMap: { _actualCanvas: HTMLElement; redraw: () => void };
  _zooming: boolean;
  _update: () => void;
  _transitionEnd: () => void;
  _zoomEnd: () => void;
};

/**
 * Вектор зураг томролтын төгсгөлийг хөдөлгөөний transitionend-ээс хойш нэг кадрын дараа хийдэг тул дараалсан томролтод
 * шинэ хөдөлгөөний дундуур canvas-ыг буцааж, суурь зураг давхаргаас хоцордог. Leaflet-ийн zoomend-д нэгтгэж,
 * хөдөлгөөнгүйгээр буцаагаад шууд зурна — давхаргууд ч яг тэр мөчид шинэ томролтод шилждэг.
 */
function syncZoomEnd(gl: GlBridge) {
  gl._transitionEnd = () => {};
  gl._zoomEnd = () => {
    const canvas = gl._glMap._actualCanvas;
    canvas.style.transition = "none";
    L.DomUtil.setTransform(canvas, L.point(0, 0), 1);
    gl._zooming = false;
    gl._update();
    gl._glMap.redraw();
    void canvas.offsetWidth; // transition-гүй төлөвийг тогтооно
    canvas.style.transition = "";
  };
}

// Вектор зургийн сан том тул зөвхөн хэрэгтэй үед ачаална
const loadVector = () =>
  Promise.all([import("esri-leaflet-vector"), import("maplibre-gl/dist/maplibre-gl.css")]).then(([m]) => m.vectorTileLayer);

export function rememberedBasemap(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

/**
 * Газрын зурагт суурь зураг сонгох самбар нэмнэ (ArcGIS Basemap Gallery шиг).
 * remember=true бол сонголтыг энэ хөтөч дээр хадгална.
 */
export function addBasemapGallery(map: L.Map, initialKey: string, remember = false, hideLabels?: RegExp): () => void {
  let current: L.Layer[] = [];
  let activeKey = initialKey;
  let disposed = false;
  let applyGen = 0;
  // Нэр, хилийн (reference) давхарга — өгөгдлийн давхаргын дээр, хулганы үйлдэл саадгүй
  const labelPane = () => {
    if (!map.getPane("bmLabels")) {
      const pane = map.createPane("bmLabels");
      pane.style.zIndex = "450";
      pane.style.pointerEvents = "none";
    }
    return "bmLabels";
  };

  const apply = (key: string) => {
    const def = BASEMAPS.find((b) => b.key === key) ?? BASEMAPS[0];
    current.forEach((l) => map.removeLayer(l));
    const opts = { maxZoom: 20, maxNativeZoom: def.maxNativeZoom ?? 19, attribution: key === "osm" ? "© OpenStreetMap" : "Esri" };
    activeKey = def.key;
    const raster = () => {
      map.getContainer().style.background = "";
      current.forEach((l) => map.removeLayer(l));
      current = [
        ...def.base.map((u) => L.tileLayer(u, { ...opts, pane: "tilePane" })),
        ...(def.reference ?? []).map((u) => L.tileLayer(u, { ...opts, pane: labelPane() })),
      ];
      current.forEach((l) => {
        l.addTo(map);
        (l as L.TileLayer).bringToBack?.();
      });
      // Лавлах (нэрийн) давхаргыг дээр нь гаргана
      current.slice(def.base.length).forEach((l) => (l as L.TileLayer).bringToFront?.());
    };
    const vec = def.vector;
    if (vec && webglOk()) {
      // Сүүдэрлэлт хамгийн доор, дээр нь вектор (z-index-гүй), түүний дээр зурган давхаргууд (tilePane z-index 1)
      // Вектор зураг тунгалаг тул сүүдэрлэлт ачаалагдах зуурт бараан дэвсгэр бус газрын өнгө харагдана
      map.getContainer().style.background = LAND_BG;
      const under = L.tileLayer(vec.under, { maxZoom: 20, maxNativeZoom: vec.underMaxZoom, attribution: "Esri", pane: "tilePane", zIndex: -1 });
      current = [under];
      under.addTo(map);
      const gen = ++applyGen;
      const stale = () => disposed || gen !== applyGen;
      loadVector()
        .then((vectorTileLayer) => {
          if (stale()) return;
          const layer = vectorTileLayer(vec.item, { style: tuneStyle(hideLabels) }) as unknown as L.Layer;
          // Загвар ачаалагдсаны дараа л нэмнэ — бэлэн болоогүй давхаргыг map-аас хасаж болдоггүй
          layer.once("ready", () => {
            if (stale()) return;
            syncZoomEnd((layer as unknown as { _maplibreGL: GlBridge })._maplibreGL);
            current.push(layer);
            layer.addTo(map);
          });
          layer.once("load-error", () => !stale() && raster());
        })
        .catch(() => !stale() && raster());
    } else {
      applyGen++;
      raster();
    }
    if (remember) {
      try {
        localStorage.setItem(STORE_KEY, def.key);
      } catch {
        /* хадгалах боломжгүй */
      }
    }
    panel.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.key === activeKey));
  };

  const Gallery = L.Control.extend({
    onAdd() {
      const wrap = L.DomUtil.create("div", "leaflet-bar bm-gallery");
      const toggle = L.DomUtil.create("a", "bm-toggle", wrap) as HTMLAnchorElement;
      toggle.href = "#";
      toggle.title = "Суурь зураг (Esri basemap)";
      toggle.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>';
      wrap.appendChild(panel);
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      L.DomEvent.on(toggle, "click", (e) => {
        L.DomEvent.preventDefault(e);
        wrap.classList.toggle("open");
      });
      return wrap;
    },
  });

  const panel = document.createElement("div");
  panel.className = "bm-panel";
  panel.innerHTML = `<div class="bm-title">Суурь зураг · Esri</div>`;
  const grid = document.createElement("div");
  grid.className = "bm-grid";
  for (const b of BASEMAPS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.key = b.key;
    btn.innerHTML = `<img src="${preview(b)}" alt="" loading="lazy"><span>${b.title}</span>`;
    btn.addEventListener("click", () => apply(b.key));
    grid.appendChild(btn);
  }
  panel.appendChild(grid);

  const control = new Gallery({ position: "topright" });
  control.addTo(map);
  apply(initialKey);

  return () => {
    disposed = true;
    map.getContainer().style.background = "";
    control.remove();
    current.forEach((l) => map.removeLayer(l));
  };
}
