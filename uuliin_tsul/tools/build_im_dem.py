# -*- coding: utf-8 -*-
"""
Бодит мэшийн (IntegratedMesh) газрын өндрийн тор -> public/data/im_dem.{json,bin}

Ажиллуулах (numpy, scipy хэрэгтэй):
  python tools/build_im_dem.py

Машин, экскаватор бодит мэш дээр явна. ArcGIS-ийн `relative-to-scene` нь
мэшийн тухайн үед ачаалагдсан LOD-оос өндрийг авдаг тул:
  * zoom хийхэд LOD солигдох бүрт машины өндөр үсэрнэ;
  * мэшинд буусан жинхэнэ техник, гэрэлтүүлгийн шон, өрмийн машины дээр
    гарч агаарт хөвнө.
Иймд мэшийн нэг LOD-ыг (LEVEL) татаж CELL алхамтай торонд буулгаад,
OPEN_CELLS цонхтой саарал «opening»-оор (min -> max) өндөрлөг жижиг
биетүүдийг арилгана. Шатлал, налуу (монотон гадаргуу) өөрчлөгдөхгүй.

Гаралт (EPSG:3857, мэшийн өөрийн координат):
  im_dem.json — x0, y0 (0,0 нүдний төв), cell, w, h, z0, scale
  im_dem.bin  — Int16 LE, мөр бүр урагшаас хойш: z = z0 + v * scale
                (-32768 = мэш байхгүй)
"""
import gzip, json, os, struct, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
OUT = os.path.join(ROOT, "public", "data")
LAYER = "https://arcgis.ubhub.mn/arcgis/rest/services/Hosted/emc_openpit_2/SceneServer/layers/0"
LEVEL = 10          # ≈5 м-ийн гурвалжин (12 нь 0.6 м, 1.7 ГБ)
CELL = 4.0          # EPSG:3857 м (энэ өргөрөгт ≈2.6 м газар)
OPEN_CELLS = 7      # ≈18 м газар — машин, өрмийн машин, шонг арилгана
SCALE = 0.1
NODATA = -32768


def get(url):
    b = urllib.request.urlopen(url, timeout=120).read()
    return gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b


def node_pages():
    nodes, p = [], 0
    while True:
        page = json.loads(get(f"{LAYER}/nodepages/{p}?f=json"))["nodes"]
        nodes += page
        if len(page) < 64:
            return nodes
        p += 1


def depth_of(nodes):
    by = {n["index"]: n for n in nodes}
    d = {}
    def f(n):
        i = n["index"]
        if i not in d:
            p = n.get("parentIndex", -1)
            d[i] = 0 if p < 0 or p not in by else f(by[p]) + 1
        return d[i]
    for n in nodes:
        f(n)
    return d


def triangles(node):
    """Зангилааны гурвалжнууд (N, 3, 3) — CRS-ийн абсолют координатаар"""
    g = node["mesh"]["geometry"]
    vc = g["vertexCount"]
    b = get(f"{LAYER}/nodes/{g['resource']}/geometries/0")
    assert struct.unpack_from("<I", b, 0)[0] == vc
    pos = np.frombuffer(b, "<f4", vc * 3, 8).reshape(-1, 3).astype(np.float64)
    pos += np.asarray(node["obb"]["center"])
    return pos[: vc - vc % 3].reshape(-1, 3, 3)


def rasterize(tri, z, x0, y0):
    """Нүдний төв бүрт хамгийн өндөр гурвалжны өндрийг бичнэ (дээд гадаргуу)"""
    h, w = z.shape
    u = (tri[:, :, 0] - x0) / CELL
    v = (tri[:, :, 1] - y0) / CELL
    ua, ub, uc = u.T; va, vb, vc = v.T
    den = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc)
    ok = np.abs(den) > 1e-9
    i0 = np.ceil(u.min(1)).astype(int); j0 = np.ceil(v.min(1)).astype(int)
    span = max(int(np.ceil(u.max(1) - u.min(1)).max()), int(np.ceil(v.max(1) - v.min(1)).max())) + 1
    for di in range(span):
        for dj in range(span):
            i, j = i0 + di, j0 + dj
            l1 = ((vb - vc) * (i - uc) + (uc - ub) * (j - vc)) / np.where(ok, den, 1)
            l2 = ((vc - va) * (i - uc) + (ua - uc) * (j - vc)) / np.where(ok, den, 1)
            l3 = 1 - l1 - l2
            m = ok & (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6) & (i >= 0) & (j >= 0) & (i < w) & (j < h)
            if not m.any():
                continue
            zz = l1[m] * tri[m, 0, 2] + l2[m] * tri[m, 1, 2] + l3[m] * tri[m, 2, 2]
            np.maximum.at(z, (j[m], i[m]), zz)


def main():
    meta = json.loads(get(f"{LAYER}?f=json"))
    ext = meta["fullExtent"]
    nodes = node_pages()
    depth = depth_of(nodes)
    sel = [n for n in nodes if depth[n["index"]] == LEVEL and n.get("mesh")]
    print("LOD %d: %d зангилаа" % (LEVEL, len(sel)))

    x0 = np.floor(ext["xmin"] / CELL) * CELL
    y0 = np.floor(ext["ymin"] / CELL) * CELL
    w = int(np.ceil((ext["xmax"] - x0) / CELL)) + 1
    h = int(np.ceil((ext["ymax"] - y0) / CELL)) + 1
    z = np.full((h, w), -np.inf)

    with ThreadPoolExecutor(8) as ex:
        for k, tri in enumerate(ex.map(triangles, sel)):
            rasterize(tri, z, x0, y0)
            if k % 50 == 0:
                print("  %d/%d" % (k, len(sel)))

    has = np.isfinite(z)
    print("тор %dx%d, утгатай %.1f%%" % (w, h, 100 * has.mean()))
    # Жижиг нүхийг хамгийн ойр утгаар нөхнө (мэшийн гадна талыг биш)
    near = ndimage.distance_transform_edt(~has, return_distances=False, return_indices=True)
    filled = z[tuple(near)]
    hole = ~has & ndimage.binary_closing(has, iterations=2)
    z = np.where(hole, filled, z)
    has |= hole

    # Opening: жижиг өндөрлөг биетүүдийг арилгана; мэшгүй хэсгийг ойрын утгаар
    # түр дүүргэж ирмэг дээр ороосон утга орохоос сэргийлнэ
    work = np.where(has, z, filled)
    ground = ndimage.grey_opening(work, size=(OPEN_CELLS, OPEN_CELLS))
    d = (work - ground)[has]
    print("opening: дундаж %.2f м, 99%% %.2f м, хамгийн их %.1f м" % (d.mean(), np.percentile(d, 99), d.max()))

    z0 = float(np.floor(ground[has].min()))
    q = np.round((ground - z0) / SCALE)
    assert q[has].max() < 32767
    out = np.where(has, q, NODATA).astype("<i2")
    out.tofile(os.path.join(OUT, "im_dem.bin"))
    info = {"x0": x0, "y0": y0, "cell": CELL, "w": w, "h": h, "z0": z0, "scale": SCALE,
            "wkid": 3857, "level": LEVEL, "open": OPEN_CELLS}
    with open(os.path.join(OUT, "im_dem.json"), "w", encoding="utf-8") as f:
        json.dump(info, f)
    print("im_dem.bin %.2f МБ" % (out.nbytes / 1e6), info)


if __name__ == "__main__":
    main()
