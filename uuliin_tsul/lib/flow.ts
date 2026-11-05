/* ==========================================================================
   Материалын урсгал: ил уурхай -> хүлээн авагч
   --------------------------------------------------------------------------
   Ачааны машины тоо, чиглэл бүгд EXCEL-ийн тоон дээр суурилна. Тухайн сарын
   тонн хэдий их байна тэр чиглэлд төдий олон машин явна.

   МАРШРУТ — `Road_truck_SL` сервисийн ЖИНХЭНЭ тээврийн замаар.
     32 шугам, 76 км. `tools/build_haul_routes.py` нь үүнийг граф болгож
     (20 м-ийн хүлцлээр зангилаа нэгтгэхэд 100 % холбогдоно), ачаалах цэгээс
     хүлээн авагч бүр рүү Dijkstra-аар хамгийн богино замыг тооцоод
     `public/data/haul_routes.json`-д бичнэ. Ажиллах үед энэ файлыг л уншина.

     Өмнө нь схемийн Безье муруй байсан: тухайн үед байсан `Engineering_EMC/22`
     давхарга бол CAD-ийн зурган давхарга байсан тул граф болгоход хамгийн том
     холбогдсон бүрэлдэхүүн нь ердөө 6 % гарч байв.

   ЗОГСОЛТ — зигзаг эргэлт дээр.
     Уулын замын шилжлэгт (switchback) машин зогсож, ухарч эргэдэг. Тиймээс
     чиглэл огцом эргэсэн цэгүүдийг илрүүлээд тэнд машиныг түр зогсооно.
   ========================================================================== */

import { C, SVC, TRUCK_COLOR } from "./config";
import { sumCol } from "./excel";

type DestCode = "BU" | "OV12" | "OV14" | "OV8A" | "OV9A" | "OV9B" | "HOOSON";

export interface Dest {
  code: DestCode;
  name: string;
  col: number;          // Excel-ийн багана
  lon: number; lat: number;
  color: string;
  path: [number, number][];   // явах зам (пит -> хүлээн авагч)
  back: [number, number][];   // БУЦАХ зам — зэрэгцээ эгнээ
  len: number;                // замын урт, м
  stub: number;               // сүлжээнээс хүлээн авагч хүртэлх зохиомол холбоос, м
}

interface FlowPt { lon: number; lat: number; z: number; s: number }
interface FlowRoute { dest: Dest; pts: FlowPt[]; len: number; stops: number[] }

export interface Truck {
  id: number;
  dest: DestCode;
  destName: string;
  lon: number; lat: number; z: number;
  heading: number;
  loaded: boolean;
  halted: boolean;      // эргэлт дээр зогсож байна уу
  parked: boolean;      // зогсоолын шугам дээр — хэзээ ч хөдлөхгүй
  tonnes: number;       // тухайн чиглэлийн сарын тонн
  color: string;
}

const M_LAT = 110540;
const mLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

function metres(a: { lon: number; lat: number }, b: { lon: number; lat: number }) {
  const dx = (b.lon - a.lon) * mLon((a.lat + b.lat) / 2);
  const dy = (b.lat - a.lat) * M_LAT;
  return Math.hypot(dx, dy);
}

/** Excel-ийн багана, өнгө, нэр. Кодууд haul_routes.json-той тохирно. */
const DEST_DEF: Record<DestCode, { name: string; col: number; color: string }> = {
  BU:     { name: "Баяжуулах үйлдвэр",  col: C.BU,     color: TRUCK_COLOR.bu },
  OV12:   { name: "Овоолго 12",         col: C.OV12,   color: TRUCK_COLOR.ore },
  OV14:   { name: "Овоолго 14",         col: C.OV14,   color: TRUCK_COLOR.ore },
  OV8A:   { name: "Овоолго 8а",         col: C.OV8A,   color: TRUCK_COLOR.ore },
  OV9A:   { name: "Овоолго 9а · 8 · 9", col: C.OV9A,   color: TRUCK_COLOR.waste },
  OV9B:   { name: "Овоолго 9б",         col: C.OV9B,   color: TRUCK_COLOR.waste },
  HOOSON: { name: "Овоолго №1, 4, 11",  col: C.HOOSON, color: TRUCK_COLOR.waste },
};

