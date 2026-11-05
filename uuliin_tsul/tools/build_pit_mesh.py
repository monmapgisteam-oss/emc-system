# -*- coding: utf-8 -*-
"""
DWG-ийн ил уурхайн multipatch -> жинхэнэ 3D гадаргуу (glTF 2.0 / GLB)

Ажиллуулах (ArcGIS Pro-гийн python):
  "C:\\Program Files\\ArcGIS\\Pro\\bin\\Python\\envs\\arcgispro-py3\\python.exe" tools\\build_pit_mesh.py

Гаралт:
  public/data/pit_01.glb … pit_06.glb  — сар бүрийн питийн гадаргуу
  public/data/pit_mesh.json           — GLB бүрийн байрлуулах цэг (lon/lat/z)

Аргачлал:
  multipatch -> DEM (CELL м) -> зөвхөн утгатай нүднүүдээс гурвалжин тор
  -> локал ENU координат -> GLB.

  glTF-ийн тэнхлэг ArcGIS-д: x = зүүн тийш (east), y = дээш (up), z = урагш (south).
  Тиймээс   gx = X - X0,   gy = Z - Z0,   gz = -(Y - Y0).

Норматив вектор бичихгүй — рендерер өөрөө хавтгай сүүдэрлэлт хийнэ.
Питийн шатлал (хаялбар) хавтгай сүүдэрлэлтээр илүү тод харагдана.
"""
import arcpy, os, json, glob, shutil, struct, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pit_mask import pit_mask          # мэш ба хаялбар ХОЁУЛАА нэг маск ашиглана

SRC     = r"\\SARUUL\Share\EMC\dwg"
ROOT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "data")
SR_IN   = arcpy.SpatialReference(32648)   # WGS 84 / UTM zone 48N
SR_OUT  = arcpy.SpatialReference(4326)
CELL      = 5.0      # м — торны нягтрал (хаялбарын берм ялгарах хэмжээ)

arcpy.env.overwriteOutput = True
arcpy.CheckOutExtension("3D")
arcpy.CheckOutExtension("Spatial")

scratch = os.path.join(os.environ.get("TEMP", "."), "pitmesh")
if os.path.isdir(scratch):
    shutil.rmtree(scratch, ignore_errors=True)
os.makedirs(scratch)
gdb = os.path.join(scratch, "work.gdb")
arcpy.management.CreateFileGDB(scratch, "work.gdb")


def mp_to_raster(mp_fc, out_ras):
    for fn in (getattr(arcpy.conversion, "MultipatchToRaster", None),
               getattr(arcpy.ddd, "MultipatchToRaster", None)):
        if fn is not None:
            fn(mp_fc, out_ras, CELL)
            return
    raise RuntimeError("MultipatchToRaster хэрэгсэл олдсонгүй")


def write_glb(path, positions, indices):
    """Хамгийн энгийн glTF 2.0 binary — нэг mesh, нэг material."""
    pos = np.asarray(positions, dtype=np.float32)
    idx = np.asarray(indices, dtype=np.uint32)

    idx_bytes = idx.tobytes()
    pad1 = (-len(idx_bytes)) % 4
    pos_bytes = pos.tobytes()
    pad2 = (-len(pos_bytes)) % 4
    bin_blob = idx_bytes + b"\x00" * pad1 + pos_bytes + b"\x00" * pad2

    gltf = {
        "asset": {"version": "2.0", "generator": "EMC build_pit_mesh.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": 1},
            "indices": 0,
            "material": 0,
            "mode": 4
        }]}],
        "materials": [{
            "name": "pit",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.78, 0.62, 0.44, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.95
            },
            "doubleSided": True
        }],
        "buffers": [{"byteLength": len(bin_blob)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0,
             "byteLength": len(idx_bytes), "target": 34963},
            {"buffer": 0, "byteOffset": len(idx_bytes) + pad1,
             "byteLength": len(pos_bytes), "target": 34962}
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5125, "count": int(idx.size),
             "type": "SCALAR"},
            {"bufferView": 1, "componentType": 5126, "count": int(pos.shape[0]),
             "type": "VEC3",
             "min": [float(pos[:, 0].min()), float(pos[:, 1].min()), float(pos[:, 2].min())],
             "max": [float(pos[:, 0].max()), float(pos[:, 1].max()), float(pos[:, 2].max())]}
        ]
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_blob)
    with open(path, "wb") as f:
        f.write(b"glTF")
        f.write(struct.pack("<II", 2, total))
        f.write(struct.pack("<I", len(json_bytes)))
        f.write(b"JSON")
        f.write(json_bytes)
        f.write(struct.pack("<I", len(bin_blob)))
        f.write(b"BIN\x00")
        f.write(bin_blob)


