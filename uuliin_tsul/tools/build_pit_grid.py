# -*- coding: utf-8 -*-
"""
Питийн мэшийн эх цэг ба 5 м-ийн тор -> public/data/pit_grid.json

Ажиллуулах (numpy л хэрэгтэй):
  python tools/build_pit_grid.py

Питийн гадаргууг хөтөч AGOL-ын сар бүрийн 3D object давхаргаас (DWG-ийн
multipatch) шууд татаж, энэ эх цэгийн 5 м-ийн торон дээр мэш болгоно
(lib/pitSource.ts). Давхаргыг тайрахгүй — бүтэн хүрээгээр нь харуулна.

Эх цэг, тор нь build_pit_mesh.py-ийн GLB-тэй ЯГ ижил (pit_mesh.json-оос
авна) тул блок загвар (build_block_mesh.py), замын өндөр, сар хоорондын
өөрчлөлт өмнөх шигээ таарна.

Гаралт:
  lon, lat, z  — мэшийн эх цэг
  x0, y0       — эх цэгийн UTM 48N координат (м)
  cell         — торны алхам (м)
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_block_mesh import utm_forward

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
CELL = 5.0


def main():
    info = json.load(open(os.path.join(DATA, "pit_mesh.json"), encoding="utf-8"))
    origins = {(v["lon"], v["lat"], v["z"]) for v in info.values()}
    assert len(origins) == 1, "сарын мэшүүдийн эх цэг ялгаатай: %s" % origins
    lon, lat, z = origins.pop()

    x0, y0 = utm_forward(lon, lat)
    out = {"lon": lon, "lat": lat, "z": z, "x0": round(x0, 3), "y0": round(y0, 3), "cell": CELL}
    with open(os.path.join(DATA, "pit_grid.json"), "w", encoding="utf-8") as f:
        json.dump(out, f)
    print("эх цэг %.8f, %.8f, %.2f м · UTM %.3f, %.3f" % (lon, lat, z, x0, y0))


if __name__ == "__main__":
    main()
