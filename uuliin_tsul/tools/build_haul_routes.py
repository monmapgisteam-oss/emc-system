# -*- coding: utf-8 -*-
"""
Тээврийн маршрутыг ЖИНХЭНЭ замын сүлжээгээр тооцно.

    python tools/build_haul_routes.py

Оролт
    Road_truck_SL/FeatureServer/0 — 32 шугам, 76 км, тээврийн замын тэнхлэг
    Owoolgo_medee/FeatureServer/4 — овоолгын 2D хүрээ
    Multipatch_EMC/FeatureServer/0 (type1 = 1) — баяжуулах үйлдвэр
    public/data/pit_mesh.json — ил уурхайн ачаалах цэг

Гаралт
    public/data/haul_routes.json

АРГА
  1. Шугам бүрийн оройг метр рүү (ойролцоо тэгш өнцөгт) хөрвүүлж, 1 м-ээс
     ойр давхардсаныг нь хаяна.
  2. Зангилаа нэгтгэх: ЗӨВХӨН шугамын ҮЗҮҮРийг өөр шугамын хамгийн ойрын
     оройтой холбоно (үзүүр-үзүүр ба үзүүр-дундах T-уулзвар хоёулаа).
     Дотоод оройг ХЭЗЭЭ Ч хөдөлгөхгүй.

     ЯАГААД: Road_truck_SL нь замыг ХОЁР ЗЭРЭГЦЭЭ шугамаар (баруун/зүүн
     эгнээ) дүрсэлдэг ба тэдгээрийн хоорондын зай дунджаар ердөө 10.9 м
     (10 %-иль нь 5.4 м). Урьд нь бүх оройг 20 м-ийн хүлцлээр нэгтгэдэг
     байсан тул хоёр эгнээ НИЙЛЖ, 6 171 орой 2 612 зангилаа болж, маршрут
     нь хоёр эгнээний ХОЛИМОГ шугам болж машин эгнээ хооронд явж байв.
     Одоо 6 121 зангилаа үлдэж, эгнээний геометр бүрэн хадгалагдана.
  3. Ачаалах цэг ба хүлээн авагч бүрийг сүлжээний ХАМГИЙН ОЙРЫН зангилаанд
     наана. Хүлээн авагчийн хувьд түүний полигоны БҮХ оройг харьцуулна —
     төвөөр нь тооцвол том овоолгын хувьд хэдэн зуун метр алдаа гарна.
  4. Ачаалах цэгээс хүлээн авагч бүр рүү Dijkstra-аар хамгийн богино зам.
  5. БУЦАХ зам ТУСДАА. Тээврийн зам ихэвчлэн ХОЁР зэрэгцээ шугамаар
     (баруун/зүүн эгнээ) дижитайзчигдсан байдаг. Нэг л зам тооцвол хоёр
     чиглэл нэг шугам дээр давхцаж, эсвэл зохиомол хажуугийн шилжилтээр
     эгнээ хооронд буюу замын гадуур гарна. Тиймээс явах замын ирмэгүүдийг
     PENALTY дахин үнэтэй болгоод Dijkstra-г ДАХИН ажиллуулна: зэрэгцээ
     шугам байвал буцах зам түүгээр явна, байхгүй бол ижил замаар буцна.

ХЯЗГААР
  Хэрэв зам тухайн овоолгод хүрэхгүй бол сүүлчийн зангилаанаас полигон
  хүртэл ШУЛУУН холбоос нэмнэ. Уг холбоосын уртыг `stub` талбарт бичиж,
  гаралтын лог дээр анхааруулна — зохиосон зам болохыг нь мэдэж байх ёстой.
"""
import json, math, os, heapq, collections, urllib.request, urllib.parse

AGOL = "https://services7.arcgis.com/iErGCwr6emXIFjPR/arcgis/rest/services"
ROADS = f"{AGOL}/Road_truck_SL/FeatureServer/0"
PILE2D = f"{AGOL}/Owoolgo_medee/FeatureServer/4"
BLDFS = f"{AGOL}/Multipatch_EMC/FeatureServer/0"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data", "haul_routes.json")
PIT = os.path.join(ROOT, "public", "data", "pit_mesh.json")

SNAP = 50.0          # шугамын ҮЗҮҮРийг холбох хүлцэл, м
                     # (25 м -> 92 % холбогдоно, 50 м -> 100 %)
