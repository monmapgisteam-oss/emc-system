# -*- coding: utf-8 -*-
"""
Micromine-ийн блок загвар (Assign_BM_2023_MM_NN.DAT) -> вэбийн блокийн өгөгдөл

Ажиллуулах (numpy л хэрэгтэй, arcpy шаардлагагүй):
  python tools/build_block_mesh.py

Оролт:
  I:/EMC/Block/Assign_BM_2023_01_02.DAT … _05_06.DAT
  public/data/pit_mesh.json — питийн мэшийн эх цэг (блокийг ЯГ тэр цэгт байрлуулна)

Гаралт:
  public/data/blocks_02.bin … blocks_06.bin — блок бүрийн байрлал, хэмжээ,
      агуулга, нягт, геологийн код (доорх `write_bin`-ийг үз)
  public/data/blocks.json — сар бүрийн файл, тор, тонн, агуулга, ангилал

Мэшийг хөтөч дээр (lib/blockModel.ts) үүсгэнэ: зүсэлт хийх бүрт гадна
талуудыг ДАХИН тооцож, зүссэн нүүрийг блокийн өнгөөр бүтэн харуулна.
Хулганыг блок дээр аваачихад тухайн блокийн мэдээллийг мөн эндээс уншина.

Өгөгдлийн утга:
  Файл бүр нь MM ба NN сарын маркшейдерийн хэмжилтийн ХООРОНД олборлосон
  блокуудыг агуулна. Шалгахад MINED = "yes" блокуудын 98–100 % нь MM сарын
  гадаргуугаас доор, NN сарын гадаргуугаас дээр байрлаж байв. Иймээс тэдгээрийг
  «энэ хугацаанд авсан эзэлхүүн» болгон харуулна.
  MINED = "no" блокууд хоёр гадаргуугаас 20–50 м доор байдаг (олборлогдоогүй)
  тул оруулаагүй.

Координат:
  Блок загвар нь pivot (438500, 5423600)-ийг тойрон эргүүлсэн уурхайн локал
  торонд байна (Micromine rotation-z = -50). UTM 48N руу +50° эргүүлэхэд
  блокууд питийн гадаргуутай яг таарна (−50° үед огт давхцахгүй).
  Өндөр (RL) нь DWG-ийн гадаргуутай ижил өндрийн системд байна.
  Блокийг 5×5×3.75 м-ийн нүдээр илэрхийлнэ (20×20×15 м-ийн эх блок = 4×4×4 нүд).
"""
import glob, json, math, os, re
import numpy as np

SRC = r"I:/EMC/Block"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "data")

# Micromine-ийн эргүүлэлтийн тэнхлэг ба эргүүлэх өнцөг (локал -> UTM)
PIVOT = (438500.0, 5423600.0)
ROT_DEG = 50.0
# Нүдний хэмжээ ба торны эх (DAT-ийн metadata-аас)
CELL = (5.0, 5.0, 3.75)
ORIGIN = (438510.0, 5423610.0, -92.5)

# Cu агуулгын ангилал (CU_OK, %). Захын агуулга 0.25 % — түүнээс доош хаягдал.
# Өнгө нь уул уурхайн блок загварын түгээмэл «солонго» шатлал:
# хөх (хаягдал) -> ногоон -> шар -> улбар шар -> улаан (хамгийн баян).
CLASSES = [
    # (доод хязгаар, өнгө)
    (0.00, "#3b6fd4"),
    (0.25, "#2fb65a"),
    (0.35, "#f2d132"),
    (0.50, "#f28a1f"),
    (0.70, "#dc2f28"),
]

# Геологийн кодууд — блок бүрт индексээр хадгална (uint8)
DOMAINS = ["diss_cu", "stw_cu", "mixed_cu", "mixed_py", "py", "leach_cap"]
TYPES = ["fr", "tr", "ox"]
RCLASS = ["mea", "ind", "inf", "min_pot"]
PROJECTS = ["NW", "CEN"]


