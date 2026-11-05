"""Бүх бүртгэлтэй dashboard-ын виджет бүрийн асуулгыг ArcGIS-ээс шалгана (сүлжээ шаардлагатай).

    python -m tests.check_dashboards
"""

import collections
import sys
from concurrent.futures import ThreadPoolExecutor

from app.seed import DEPARTMENTS
from app.services import arcgis


def check(item_id: str) -> tuple[str, collections.Counter, list[str]]:
    stats: collections.Counter = collections.Counter()
    errors: list[str] = []
    try:
        dash = arcgis.dashboard(item_id)
    except arcgis.ArcGISError as e:
        stats["locked" if e.code == 403 else "error"] += 1
        return item_id, stats, [] if e.code == 403 else [str(e)]
    for w in dash["widgets"] + ((dash.get("header") or {}).get("selectors") or []):
        for ds in w.get("datasets") or []:
            try:
                arcgis.run_dataset(ds, [])
                stats["ok"] += 1
            except arcgis.ArcGISError as e:
                key = "locked" if e.code == 403 else "error"
                stats[key] += 1
                if key == "error":
                    errors.append(f"{w['type']}: {e}")
        if w["type"] == "mapWidget" and w.get("itemId"):
            try:
                arcgis.map_layers(w["itemId"])
                stats["map"] += 1
            except arcgis.ArcGISError as e:
                stats["map_locked" if e.code == 403 else "error"] += 1
    return item_id, stats, errors


items = [(d["code"], i, t) for d in DEPARTMENTS for i, t, _ in d["dashboards"]]
with ThreadPoolExecutor(6) as pool:
    results = {r[0]: r for r in pool.map(check, [i for _, i, _ in items])}

for code, item_id, title in items:
    _, st, errs = results[item_id]
    status = "OK    " if not st["locked"] and not st["error"] and not st["map_locked"] else ("LOCKED" if not st["error"] else "ERROR ")
    print(f"{status} {code} {title:38} {dict(st)}")
    for e in errs[:3]:
        print("        ", e[:160])
sys.exit(1 if any(r[1]["error"] for r in results.values()) else 0)