PENALTY = 6.0        # буцах замыг зэрэгцээ шугам руу түлхэх коэффициент
                     # 6  -> хоёр чиглэлт 31 %, хамгийн урт буцах зам 13.1 км
                     # 15 -> 22 % боловч буцах зам 25.2 км болж бодит бус
PARK_OFF = 9.0       # м — зогссон машиныг шугамаас хажуу тийш татах
MIN_CLEAR = 70.0     # м — зогсоолын машин МАРШРУТААС хол байх доод хязгаар
PARK_SEP = 60.0      # м — зогсоолын машинууд ХООРОНДОО хол байх доод хязгаар
TWIN = 28.0          # м — зэрэгцээ эгнээний хосыг хайх радиус

# ЗОГСОХ машинууд — хөдөлгөөнгүй, `InLine_FID`-ээр сонгоно.
# ЗӨВХӨН 9, 10, 11. Санал болгосон 12, 15, 16 ба үйлдвэрийн 4, 6, 7 нь
# МАРШРУТ ӨӨРӨӨ болох нь хэмжилтээр гарсан — тэдгээрийн цэгүүд явж буй
# машины замаас медиан 0 м зайд байна, тэнд зогсоовол заавал хөдөлгөөний
# эгнээнд орно. Харин 9 -> 259 м, 10 -> 268 м, 11 -> 116 м зайтай.
PARK_ALONG = [9, 10, 11]
PARK_ALONG_N = 4
LAT0 = 49.02
SX = 111320.0 * math.cos(math.radians(LAT0))
SY = 110540.0

# Excel-ийн багана -> хүлээн авагч. lib/flow.ts дахь DEST_DEF-тэй тохирно.
DESTS = [
    ("BU",     "Баяжуулах үйлдвэр",  None),
    ("OV12",   "Овоолго 12",         ["Овоолго 12"]),
    ("OV14",   "Овоолго 14",         ["Овоолго 14"]),
    ("OV8A",   "Овоолго 8а",         ["Овоолго 8а"]),
    ("OV9A",   "Овоолго 9а · 8 · 9", ["Овоолго 9а", "Овоолго 8", "Овоолго 9"]),
    ("OV9B",   "Овоолго 9б",         ["Овоолго 9б"]),
    ("HOOSON", "Овоолго №1, 4, 11",  ["Овоолго 1", "Овоолго 4", "Овоолго 11"]),
]


def get(url, params):
    q = urllib.parse.urlencode(params)
    with urllib.request.urlopen(f"{url}/query?{q}", timeout=90) as r:
        return json.load(r)


def xy(lon, lat):
    return (lon * SX, lat * SY)


def lonlat(p):
    return (round(p[0] / SX, 7), round(p[1] / SY, 7))