def read_dat(path):
    """Micromine extended DAT: 8 КБ XML толгой, дараа нь текстэн талбарын
    жагсаалт, дараа нь тогтмол урттай бинар мөрүүд (мөр бүр \\r\\n-ээр төгсөнө)."""
    b = open(path, "rb").read()
    j = 8192
    while b[j] == 0:
        j += 1
    head_end = b.index(b"VARIABLES\r\n", j) + len(b"VARIABLES\r\n")
    nvar = int(b[j:head_end].split()[0])
    fields, p = [], head_end
    for _ in range(nvar):
        e = b.index(b"\r\n", p)
        line = b[p:e].decode("latin-1")
        m = re.match(r"\s*([A-Z])\s*(\d+)\s+(\d+)", line[10:])
        fields.append((line[:10].strip(), m.group(1), int(m.group(2))))
        p = e + 2
    dt = []
    for name, t, w in fields:
        dt.append((name, {"R": "<f8", "F": "<f4", "C": "S%d" % w}[t]))
    dt.append(("_eol", "S2"))
    dt = np.dtype(dt)
    n = (len(b) - p) // dt.itemsize
    return np.frombuffer(b, dt, n, p)


def utm_forward(lon, lat, zone=48):
    """WGS84 -> UTM (Krüger-ийн цуваа, мм нарийвчлал)."""
    a, f = 6378137.0, 1 / 298.257223563
    n = f / (2 - f)
    A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64)
    al = [0, n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240]
    lam = math.radians(lon) - math.radians((zone - 1) * 6 - 180 + 3)
    phi = math.radians(lat)
    e = math.sqrt(f * (2 - f))
    t = math.sinh(math.atanh(math.sin(phi)) - e * math.atanh(e * math.sin(phi)))
    xi = math.atan2(t, math.cos(lam))
    eta = math.atanh(math.sin(lam) / math.sqrt(1 + t * t))
    E = eta + sum(al[k] * math.cos(2 * k * xi) * math.sinh(2 * k * eta) for k in (1, 2, 3))
    N = xi + sum(al[k] * math.sin(2 * k * xi) * math.cosh(2 * k * eta) for k in (1, 2, 3))
    return 500000 + 0.9996 * A * E, 0.9996 * A * N


def code(col, table):
    s = np.char.strip(col).astype(str)
    out = np.full(s.shape, 255, np.uint8)
    for k, v in enumerate(table):
        out[s == v] = k
    return out


def write_bin(path, cols):
    """Багана бүрийг дараалан бичнэ (struct-of-arrays). Хөтөч дээр шууд
    TypedArray болгон уншихын тулд 4 байтынхыг эхэнд, дараа нь 2, 1 байтынх.
      f32: cu, mo, bd · u16: i, j, k · u8: di, dj, dk, dom, typ, rc
    Дараа нь (блок дээр дарахад харуулах нэмэлт талбарууд):
      f32: cui, cuo, cuoi · u8: project
    u8-ын 6 багана нийт 24·n байт тул нэмэлт f32 4 байтаар зэрэгцсэн хэвээр."""
    with open(path, "wb") as f:
        for arr in cols:
            f.write(np.ascontiguousarray(arr).tobytes())