/* Файлыг НЭГ л удаа татна — маршрут ба зогсоолын машин хоёулаа эндээс. */
let rawP: Promise<any> | null = null;
function rawRoutes(): Promise<any> {
  rawP ??= fetch("/data/haul_routes.json").then((r) => r.json()).catch(() => ({}));
  return rawP;
}

/** Зогсоолын шугам дээр хөдөлгөөнгүй байх машинууд */
export async function loadParked(): Promise<Truck[]> {
  const raw = await rawRoutes();
  const arr: [number, number, number][] = raw?._parked ?? [];
  return arr.map((p, i) => ({
    id: 10000 + i, dest: "BU" as DestCode, destName: "",
    lon: p[0], lat: p[1], z: 0, heading: p[2],
    loaded: false, halted: true, parked: true,
    /* Зогсоолын машин ч мөн шар Haul Truck; зогссон төлөв картад харагдана. */
    tonnes: 0, color: TRUCK_COLOR.park,
  }));
}

/** Урьдчилан тооцсон жинхэнэ маршрутуудыг уншина. */
export async function loadDests(): Promise<Dest[]> {
  const raw: Record<string, { name: string; pts: [number, number][];
                              back: [number, number][]; len: number; stub: number }>
    = await rawRoutes();
  const out: Dest[] = [];
  for (const code of Object.keys(DEST_DEF) as DestCode[]) {
    const r = raw[code];
    if (!r || !r.pts || r.pts.length < 2) continue;
    const d = DEST_DEF[code];
    const end = r.pts[r.pts.length - 1];
    out.push({
      code, name: d.name, col: d.col, color: d.color,
      path: r.pts, back: r.back ?? [...r.pts].reverse(), len: r.len, stub: r.stub,
      lon: end[0], lat: end[1],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ зогсолт */

/** Чиглэл ийм өнцгөөс их эргэвэл шилжлэг гэж үзнэ (градус). */
const TURN_DEG = 95;
/** Эргэлтийг хэмжих цонх (м).
 *  Road_truck_SL нь ~12 м алхамтай нягт тул нэг шилжлэг олон оройд
 *  хуваагдана — орой тус бүрээр өнцөг хэмжвэл олдохгүй. Гэхдээ цонх хэт
 *  урт бол (±55 м) энгийн тахиралт ч 70–85° өгч бүдгэрдэг. ±35 м үед
 *  жинхэнэ шилжлэг 151–164° гарч, энгийн тахиралт 90°-аас доош үлдэнэ. */
const TURN_WIN = 35;
/** Хоёр зогсолт хоорондоо ойрхон бол нэг гэж үзнэ (м). */
const STOP_MERGE = 90;

function ptAt(pts: FlowPt[], s: number) {
  const sc = Math.max(0, Math.min(pts[pts.length - 1].s, s));
  let i = 1;
  while (i < pts.length - 1 && pts[i].s < sc) i++;
  const a = pts[i - 1], b = pts[i];
  const t = (sc - a.s) / Math.max(1e-6, b.s - a.s);
  return { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t };
}

/**
 * Замын шилжлэгүүдийг олно.
 *
 * Орой тус бүрээр өнцөг хэмжвэл олдохгүй: нэг шилжлэг 4–6 оройд хуваагдаж,
 * тус бүр нь 30–40° л эргэсэн байдаг. Тиймээс тухайн цэгээс ӨМНӨХ ба ХОЙНОХ
 * `TURN_WIN` метрийн чиглэлийг харьцуулна.
 */
function findStops(pts: FlowPt[]): number[] {
  const len = pts[pts.length - 1].s;
  const raw: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const s = pts[i].s;
    if (s < TURN_WIN || s > len - TURN_WIN) continue;
    const a = ptAt(pts, s - TURN_WIN);
    const b = ptAt(pts, s + TURN_WIN);
    const la = pts[i].lat;
    const v1x = (pts[i].lon - a.lon) * mLon(la), v1y = (pts[i].lat - a.lat) * M_LAT;
    const v2x = (b.lon - pts[i].lon) * mLon(la), v2y = (b.lat - pts[i].lat) * M_LAT;
    const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
    if (n1 < 1 || n2 < 1) continue;
    const cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
    const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (turn >= TURN_DEG) raw.push(s);
  }
  /* Зэргэлдээ оройнууд нэг л шилжлэгийг зааж байвал нийлүүлнэ */
  const out: number[] = [];
  for (const s of raw) {
    if (!out.length || s - out[out.length - 1] > STOP_MERGE) out.push(s);
    else out[out.length - 1] = (out[out.length - 1] + s) / 2;
  }
  return out;
}

/** Урьдчилан тооцсон замаас FlowRoute үүсгэнэ. */
function makeRoute(dest: Dest, path: [number, number][]): FlowRoute {
  const pts: FlowPt[] = [];
  let s = 0;
  path.forEach((p, i) => {
    const q = { lon: p[0], lat: p[1], z: 0, s: 0 };
    if (i > 0) s += metres(pts[i - 1], q);
    q.s = s;
    pts.push(q);
  });
  return { dest, pts, len: s, stops: findStops(pts) };
}

function at(r: FlowRoute, s: number) {
  const sc = Math.max(0, Math.min(r.len, s));
  let i = 1;
  while (i < r.pts.length - 1 && r.pts[i].s < sc) i++;
  const a = r.pts[i - 1], b = r.pts[i];
  const t = (sc - a.s) / Math.max(1e-6, b.s - a.s);
  const lon = a.lon + (b.lon - a.lon) * t;
  const lat = a.lat + (b.lat - a.lat) * t;
  const dx = (b.lon - a.lon) * mLon(lat);
  const dy = (b.lat - a.lat) * M_LAT;
  return { lon, lat, z: 0, heading: (Math.atan2(dx, dy) * 180) / Math.PI };
}

/** Машин үргэлж УРАГШ явна: явах зам дуусмагц буцах зам руу шилжинэ.
    `cur` 0 = ачаалалтай (пит -> хүлээн авагч), 1 = хоосон (буцах). */
interface Unit { ro: FlowRoute; rb: FlowRoute; cur: 0 | 1; s: number; wait: number; next: number }

const SPEED_LOADED = 7;    // м/с (~25 км/ц)
const SPEED_EMPTY = 10;    // м/с (~36 км/ц)
const STOP_SEC = 2.2;      // шилжлэг (switchback) дээр зогсох хугацаа

/* ---------------------------------------------------- ачих / буулгах зогсолт
   Ил уурхайн ёроолд машин экскаваторын шанагыг хүлээж УДААН зогсдог —
   ачилт нь тээвэрлэлтээс хамаагүй удаан. Буулгах нь харьцангуй богино.
   Машин бүр өөр өөр хугацаа зарцуулна: дугаараас нь тогтмол (санамсаргүй
   биш) коэффициент гаргаж 0.5–1.9 дахин үржүүлнэ. Ингэснээр зарим нь
   түр зогсоод явна, зарим нь удаан зогсоно.
   Дараа нь ирсэн машинууд урдахаа хүлээж энгийн ДАРААЛАЛ үүсгэнэ —
   энэ нь хөөрөг барих дүрмээс өөрөө урган гарна. */
const LOAD_SEC = 22;       // экскаваторт ачигдах дундаж хугацаа
const DUMP_SEC = 7;        // овоолго / БҮ-д буулгах

/** Дугаараас тогтмол 0.5–1.9 коэффициент */
function jitter(id: number) {
  const r = ((Math.sin(id * 12.9898) * 43758.5453) % 1 + 1) % 1;
  return 0.5 + r * 1.4;
}

/* ------------------------------------------------- хөдөлгөөний зохицуулалт
   Нэг эгнээнд урдаа машинтай бол хурдаа GAP_SLOW-оос эхлэн бууруулж,
   GAP_STOP дотор бол бүрэн зогсоно. Өөр маршрутууд нийлэх цэгт нэг нь
   хүлээж, нөгөө нь өнгөрнө — давуу эрх: АЧААЛАЛТАЙ нь түрүүлнэ, тэнцвэл
   дугаар нь их нь. Энэ нь ХАТУУ эрэмбэ тул мухардал үүсэхгүй.

   МАШИН ХЭЗЭЭ Ч ШУГАМААСАА ГАРАХГҮЙ. Ямар ч хажуугийн шилжилт байхгүй —
   зөвхөн ХУРДАА бууруулж зогсоно. Урьд нь зогссон машиныг 7 м хажуу тийш
   татдаг байсан нь шугамаас үсэрч, дараа нь буцаж орох мэт харагддаг байв.
   Одоо: урдах машин удаашрах эсвэл зогсвол ард нь ирсэн нь мөн адил
   удаашрах, зогсох — өнгөрөх гэж хажуу тийш гарахгүй. Урьд нь машиныг явах чиглэлийнхээ
   баруун тийш 5–13 м түлхэж сөрөг урсгалыг зааглаж байсан нь машиныг
   шугамын голоор эсвэл замын гадуур гаргаж байв. Одоо `Road_truck_SL`-ийн
   ХОЁР ЗЭРЭГЦЭЭ шугамыг жинхэнээр нь ашиглана: явах зам нэг шугам, буцах
   зам нөгөө шугам (tools/build_haul_routes.py, 44–100 % тусдаа). Машин
   шугамынхаа ЯГ ДЭЭР явна. */
const GAP_SLOW = 65;       // м — эндээс хурдаа бууруулж эхэлнэ
const GAP_STOP = 26;       // м — эндээс дотогш зогсоно
const LANE_W = 9;          // м — хажуугийн зөрүү энэ дотор бол «нэг эгнээ»
/* ЗЭРЭГЦЭЭ ЯВАХААС сэргийлэх хайрцаг. Урд талын конус нь хажуу хажуугаар
   яваа машиныг ОГТ ХАРДАГГҮЙ (урд талын зай ≈ 0 тул шүүгдэж унана). Ижил
   хурдтай хоёр машин нэг хэсэгт зэрэгцэн орвол мөнхөд давхцаж явдаг байв.
   Одоо өөрийн хайрцагт өөр машин байвал давуу эрхгүй нь хурдаа хагаслана
   — БҮРЭН зогсохгүй: зогсоовол хэлбэлзэж, давхцал 547 -> 2 127 болж
   дордож байсан. Хагаслахад 547 -> 446 болж, зогсох хугацаа 2.5 -> 1.7 %
   болж буурсан. */
const BOX_L = 38;          // м — хайрцгийн урт (урд+хойд)
const BOX_W = 11;          // м — хайрцгийн өргөн
const BOX_SLOW = 0.5;      // хурдны коэффициент

/** Урагш явахад тааралдах дараагийн зогсолтын индекс */
function nextStop(r: FlowRoute, s: number) {
  for (let i = 0; i < r.stops.length; i++) if (r.stops[i] > s + 1) return i;
  return -1;
}

/** Тухайн сарын тонноор машинуудыг чиглэл тус бүрт хуваарилна */
export class FlowSim {
  private units: Unit[] = [];
  readonly trucks: Truck[] = [];
  readonly routes: FlowRoute[] = [];

  constructor(dests: Dest[], month: number, fleet = 14, parked: Truck[] = []) {
    const share = dests.map((d) => ({ d, v: sumCol(month, d.col) })).filter((x) => x.v > 0);
    const total = share.reduce((a, x) => a + x.v, 0) || 1;

    let id = 0;
    share.forEach((x, k) => {
      const ro = makeRoute(x.d, x.d.path);      // ачаалалтай, нэг эгнээ
      const rb = makeRoute(x.d, x.d.back);      // хоосон, зэрэгцээ эгнээ
      this.routes.push(ro, rb);
      /* Хамгийн багадаа 1 машин; үлдсэнийг тонны хувиар */
      const n = Math.max(1, Math.round((x.v / total) * fleet));
      for (let i = 0; i < n; i++) {
        /* Тал нь ачаалалтай, тал нь хоосон эгнээнд эхэлнэ */
        const cur: 0 | 1 = i % 2 === 0 ? 0 : 1;
        const r = cur === 0 ? ro : rb;
        const s = r.len * ((i / n + k * 0.13) % 1);
        this.units.push({ ro, rb, cur, s, wait: 0, next: nextStop(r, s) });
        this.trucks.push({
          id: id++, dest: x.d.code, destName: x.d.name,
          lon: 0, lat: 0, z: 0, heading: 0, loaded: i % 2 === 0,
          halted: false, parked: false,
          tonnes: x.v, color: x.d.color,
        });
      }
    });
    /* Зогсоолын машинуудыг ЭЦЭСТ нь нэмнэ. `step` нь `units`-ийн уртаар
       эргэлддэг тул эдгээр хэзээ ч хөдлөхгүй, тооцоололд ч орохгүй. */
    this.trucks.push(...parked);
    this.step(0);
  }

  /** i нь j-ээс давуу эрхтэй юу.
   *  ЗОГСООЛЫН машин хэзээ ч хөдлөхгүй тул түүнд ҮРГЭЛЖ бууж өгнө —
   *  эс тэгвэл явж яваа машин зогссоныг нь нэвт цохино.
   *  Бусад тохиолдолд: ачаалалтай нь түрүүлнэ, тэнцвэл дугаар их нь. */
  private wins(i: number, j: number) {
    const a = this.trucks[i], b = this.trucks[j];
    if (b.parked) return false;
    if (a.parked) return true;
    if (a.loaded !== b.loaded) return a.loaded;
    return a.id > b.id;
  }

  step(dt: number) {
    const n = this.units.length;          // хөдөлдөг машин
    const all = this.trucks.length;       // + зогсоолын машин
    const cur = (u: Unit) => (u.cur === 0 ? u.ro : u.rb);

    /* 1) Байрлал, чиглэлийг метрийн хавтгайд. Машин ҮРГЭЛЖ урагш явдаг
          тул чиглэл эргүүлэх шаардлагагүй. Зогсоолын машиныг ч оруулна —
          тэдгээр нь замын САААД болно. */
    const P: { x: number; y: number; fx: number; fy: number }[] = [];
    for (let i = 0; i < all; i++) {
      const t = this.trucks[i];
      let lon = t.lon, lat = t.lat, hd = t.heading;
      if (i < n) {
        const u = this.units[i];
        const p = at(cur(u), u.s);
        lon = p.lon; lat = p.lat; hd = p.heading;
        t.heading = hd;
        t.loaded = u.cur === 0;
      }
      const rad = (hd * Math.PI) / 180;
      P.push({ x: lon * mLon(lat), y: lat * M_LAT,
               fx: Math.sin(rad), fy: Math.cos(rad) });
    }

    /* 2) Урдах машиныг олж хурдаа тохируулна */
    for (let i = 0; i < n; i++) {
      const u = this.units[i], t = this.trucks[i];
      let r = cur(u);

      if (u.wait > 0) { u.wait -= dt; t.halted = true; continue; }

      let v = u.cur === 0 ? SPEED_LOADED : SPEED_EMPTY;

      let d = Infinity, blk = -1;
      for (let j = 0; j < all; j++) {
        if (j === i) continue;
        const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y;
        const fwd = dx * P[i].fx + dy * P[i].fy;          // урд талын зай
        if (fwd <= 0 || fwd > GAP_SLOW) continue;
        const off = Math.abs(-dx * P[i].fy + dy * P[i].fx);  // хажуугийн зөрүү
        if (off > LANE_W) continue;
        if (fwd < d) { d = fwd; blk = j; }
      }

      if (blk >= 0) {
        /* «Нэг эгнээ»-г маршрутаар биш ЧИГЛЭЛЭЭР тодорхойлно — бүх
           маршрут уурхайгаас гарах эхний хэсгийг хуваалцдаг. */
        const sameLane = P[blk].fx * P[i].fx + P[blk].fy * P[i].fy > 0.5;
        if (sameLane || !this.wins(i, blk)) {
          v *= d <= GAP_STOP ? 0 : (d - GAP_STOP) / (GAP_SLOW - GAP_STOP);
        }
      }

      /* Зэрэгцээ яваа машиныг урд талын конус хардаггүй тул хайрцгаар
         шалгана. Зогсоолын машин ч энд саад болно (`wins` дотор). */
      for (let j = 0; j < all && v > 0; j++) {
        if (j === i || this.wins(i, j)) continue;
        const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y;
        const al = Math.abs(dx * P[i].fx + dy * P[i].fy);
        const ac = Math.abs(-dx * P[i].fy + dy * P[i].fx);
        if (al < BOX_L && ac < BOX_W) { v *= BOX_SLOW; break; }
      }
      t.halted = v < 0.2;

      let ns = u.s + v * dt;

      /* Шилжлэг дээр зогсоно — яг тэр цэгт таслана */
      if (u.next >= 0 && ns >= r.stops[u.next]) {
        ns = r.stops[u.next];
        u.wait = STOP_SEC;
        u.next = u.next + 1 < r.stops.length ? u.next + 1 : -1;
      }

      /* Замын төгсгөлд НӨГӨӨ ЭГНЭЭ рүү шилжинэ.
         cur 0 -> 1 : хүлээн авагчид ирлээ, БУУЛГАНА (богино)
         cur 1 -> 0 : ил уурхайд ирлээ, АЧИГДАНА (урт) */
      if (ns >= r.len) {
        const loading = u.cur === 1;
        u.cur = u.cur === 0 ? 1 : 0;
        r = cur(u);
        u.wait = (loading ? LOAD_SEC : DUMP_SEC) * jitter(this.trucks[i].id);

        /* Шинэ эгнээний ЭХЛЭЛД. Урьд нь энд «дараалал» гэж хүлээж буй
           машины тоогоор s = q x 34 м байрлуулдаг байсан — тэр нь машиныг
           шинэ шугамын дунд руу 170 м хүртэл ГЭНЭТ ҮСРҮҮЛЖ байв. Хэмжихэд
           давхцлыг ч огт багасгаагүй (547 -> 547) тул хассан. Зай барих
           үүргийг хөөрөг барих дүрэм гүйцэтгэнэ. */
        ns = 0;
        u.next = nextStop(r, 0);
      }
      u.s = ns;
    }

    /* 3) Эцсийн байрлал — машин ҮРГЭЛЖ шугамынхаа ЯГ дээр */
    for (let i = 0; i < n; i++) {
      const u = this.units[i], t = this.trucks[i];
      const p = at(cur(u), u.s);
      t.lon = p.lon; t.lat = p.lat; t.z = 0;
      t.heading = p.heading;
      t.loaded = u.cur === 0;
    }
  }
}

/* ------------------------------------------------------------------------
   Хаягдлын урсгал: баяжуулах үйлдвэр -> хаягдлын далан
   ------------------------------------------------------------------------
   ГАЗАР ДООРХ ХООЛОЙ. `Bayjuulah_hayagdal_line` сервисийн жинхэнэ шугам
   (43 орой, 4.36 км, чиглэл нь үйлдвэрээс далан руу). Урьд нь үйлдвэр ба
   далангийн ТӨВ хоёрыг холбосон зохиомол Безье муруй байсан.

   Урсгалын нягт, хурдыг Excel-ийн «Агуулахад гаргасан хүдэр (хаягдал)» ба
   «Бохирдол, нийт» нийлбэрээр жолооднo (components/MineScene.tsx).
   ------------------------------------------------------------------------ */
export interface TailPt { lon: number; lat: number; z: number }

export async function loadTailLine(): Promise<TailPt[]> {
  const q = new URLSearchParams({
    where: "1=1", returnGeometry: "true", outSR: "4326", f: "json",
  });
  try {
    const d = await (await fetch(`${SVC.tailLine}/query?${q}`)).json();
    const path: number[][] = d?.features?.[0]?.geometry?.paths?.[0] ?? [];
    return path.map((p) => ({ lon: p[0], lat: p[1], z: 0 }));
  } catch {
    return [];
  }
}