def d2(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


class UF:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.p[b] = a


def build_graph():
    d = get(ROADS, {"where": "1=1", "returnGeometry": "true", "outSR": "4326",
                    "f": "json", "resultRecordCount": 5000})
    chains = []
    for f in d["features"]:
        for path in f["geometry"]["paths"]:
            ch = []
            for lon, lat in ((p[0], p[1]) for p in path):
                q = xy(lon, lat)
                if not ch or d2(ch[-1], q) > 1.0:
                    ch.append(q)
            if len(ch) > 1:
                chains.append(ch)

    pts, owner, is_end = [], [], []
    for ci, ch in enumerate(chains):
        for k, q in enumerate(ch):
            pts.append(q)
            owner.append(ci)
            is_end.append(k == 0 or k == len(ch) - 1)

    uf = UF(len(pts))
    grid = collections.defaultdict(list)
    for i, q in enumerate(pts):
        grid[(int(q[0] // SNAP), int(q[1] // SNAP))].append(i)
    t2 = SNAP * SNAP
    for i, q in enumerate(pts):
        if not is_end[i]:
            continue                      # дотоод орой хэзээ ч хөдлөхгүй
        gx, gy = int(q[0] // SNAP), int(q[1] // SNAP)
        best, bd = -1, t2
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((gx + dx, gy + dy), ()):
                    if owner[j] == owner[i]:
                        continue          # зөвхөн ӨӨР шугам руу
                    e = d2(q, pts[j])
                    if e <= bd:
                        bd, best = e, j
        if best >= 0:
            uf.union(best, i)             # үзүүр нөгөө оройн БАЙРЛАЛД очно

    # Бүлгийн координат: дотоод орой байвал ТҮҮГЭЭР (дижитайзчигдсан
    # байрлалаа хадгална), эс бөгөөс эхний үзүүрээр.
    node, coords = {}, []
    for i in range(len(pts)):
        r = uf.find(i)
        if r not in node:
            node[r] = len(coords)
            coords.append(pts[i])
        elif not is_end[i]:
            coords[node[r]] = pts[i]
    nid = [node[uf.find(i)] for i in range(len(pts))]

    # Ирмэг: (хөрш, урт, ШУГАМЫН дугаар, ЧИГЛЭЛ +1/-1)
    adj = collections.defaultdict(list)
    k = 0
    for ci, ch in enumerate(chains):
        for a in range(len(ch) - 1):
            u, v = nid[k + a], nid[k + a + 1]
            if u != v:
                w = math.sqrt(d2(coords[u], coords[v]))
                adj[u].append((v, w, ci, 1))
                adj[v].append((u, w, ci, -1))
        k += len(ch)
    return coords, adj


def nearest(coords, targets):
    """targets доторх аль нэг цэгт хамгийн ойр байх зангилаа -> (idx, зай)"""
    best, bd = -1, float("inf")
    for i, c in enumerate(coords):
        for t in targets:
            e = d2(c, t)
            if e < bd:
                bd, best = e, i
    return best, math.sqrt(bd)


def access_node(coords, targets, reach=300.0):
    """
    Хүлээн авагчид ХҮРЭХ зангилаа.

    Зүгээр «полигоны аль нэг оройд хамгийн ойр» гэвэл хөрш овоолгууд нэг
    зангилаа сонгодог: «Овоолго 9» зүүн тийш 104.1358 хүртэл сунадаг тул
    «Овоолго 12»-той нийлж, дэлгэц дээр хоёр яг ижил маршрут гардаг байв.
    Тиймээс эхлээд полигоноос `reach` метрийн дотор байгаа зангилаануудыг
    нэр дэвшүүлж, дотроос нь ТӨВД хамгийн ойрыг сонгоно — зам овоолгын
    захын үзүүр рүү биш, биен рүү нь чиглэнэ.
    """
    cx = sum(t[0] for t in targets) / len(targets)
    cy = sum(t[1] for t in targets) / len(targets)
    r2 = reach * reach
    cand = []
    for i, c in enumerate(coords):
        dv = min(d2(c, t) for t in targets)
        if dv <= r2:
            # оноо = полигон хүртэлх зай + 0.4 × төв хүртэлх зай.
            # Цэвэр төвөөр сонговол зам овоолгын биен рүү чиглэх ч зайлшгүй
            # 150–250 м-ийн зохиомол холбоос үлддэг; цэвэр ойрхноор сонговол
            # хөрш овоолгууд нийлдэг. Хоёрын дундаж нь хоёуланг шийднэ.
            cand.append((math.sqrt(dv) + 0.4 * math.sqrt(d2(c, (cx, cy))),
                         i, math.sqrt(dv)))
    if not cand:
        return nearest(coords, targets)
    cand.sort()
    return cand[0][1], cand[0][2]


def dijkstra(adj, src, n, pen=None):
    """pen : {(u,v) -> коэффициент} — буцах замыг зэрэгцээ шугам руу түлхэхэд"""
    dist = [float("inf")] * n
    prev = [-1] * n
    dist[src] = 0.0
    pq = [(0.0, src)]
    while pq:
        dv, u = heapq.heappop(pq)
        if dv > dist[u]:
            continue
        for v, w, ci, sg in adj[u]:
            c = w
            if pen is not None:
                c *= pen.get((min(u, v), max(u, v)), 1.0)
            nd = dv + c
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    return dist, prev


def walk(prev, src, dst):
    """src -> dst замын зангилаанууд"""
    path, u = [], dst
    while u != -1:
        path.append(u)
        u = prev[u]
    path.reverse()
    return path if path and path[0] == src else []





def _lines(fids):
    """InLine_FID-ээр шугамуудыг татаж метр рүү хөрвүүлнэ -> [(урт, цэгүүд)]"""
    where = " OR ".join(f"InLine_FID = {i}" for i in fids)
    d = get(ROADS, {"where": where, "returnGeometry": "true", "outSR": "4326",
                    "f": "json", "resultRecordCount": 200})
    out = []
    for f in d.get("features", []):
        for path in f["geometry"]["paths"]:
            pts = [xy(p[0], p[1]) for p in path]
            ln = sum(math.sqrt(d2(pts[i], pts[i + 1])) for i in range(len(pts) - 1))
            if ln > 1:
                out.append((ln, pts))
    return out


def _at(pts, t, jitter=0.0):
    """Шугамын дагуух t метрт байрлах цэг ба азимут.
       jitter (-1..1) нь хажуугийн шилжилтийг санамсаргүй болгоно."""
    acc = 0.0
    for i in range(len(pts) - 1):
        seg = math.sqrt(d2(pts[i], pts[i + 1]))
        if acc + seg >= t or i == len(pts) - 2:
            f = (t - acc) / max(1e-6, seg)
            x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f
            y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f
            hd = math.degrees(math.atan2(pts[i + 1][0] - pts[i][0],
                                         pts[i + 1][1] - pts[i][1])) % 360
            # Замын хөдөлгөөнд саад болохгүйн тулд шугамаас баруун тийш татна
            rad = math.radians(hd)
            off = PARK_OFF * (1.0 + 0.55 * jitter)
            x += off * math.cos(rad)
            y += -off * math.sin(rad)
            lon, lat = lonlat((x, y))
            return [lon, lat, round(hd, 1)]
        acc += seg
    return None


def parked_trucks(routes):
    """
    Хөдөлгөөнгүй машинуудын байрлал -> [[lon, lat, азимут], ...]

    ЗААВАЛ маршрутаас ХОЛ байрлана. Урьд нь зогсоолын шугамууд (9…16)
    маршруттай давхцах газарт зогссон машин яг хөдөлгөөний эгнээн дээр
    гарч, явж яваа машин түүн рүү мөргөж байв. Одоо нэр дэвшсэн байрлал
    бүрийг БҮХ маршрутаас (явах ба буцах) хэмжиж, MIN_CLEAR метрээс ойр
    бол хаяна.
    """
    # бүх маршрутын цэгүүдийг метрээр — торонд хийж хурдасгана
    grid = collections.defaultdict(list)
    CELL = MIN_CLEAR
    for v in routes.values():
        for key in ("pts", "back"):
            for lo, la in v[key]:
                q = xy(lo, la)
                grid[(int(q[0] // CELL), int(q[1] // CELL))].append(q)

    def clear(q):
        gx, gy = int(q[0] // CELL), int(q[1] // CELL)
        r2 = MIN_CLEAR * MIN_CLEAR
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for u in grid.get((gx + dx, gy + dy), ()):
                    if d2(q, u) < r2:
                        return False
        return True

    out = []

    # --- ил уурхайн ажлын талбай: шугамын дагуу САНАМСАРГҮЙ байрлалд.
    # Тэгш зайтай тараавал эгнүүлж тавьсан мэт хиймэл харагддаг байв.
    # Санамсаргүй боловч ТОГТМОЛ: LCG-ийн үр тогтсон тул ажиллуулах бүрт
    # ижил гарна.
    seed = 20260829
    def rnd():
        nonlocal seed
        seed = (seed * 1103515245 + 12345) % (1 << 31)
        return seed / (1 << 31)

    ls = _lines(PARK_ALONG)
    total = sum(l for l, _ in ls) or 1
    taken = []                               # БҮХ зогсоолын машины байрлал, м
    for ln, pts in ls:
        n = max(1, round(PARK_ALONG_N * ln / total))
        placed = 0
        for _try in range(600):
            if placed >= n:
                break
            t = (0.06 + rnd() * 0.88) * ln
            q = _at(pts, t, jitter=rnd() * 2 - 1)
            if not q:
                continue
            w = xy(q[0], q[1])
            if not clear(w):
                continue                     # маршрутад хэт ойр
            # Зайг шугамын дагуух параметрээр биш, БОДИТ зайгаар шалгана:
            # 9, 10, 11 шугамууд хоорондоо ойрхон өнгөрдөг тул өөр шугамын
            # машинууд давхцаж байв.
            if any(d2(w, u) < PARK_SEP * PARK_SEP for u in taken):
                continue
            taken.append(w)
            out.append(q)
            placed += 1
    print(f"зогсох машин: {len(out)} ш · шугам {PARK_ALONG} · "
          f"маршрутаас дор хаяж {MIN_CLEAR:.0f} м зайд")
    return out


def dest_points(piles):
    """Хүлээн авагчийн полигоны бүх орой (метрээр)."""
    if piles is None:
        where = "type1 = 1"
        url = BLDFS
    else:
        where = " OR ".join(f"dugaar = '{p}'" for p in piles)
        url = PILE2D
    d = get(url, {"where": where, "returnGeometry": "true", "outSR": "4326",
                  "f": "json", "geometryPrecision": 6, "resultRecordCount": 5000})
    out = []
    for f in d.get("features", []):
        g = f.get("geometry") or {}
        for ring in g.get("rings", []) or g.get("paths", []):
            out.extend(xy(p[0], p[1]) for p in ring)
        if "x" in g:
            out.append(xy(g["x"], g["y"]))
    return out


def main():
    coords, adj = build_graph()
    n = len(coords)
    print(f"сүлжээ: {n} зангилаа, {sum(len(v) for v in adj.values()) // 2} ирмэг "
          f"(үзүүрийн хүлцэл {SNAP:.0f} м)")

    pit = json.load(open(PIT, encoding="utf-8"))["1"]
    src, src_d = nearest(coords, [xy(pit["lon"], pit["lat"])])
    print(f"ачаалах цэг -> сүлжээ: {src_d:.0f} м")

    # Хүлээн авагч бүрийн холбох зангилаа
    tg = []
    for code, name, piles in DESTS:
        pts_t = dest_points(piles)
        if not pts_t:
            print(f"  {code:<7} ГЕОМЕТР ОЛДСОНГҮЙ")
            continue
        dn, stub = access_node(coords, pts_t)
        tg.append((code, name, pts_t, dn, stub))

    # ------------------------------------------------------------------
    # ШУГАМ БҮРТ НЭГ ЧИГЛЭЛ.
    # Урьд нь чиглэл тус бүрийн зам бие даан тооцогдож байсан тул БҮ-ийн
    # явах зам, Овоолго 12-ийн буцах зам гэх мэт хоёр өөр маршрут нэг
    # шугамыг ЭСРЭГ чиглэлд ашиглаж, машинууд нүүр нүүрээсээ явж байв.
    # Одоо маршрутуудыг ДАРААЛЛАН тооцоод, ашигласан шугам бүрт чиглэл
    # оноож байна; дараагийн маршрут тэр чиглэлийн эсрэг явбал ONEWAY
    # дахин үнэтэй болно.
    # ------------------------------------------------------------------
    out = {}
    par = 0

    # ------------------------------------------------------------------
    # ХОЁР ЭГНЭЭ. Явах зам — хамгийн богино; буцах зам — явах замын
    # ирмэгүүдийг PENALTY дахин үнэтэй болгож дахин хайснаар зэрэгцээ
    # шугам руу шилжинэ (48–100 % тусдаа).
    #
    # ШУГАМ БҮРТ ГЛОБАЛ НЭГ ЧИГЛЭЛ оноох арга ТУРШИГДАЖ, ХЭРЭГСЭГДСЭНГҮЙ:
    # энэ сүлжээнд овоолго руу орох салаа шугамууд ганц, тэдгээрийг
    # зайлшгүй хоёр чиглэлд явна. Хатуу дүрэм тавихад буцах зам 27–42 км
    # болж (жинхэнэ нь 5–13 км), сөрөг чиглэлийн зөрчил ч 500 -> 1 122
    # болж НЭМЭГДЭЖ байв. Оронд нь үлдсэн ховор тохиолдлыг симуляц дээр
    # шийднэ: сөргөө таарвал давуу эрхгүй нь хажуу тийш татаж зогсоод,
    # нөгөө нь өнгөрнө (lib/flow.ts, PULL_OVER).
    # ------------------------------------------------------------------
    dist, prev = dijkstra(adj, src, n)

    # 1-Р ҮЕ: бүх явах зам. Ачаалалтай урсгал бүхэлдээ нэг чиглэлтэй тул
    # тэдгээрийн ашигласан ирмэгийг НЭГТГЭЖ, буцах зам БҮГДЭЭС нь зайлсхийнэ.
    # Зөвхөн тухайн чиглэлийн явах замаас зайлсхийвэл өөр овоолгын явах
    # эгнээ рүү ороод сөргөө таардаг байв.
    fwd = {}
    all_fwd = set()
    for code, name, pts_t, dn, stub in tg:
        pth = walk(prev, src, dn)
        if pth:
            fwd[code] = pth
            all_fwd |= {(min(a, b), max(a, b)) for a, b in zip(pth, pth[1:])}

    for code, name, pts_t, dn, stub in tg:
        path = fwd.get(code)
        if not path:
            print(f"  {code:<7} ЗАМ ОЛДСОНГҮЙ")
            continue

        used = {(min(a, b), max(a, b)) for a, b in zip(path, path[1:])}
        _, bprev = dijkstra(adj, dn, n, {k: PENALTY for k in all_fwd})
        bpath = walk(bprev, dn, src) or list(reversed(path))

        shared = len({(min(a, b), max(a, b)) for a, b in zip(bpath, bpath[1:])} & used)
        sep = 1 - shared / max(1, len(used))
        if sep > 0.15:
            par += 1

        pts = [lonlat(coords[i]) for i in path]
        bpts = [lonlat(coords[i]) for i in bpath]
        if stub > 25:
            near = min(pts_t, key=lambda t: d2(coords[dn], t))
            pts.append(list(lonlat(near)))
            bpts.insert(0, list(lonlat(near)))

        # ---- БАРУУН ГАР ТАЛЫН хөдөлгөөн.
        # Dijkstra аль эгнээг «явах» болгохыг геометрээс шалтгаалан
        # дурын байдлаар сонгодог. Тэгш хэмтэй хэмжилтээр (хоёр замын
        # дагуу 1 043 дээж) сөрөг эгнээ явах чиглэлийн БАРУУН талд 74 %
        # гарч, зүүн гар талын хөдөлгөөн болж байв. Хоёр эгнээг сольж,
        # аялалын утгыг нь хадгална — соливол сөрөг эгнээ ЗҮҮНД 74 %:
        #   шинэ явах  (пит -> хүлээн авагч) = хуучин БУЦАХ замын урвуу
        #   шинэ буцах (хүлээн авагч -> пит) = хуучин ЯВАХ замын урвуу
        #
        # ЖИЧ: үүний улмаас ачаалалтай машин арай урт эгнээгээр явна
        # (БҮ: 10.2 -> 13.0 км). Богино эгнээ нь конвенцийн хувьд буруу
        # талд байгаагийн үр дагавар. Шугам бүрт геометрээр нь нэг талын
        # чиглэл оноох аргыг туршиж үзсэн боловч 29/32 шугам нэг талт
        # болж, зам 26 км хүртэл сунаад, БҮ болон Овоолго 8а-д явах,
        # буцах зам ИЖИЛ болж (0 % тусдаа) хаягдсан.
        path, bpath = list(reversed(bpath)), list(reversed(path))
        pts, bpts = list(reversed(bpts)), list(reversed(pts))

        length = sum(math.sqrt(d2(coords[a], coords[b])) for a, b in zip(path, path[1:]))
        blen = sum(math.sqrt(d2(coords[a], coords[b])) for a, b in zip(bpath, bpath[1:]))
        out[code] = {"name": name, "pts": pts, "back": bpts,
                     "len": round(length), "stub": round(stub)}
        flag = "  ← ЗОХИОМОЛ ХОЛБООС" if stub > 300 else ""
        print(f"  {code:<7} явах {length/1000:5.2f} км · буцах {blen/1000:5.2f} км · "
              f"буулт {stub:5.0f} м · тусдаа {sep*100:3.0f} %{flag}")

    # ------- шалгалт: нэг шугамыг эсрэг чиглэлд ашигласан эсэх
    seen = {}
    clash = 0
    for code, v in out.items():
        for key in ("pts", "back"):
            pl = v[key]
            for a, b in zip(pl, pl[1:]):
                ka, kb = tuple(a), tuple(b)
                e = (min(ka, kb), max(ka, kb))
                d = 1 if ka < kb else -1
                if e in seen and seen[e] != d:
                    clash += 1
                seen[e] = d
    park = parked_trucks(out)
    print("")
    print(f"зэрэгцээ эгнээгээр буцах: {par}/{len(out)} чиглэл")
    print(f"нэг шугам дээрх СӨРӨГ чиглэл: {clash} ирмэг")
    out["_parked"] = park

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print("")
    print(f"{OUT}  ({os.path.getsize(OUT)/1024:.0f} КБ)")


if __name__ == "__main__":
    main()