def main():
    pit = json.load(open(os.path.join(OUT_DIR, "pit_mesh.json"), encoding="utf-8"))
    cos_t, sin_t = math.cos(math.radians(ROT_DEG)), math.sin(math.radians(ROT_DEG))
    out = {
        "classes": [{"min": c[0], "color": c[1]} for c in CLASSES],
        "domains": DOMAINS, "types": TYPES, "rclass": RCLASS, "projects": PROJECTS,
        "cell": list(CELL),
        # Micromine-ийн локал тор: эх цэг, эргүүлэлтийн тэнхлэг ба өнцөг (локал -> UTM)
        "grid": {"origin": list(ORIGIN), "pivot": list(PIVOT), "rot": ROT_DEG},
        "months": {},
    }
    for path in sorted(glob.glob(os.path.join(SRC, "Assign_BM_2023_*_*.DAT"))):
        mm, nn = map(int, re.findall(r"_(\d\d)_(\d\d)\.DAT$", path, re.I)[0])
        rec = read_dat(path)
        rec = rec[np.char.strip(rec["MINED"]) == b"yes"]
        o = pit[str(nn)]
        X0, Y0 = utm_forward(o["lon"], o["lat"])

        sx, sy, sz = (rec[k].astype(float) for k in ("_EAST", "_NORTH", "_RL"))
        i0 = np.rint((rec["EAST"] - sx / 2 - ORIGIN[0]) / CELL[0]).astype(int)
        j0 = np.rint((rec["NORTH"] - sy / 2 - ORIGIN[1]) / CELL[1]).astype(int)
        k0 = np.rint((rec["RL"] - sz / 2 - ORIGIN[2]) / CELL[2]).astype(int)
        di, dj, dk = (np.rint(s / c).astype(int) for s, c in zip((sx, sy, sz), CELL))
        lo = np.array([i0.min(), j0.min(), k0.min()])
        dims = [int((i0 + di).max() - lo[0]), int((j0 + dj).max() - lo[1]), int((k0 + dk).max() - lo[2])]

        # Торны (lo) булангийн байрлал — эх цэгээс зүүн/хойд/дээш метрээр
        le, ln = ORIGIN[0] + lo[0] * CELL[0], ORIGIN[1] + lo[1] * CELL[1]
        dx, dy = le - PIVOT[0], ln - PIVOT[1]
        base = [PIVOT[0] + dx * cos_t - dy * sin_t - X0,
                PIVOT[1] + dx * sin_t + dy * cos_t - Y0,
                ORIGIN[2] + lo[2] * CELL[2] - o["z"]]

        name = "blocks_%02d.bin" % nn
        write_bin(os.path.join(OUT_DIR, name), [
            rec["CU_OK"].astype("<f4"), rec["MO_OK"].astype("<f4"), rec["BD"].astype("<f4"),
            (i0 - lo[0]).astype("<u2"), (j0 - lo[1]).astype("<u2"), (k0 - lo[2]).astype("<u2"),
            di.astype(np.uint8), dj.astype(np.uint8), dk.astype(np.uint8),
            code(rec["DOMAIN"], DOMAINS), code(rec["TYPE"], TYPES), code(rec["CLASS"], RCLASS),
            rec["CUI"].astype("<f4"), rec["CUO"].astype("<f4"), rec["CUOI"].astype("<f4"),
            code(rec["Project"], PROJECTS),
        ])

        vol = sx * sy * sz
        t = vol * rec["BD"]
        cu, mo = rec["CU_OK"], rec["MO_OK"]
        cls = np.clip(np.searchsorted([c[0] for c in CLASSES], cu, side="right") - 1, 0, len(CLASSES) - 1)
        out["months"][str(nn)] = {
            "url": "/data/" + name, "lon": o["lon"], "lat": o["lat"], "z": o["z"],
            "from": mm, "to": nn, "blocks": int(rec.size),
            # тор: хэмжээ (нүдээр), lo булангийн байрлал, тэнхлэгийн чиглэл
            "dims": dims, "base": [round(v, 3) for v in base],
            "axisI": [round(CELL[0] * cos_t, 6), round(CELL[0] * sin_t, 6)],
            "axisJ": [round(-CELL[1] * sin_t, 6), round(CELL[1] * cos_t, 6)],
            "rl0": ORIGIN[2] + float(lo[2]) * CELL[2],
            # торны (0,0,0) нүдний Micromine-ийн индекс — блокийн эх координатыг сэргээнэ
            "lo": [int(v) for v in lo],
            "assign": np.char.strip(rec["Assign2023"][0]).decode() if rec.size else None,
            "kt": round(float(t.sum()) / 1e3, 1), "km3": round(float(vol.sum()) / 1e3, 1),
            "cu": round(float((cu * t).sum() / t.sum()), 3),
            "mo": round(float((mo * t).sum() / t.sum()), 4),
            "share": [round(float(t[cls == k].sum() / t.sum()), 3) for k in range(len(CLASSES))],
        }
        kb = os.path.getsize(os.path.join(OUT_DIR, name)) / 1024
        print("%02d->%02d  блок %6d  тор %s  %.0f КБ  %.2f сая т  Cu %.3f %%"
              % (mm, nn, rec.size, dims, kb, t.sum() / 1e6, out["months"][str(nn)]["cu"]))
    with open(os.path.join(OUT_DIR, "blocks.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
