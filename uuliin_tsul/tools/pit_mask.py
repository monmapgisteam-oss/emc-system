# -*- coding: utf-8 -*-
"""
Ил уурхайн хотгорын маск — build_pit.py ба build_pit_mesh.py ХОЁУЛАА үүнийг
ашиглана. Өмнө нь тус тусдаа маск хэрэглэж байсан тул мэш нь питээр
тайрагдаж, хаялбарын полигон нь бүх хэмжилтийн талбайгаас гарч,
питийн гадна «хөвөгч хэлтэрхий» үүсдэг байсан.

Аргачлал:  Fill(DEM) − DEM = хотгорын гүн.
           Хамгийн гүн цэгтэй холбогдсон хэсгийг л авна (BFS).
           Ирмэгийг багтаахаар цөөн нүд тэлнэ.

MIN_DEPTH-ийг 3 м болгосон: 1 м байхад питээс гарсан гүехэн ус зайлуулах
суваг маскд орж, мэш дээр урт нимгэн хэлтэрхий үүсгэж байсан.
"""
import arcpy
import numpy as np

MIN_DEPTH = 3.0    # м — үүнээс гүн хотгорыг л пит гэж үзнэ
DILATE    = 5      # нүд — питийн ирмэгийг багтаах тэлэлт


def pit_mask(ras_path, verbose=True):
    """DEM-ийн зам өгвөл питийн нүднүүдийн bool маск буцаана."""
    from collections import deque

    r = arcpy.Raster(ras_path)
    a = arcpy.RasterToNumPyArray(r, nodata_to_value=np.nan).astype(np.float64)
    nodata = r.noDataValue
    if nodata is not None:
        a[a == nodata] = np.nan

    filled = arcpy.sa.Fill(ras_path)
    fa = arcpy.RasterToNumPyArray(filled, nodata_to_value=np.nan).astype(np.float64)
    depth = fa - a
    mask = np.nan_to_num(depth, nan=0.0) > MIN_DEPTH
    if not mask.any():
        if verbose:
            print("    хотгор олдсонгүй", flush=True)
        return None, a

    rows, cols = a.shape
    flat = np.where(~np.isnan(a), a, np.inf)
    si, sj = np.unravel_index(int(np.argmin(flat)), a.shape)
    if not mask[si, sj]:
        ri, ci = np.where(mask)
        si, sj = int(ri[0]), int(ci[0])

    keep = np.zeros(a.shape, dtype=bool)
    keep[si, sj] = True
    dq = deque([(si, sj)])
    while dq:
        i, j = dq.popleft()
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ni, nj = i + di, j + dj
            if 0 <= ni < rows and 0 <= nj < cols and mask[ni, nj] and not keep[ni, nj]:
                keep[ni, nj] = True
                dq.append((ni, nj))

    for _ in range(DILATE):
        g = keep.copy()
        g[1:, :] |= keep[:-1, :]
        g[:-1, :] |= keep[1:, :]
        g[:, 1:] |= keep[:, :-1]
        g[:, :-1] |= keep[:, 1:]
        keep = g
    keep &= ~np.isnan(a)

    if verbose:
        print("    хотгор: %d нүд · гүн %.0f м · MIN_DEPTH %.0f м · тэлэлт %d"
              % (int(keep.sum()), float(np.nanmax(depth)), MIN_DEPTH, DILATE), flush=True)
    return keep, a


def masked_raster(ras_path, out_path, verbose=True):
    """Питээр тайрсан DEM-ийг диск рүү бичээд замыг нь буцаана."""
    keep, a = pit_mask(ras_path, verbose)
    if keep is None:
        return ras_path
    r = arcpy.Raster(ras_path)
    out = np.where(keep, a, np.nan)
    nod = -9999.0
    out = np.where(np.isnan(out), nod, out).astype(np.float32)
    ll = arcpy.Point(r.extent.XMin, r.extent.YMin)
    ras = arcpy.NumPyArrayToRaster(out, ll, r.meanCellWidth, r.meanCellHeight, nod)
    arcpy.management.DefineProjection(ras, r.spatialReference)
    ras.save(out_path)
    return out_path
