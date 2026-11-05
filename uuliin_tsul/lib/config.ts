/* ==========================================================================
   Сервисүүд, Excel-ийн баганын зураглал, холболтын түлхүүрүүд
   --------------------------------------------------------------------------
   ЗАРЧИМ: ArcGIS сервисээс ЗӨВХӨН ГЕОМЕТР авна. Бүх тоон утга
   «mes1-12 нэгтгэл 2023 ArcGIS.xlsx» -> «Нийт орд arcgis» sheet-ээс
   (public/data/excel.json) уншигдана.
   ========================================================================== */

const AGOL = "https://services7.arcgis.com/iErGCwr6emXIFjPR/arcgis/rest/services";

export const SVC = {
  /** Овоолго — 3D сцен */
  pileScene: `${AGOL}/${encodeURIComponent("Нийт_овоолго_2026")}/SceneServer`,
  /** Овоолго — 2D хүрээ */
  pile2d: `${AGOL}/Owoolgo_medee/FeatureServer/4`,
  /** Баяжуулах үйлдвэрээс хаягдлын далан руу — ГАЗАР ДООРХ хоолой.
   *  1 шугам, 43 орой, 4.36 км. Чиглэл: үйлдвэр -> далан. */
  tailLine: `${AGOL}/Bayjuulah_hayagdal_line/FeatureServer/0`,
  /** Хаягдлын далан */
  dam: `${AGOL}/Lake2024_update241016/FeatureServer/0`,
  /** ТЭЭВРИЙН замын тэнхлэг — 32 шугам, 76 км. Машины маршрут яг үүгээр
   *  тооцогдоно (tools/build_haul_routes.py -> public/data/haul_routes.json).
   *  Өмнөх `Road_truck` болон `Engineering_EMC/22` хоёрыг орлоно. */
  roadTruck: `${AGOL}/Road_truck_SL/FeatureServer/0`,
  /** Аюулын бүсийн зураг (2025-01-13) — 14 полигон, `code` 1/2/3 =
   *  аюулын түвшин (сервисийн өнгө: ногоон / улбар шар / улаан). */
  hazard: `${AGOL}/HAZARD_MAP/FeatureServer/0`,
  /** Ил уурхайн БОДИТ гадаргуу — фотограмметрийн integrated mesh.
   *  lon 104.107–104.144, lat 49.013–49.033 (2.7 x 2.2 км), z 1139–1460 м.
   *  ӨӨР ХОСТ дээр (EMC-ийн ArcGIS Enterprise) — TLS Let's Encrypt,
   *  CORS нь Origin-г тусгадаг тул браузераас шууд ачаалагдана.
   *  Өмнө нь AGOL-ийн `Mesh_Process2` байсан (илүү өргөн, овоолгыг ч
   *  хамардаг); энэ нь зөвхөн ил уурхайг нарийвчлан хамарна. */
  pitMesh3d: "https://arcgis.ubhub.mn/arcgis/rest/services/Hosted/emc_openpit_2/SceneServer",
  /** Үйлдвэрийн барилга — 3D сцен */
  bld: `${AGOL}/Multipatch_EMC/SceneServer`,
  /** Мөн барилгын атрибутыг ЭНДЭЭС уншина (доорх тайлбарыг үз) */
  bldFS: `${AGOL}/Multipatch_EMC/FeatureServer/0`,
} as const;

/** Ил уурхайн САР БҮРИЙН гадаргуу — маркшейдерийн DWG-ийн multipatch-ийг
 *  AGOL-д 3D object давхарга болгон publish хийсэн. Хөтөч гадаргууг холбогдох
 *  FeatureServer-ээс татаж, питийн 5 м-ийн торонд буулгана (lib/pitSource.ts).
 *  Шинэ сар нэмэхдээ энд мөр нэмэхэд хангалттай. */
export const PIT_SVC: Record<number, string> = {
  1: `${AGOL}/CMK_202301_1/FeatureServer/0`,
  2: `${AGOL}/CMK_202302/FeatureServer/0`,
  3: `${AGOL}/CMK_202303/FeatureServer/0`,
  4: `${AGOL}/CMK_202304/FeatureServer/0`,
  5: `${AGOL}/CMK_202305/FeatureServer/0`,
  6: `${AGOL}/CMK_202306/FeatureServer/0`,
};

/** Excel-ийн 15 утгын багана (D..R) -> индекс */
export const C = {
  NOOC: 0, BU_U: 1, AGU: 2, BOH: 3, HAY: 4, BOHP: 5, BU: 6,
  OV12: 7, OV14: 8, OV8A: 9, NIIT: 10, OV9A: 11, OV9B: 12,
  HOOSON: 13, TSUL: 14,
} as const;