def mesh_from_dem(ras_path, clip_to_pit=True):
    """DEM -> (positions, indices, origin) локал ENU координатаар."""
    r = arcpy.Raster(ras_path)
    cw, ch = r.meanCellWidth, r.meanCellHeight
    x_min, y_max = r.extent.XMin, r.extent.YMax
    nodata = r.noDataValue

    a = arcpy.RasterToNumPyArray(r, nodata_to_value=np.nan).astype(np.float64)
    if nodata is not None:
        a[a == nodata] = np.nan
    rows, cols = a.shape
    if clip_to_pit:
        m, _ = pit_mask(ras_path)
        if m is not None:
            a = np.where(m, a, np.nan)
    valid = ~np.isnan(a)
    if not valid.any():
        return None

    # эх цэг — утгатай мужийн төв, доод өндөр
    ri, ci = np.where(valid)
    x0 = x_min + (ci.min() + ci.max() + 1) / 2.0 * cw
    y0 = y_max - (ri.min() + ri.max() + 1) / 2.0 * ch
    z0 = float(np.nanmin(a))

    # оройн индексийн хүснэгт
    vidx = np.full((rows, cols), -1, dtype=np.int64)
    n_valid = int(valid.sum())
    vidx[valid] = np.arange(n_valid)

    jj, ii = np.meshgrid(np.arange(cols), np.arange(rows))
    px = (x_min + (jj[valid] + 0.5) * cw) - x0          # east
    py = a[valid] - z0                                   # up
    pz = -((y_max - (ii[valid] + 0.5) * ch) - y0)        # south
    positions = np.stack([px, py, pz], axis=1)

    # 2x2 нүд бүрээс 2 гурвалжин (дөрвүүлээ утгатай үед)
    ok = valid[:-1, :-1] & valid[:-1, 1:] & valid[1:, :-1] & valid[1:, 1:]
    v00 = vidx[:-1, :-1][ok]
    v01 = vidx[:-1, 1:][ok]
    v10 = vidx[1:, :-1][ok]
    v11 = vidx[1:, 1:][ok]
    # дээш харсан хэвийн вектор өгөх эрэмбэ
    tris = np.concatenate([
        np.stack([v00, v11, v10], axis=1),
        np.stack([v00, v01, v11], axis=1)
    ], axis=0)

    return positions, tris.reshape(-1), (x0, y0, z0)


entries = {}
for path in sorted(glob.glob(os.path.join(SRC, "CMK_2023*.DWG"))):
    month = int(os.path.basename(path)[8:10])
    print("--- сар %d : %s" % (month, os.path.basename(path)), flush=True)

    mp = os.path.join(gdb, "mp_%02d" % month)
    arcpy.management.CopyFeatures(os.path.join(path, "MultiPatch"), mp)
    arcpy.management.DefineProjection(mp, SR_IN)

    ras = os.path.join(scratch, "dem_%02d.tif" % month)
    mp_to_raster(mp, ras)

    built = mesh_from_dem(ras)
    if built is None:
        print("    утгатай нүд алга — алгасав", flush=True)
        continue
    positions, indices, (x0, y0, z0) = built

    name = "pit_%02d.glb" % month
    write_glb(os.path.join(OUT_DIR, name), positions, indices)

    pt = arcpy.PointGeometry(arcpy.Point(x0, y0), SR_IN).projectAs(SR_OUT).firstPoint
    entries[month] = {"url": "data/" + name,
                      "lon": round(pt.X, 8), "lat": round(pt.Y, 8),
                      "z": round(z0, 2)}

    kb = os.path.getsize(os.path.join(OUT_DIR, name)) / 1024.0
    print("    орой %d · гурвалжин %d · %.0f KB · эх цэг %.6f, %.6f, %.1f м"
          % (positions.shape[0], indices.size // 3, kb, pt.X, pt.Y, z0), flush=True)

with open(os.path.join(OUT_DIR, "pit_mesh.json"), "w", encoding="utf-8") as f:
    json.dump(entries, f, ensure_ascii=False, separators=(",", ":"))

print("бичив public/data/pit_mesh.json  (%d сар)" % len(entries))
print("ДУУСЛАА")
