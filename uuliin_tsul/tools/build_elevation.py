# -*- coding: utf-8 -*-
"""
DWG-ийн multipatch -> уурхайн өндрийн сүлжээ (public/data/dem.bin + dem.json)

Ажиллуулах (ArcGIS Pro-гийн python):
  "C:\\Program Files\\ArcGIS\\Pro\\bin\\Python\\envs\\arcgispro-py3\\python.exe" tools/build_elevation.py

ЯАГААД ХЭРЭГТЭЙ ВЭ
  Esri-гийн үнэгүй дэлхийн DEM уурхайн орчинд ямар ч нарийвчлалгүй —
  4 өөр цэгээс асуухад бүгд яг 1 299.46 м буцаана. Бодит өндөр 1167–1523 м.
  Үүнээс болж:
    · гүний хаялбар (1175–1280 м) хавтангийн ДООР үлдэж нуугддаг
    · замын Z (1310–1453 м) хавтангийн ДЭЭР тул машин агаарт хөвдөг
    · питийн мэш хавтанг нэвт цоолдог

  Энэ скрипт нь DWG-ийн хэмжилтийн гадаргууг WGS84 сүлжээ болгож экспортлоно.
  Апп талд `PitElevationLayer` (BaseElevationLayer) үүнийг уншиж уурхайн
  хүрээнд өөрийн өндрийг, гадна нь Esri-гийнхийг өгнө.

ГАРАЛТ
  dem.bin   Float32 little-endian, мөр мөрөөр (хойноос урагш, баруунаас зүүн)
  dem.json  { xmin, ymin, xmax, ymax, cols, rows, nodata }
"""
import arcpy, os, json, glob, struct, shutil
import numpy as np

SRC = r"\\SARUUL\Share\EMC\dwg"
DWG = "CMK_202306.DWG"          # хамгийн сүүлийн сарын хэмжилт
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "data")
SR_IN = arcpy.SpatialReference(32648)     # UTM 48N
SR_OUT = arcpy.SpatialReference(4326)
CELL_M = 8.0                              # DEM-ийн нягтрал, м
CELL_DEG = 0.00009                        # ~10 м — гаралтын сүлжээний алхам
NODATA = -9999.0

arcpy.env.overwriteOutput = True
arcpy.CheckOutExtension("3D")
arcpy.CheckOutExtension("Spatial")

scratch = os.path.join(os.environ.get("TEMP", "."), "demwork")
if os.path.isdir(scratch):
    shutil.rmtree(scratch, ignore_errors=True)
os.makedirs(scratch)
gdb = os.path.join(scratch, "w.gdb")
arcpy.management.CreateFileGDB(scratch, "w.gdb")

path = os.path.join(SRC, DWG)
print("эх сурвалж:", DWG, flush=True)

mp = os.path.join(gdb, "mp")
arcpy.management.CopyFeatures(os.path.join(path, "MultiPatch"), mp)
arcpy.management.DefineProjection(mp, SR_IN)

ras = os.path.join(scratch, "dem_utm.tif")
fn = getattr(arcpy.conversion, "MultipatchToRaster", None) or arcpy.ddd.MultipatchToRaster
fn(mp, ras, CELL_M)
print("  UTM DEM бэлэн", flush=True)

# WGS84 руу — апп талд lon/lat-аар шууд түүвэрлэхийн тулд
wgs = os.path.join(scratch, "dem_wgs.tif")
arcpy.management.ProjectRaster(ras, wgs, SR_OUT, "BILINEAR", str(CELL_DEG))

r = arcpy.Raster(wgs)
a = arcpy.RasterToNumPyArray(r, nodata_to_value=np.nan).astype(np.float32)
nod = r.noDataValue
if nod is not None:
    a[a == nod] = np.nan

rows, cols = a.shape
e = r.extent
valid = ~np.isnan(a)
print("  сүлжээ: %d x %d · утгатай %d (%.0f%%)"
      % (cols, rows, int(valid.sum()), valid.sum() / a.size * 100), flush=True)
print("  өндөр: %.1f .. %.1f м" % (float(np.nanmin(a)), float(np.nanmax(a))), flush=True)

out = np.where(valid, a, NODATA).astype("<f4")
os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, "dem.bin"), "wb") as f:
    f.write(out.tobytes())

meta = {
    "xmin": round(e.XMin, 8), "ymin": round(e.YMin, 8),
    "xmax": round(e.XMax, 8), "ymax": round(e.YMax, 8),
    "cols": int(cols), "rows": int(rows),
    "nodata": NODATA,
    "source": DWG,
}
with open(os.path.join(OUT_DIR, "dem.json"), "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

kb = os.path.getsize(os.path.join(OUT_DIR, "dem.bin")) / 1024
print("бичив public/data/dem.bin (%.0f KB) + dem.json" % kb)
print("хүрээ: %.5f, %.5f .. %.5f, %.5f" % (e.XMin, e.YMin, e.XMax, e.YMax))