export const COL_NAMES = {
  mn: [
    "Олборлосон үйлдвэрлэлийн нөөц (захын агуулга 0.25%)",
    "Үүнээс — Баяжуулах үйлдвэрт",
    "Үүнээс — Агуулахад гаргасан хүдэр (хаягдал)",
    "Бохирдол, нийт",
    "Захын агуулга 0.25% — хаягдал",
    "Захын агуулга 0.25% — бохирдол",
    "Нийт олборлосон хүдэр — Баяжуулах үйлдвэрт",
    "Нийт олборлосон хүдэр — Овоолго 12",
    "Нийт олборлосон хүдэр — Овоолго 14",
    "Нийт олборлосон хүдэр — Овоолго 8а",
    "Нийт олборлосон хүдэр — нийт",
    "Балансын бус хүдэр — 9а, 8, 9 овоолгод",
    "Балансын бус хүдэр — 9б овоолгод",
    "Хоосон чулуулаг — Овоолго №1, 4, 11",
    "Нийт уулын цул",
  ],
  en: [
    "Mined reserve (0.25% cut-off)",
    "of which — to concentrator",
    "of which — to storage (reject)",
    "Dilution, total",
    "0.25% cut-off — reject",
    "0.25% cut-off — dilution",
    "Total ore mined — to concentrator",
    "Total ore mined — Stockpile 12",
    "Total ore mined — Stockpile 14",
    "Total ore mined — Stockpile 8a",
    "Total ore mined — total",
    "Sub-grade ore — to piles 9a, 8, 9",
    "Sub-grade ore — to pile 9b",
    "Waste rock — piles №1, 4, 11",
    "Total rock moved",
  ],
} as const;

export const COL_UNITS = {
  mn: ["кт","кт","кт","кт","%","%","кт","кт","кт","кт","кт","кт","кт","м³","м³"],
  en: ["kt","kt","kt","kt","%","%","kt","kt","kt","kt","kt","kt","kt","m³","m³"],
} as const;

/* -------------------------------------------------------------- холболт */

/** Excel «Блок» -> овоолгын феатурын нэр (RefName / dugaar) */
export const BLK2PILE: Record<string, string> = {
  "12": "Овоолго 12",
  "14": "Овоолго 14",
  "8a": "Овоолго 8а",   // Excel-д латин «a», сервист кирилл «а»
  "2б": "Овоолго 2б",
};

/** Excel багана -> тухайн багана хаана очдог овоолгууд */
export const COL2PILES: Record<number, string[]> = {
  [C.OV12]:   ["Овоолго 12"],
  [C.OV14]:   ["Овоолго 14"],
  [C.OV8A]:   ["Овоолго 8а"],
  [C.OV9A]:   ["Овоолго 9а", "Овоолго 8", "Овоолго 9"],
  [C.OV9B]:   ["Овоолго 9б"],
  [C.HOOSON]: ["Овоолго 1", "Овоолго 4", "Овоолго 11"],
};

/** урвуу: овоолгын нэр -> Excel багана */
export const PILE2COL: Record<string, number> = {};
for (const ci of Object.keys(COL2PILES)) {
  for (const nm of COL2PILES[Number(ci)]) PILE2COL[nm] = Number(ci);
}

/** Excel-д дурдагдсан овоолгууд — ЗӨВХӨН эдгээр газрын зураг дээр гарна */
const EXCEL_PILES = Array.from(
  new Set([...Object.keys(PILE2COL), ...Object.values(BLK2PILE)]),
);

export function pileWhere(field: string): string {
  return `${field} IN (${EXCEL_PILES.map((n) => `'${n}'`).join(",")})`;
}

/**
 * Multipatch_EMC — үйлдвэрийн 532 барилга.
 *   type1 = 1  ->  БАЯЖУУЛАХ ҮЙЛДВЭР (54 феатур)  ->  Excel «Блок = БҮ»
 *   type1 = 2  ->  энгийн барилга    (478)        ->  зөвхөн орчны мэдээлэл
 *
 * Нэрээр ялгаж БОЛОХГҮЙ: «Том бутлуурын корпус» гэдэг нэр хоёуланд нь
 * давхардаж байна (4 нь type1=1, 9 нь type1=2).
 */
export const BU_TYPE = 1;

/** Барилгын өнгө нь СЕРВИС дээрээ тодорхойлогдсон — renderer дарахгүй */
export const BLD_COLOR = { bu: "#ffebbe", other: "#e1e1e1" } as const;

/** Овоолгын нэгдсэн өнгө — хул шар. Овоолгуудыг өнгөөр нь ялгахгүй,
 *  бүгд ижил өнгөтэй бөгөөд НЭРЭЭРЭЭ ялгагдана. */
export const PILE_COLOR: [number, number, number, number] = [201, 165, 84, 1];
export const PILE_HEX = "#c9a554";
/** Овоолгын ГАДНА тойрог — овоолгуудыг бие биеэс нь ялгах цорын ганц зураас */
export const PILE_EDGE: [number, number, number, number] = [52, 208, 174, 1];
export const PILE_EDGE_HEX = "#34d0ae";

/** Бүх Haul Truck ижил шар будагтай; аюулын түвшнийг тусдаа тэмдэг харуулна. */
export const TRUCK_COLOR = {
  bu:    "#f5b818",
  ore:   "#f5b818",
  waste: "#f5b818",
  park:  "#f5b818",
} as const;

/** Питийн хаялбарууд — Excel-ийн «Түвшин» баганын бүх утга */
export const ELEV = [
  1460, 1445, 1430, 1415, 1400, 1385, 1370, 1355, 1340, 1325,
  1310, 1295, 1280, 1265, 1250, 1235, 1220, 1205, 1190, 1175,
];


export const ELEV_URL =
  "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer";

/** Газрын гадаргуугийн тунгалаг байдал: бүтэн · хагас · унтраасан */
export const GROUND_OPACITY = [1, 0.62, 0];
export const GROUND_NM = {
  mn: ["Бүтэн", "Хагас", "Унтраах"],
  en: ["Solid", "Half", "Off"],
} as const;
