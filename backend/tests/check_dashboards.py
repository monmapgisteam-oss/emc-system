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
    widgets = dash["widgets"] + ((dash.get("header") or {}).get("selectors") or [])
    # Хөтөч ашигладаг замаар: нэгтгэсэн асуулга ч шалгагдана
    queries = [(w, ds) for w in widgets for ds in w.get("datasets") or []]
    for (w, _), result in zip(queries, arcgis.run_datasets([(ds, [], None) for _, ds in queries])):
        if isinstance(result, arcgis.ArcGISError):
            key = "locked" if result.code == 403 else "error"
            stats[key] += 1
            if key == "error":
                errors.append(f"{w['type']}: {result}")
        else:
            stats["ok"] += 1
    for w in widgets:
        if w["type"] == "mapWidget" and w.get("itemId"):
            try:
                arcgis.map_layers(w["itemId"])
                stats["map"] += 1
            except arcgis.ArcGISError as e:
                stats["map_locked" if e.code == 403 else "error"] += 1
    return item_id, stats, errors


items = [(d["code"], t[0], t[1]) for d in DEPARTMENTS for t in d["dashboards"]]
with ThreadPoolExecutor(6) as pool:
    results = {r[0]: r for r in pool.map(check, [i for _, i, _ in items])}

for code, item_id, title in items:
    _, st, errs = results[item_id]
    status = "OK    " if not st["locked"] and not st["error"] and not st["map_locked"] else ("LOCKED" if not st["error"] else "ERROR ")
    print(f"{status} {code} {title:38} {dict(st)}")
    for e in errs[:3]:
        print("        ", e[:160])
sys.exit(1 if any(r[1]["error"] for r in results.values()) else 0)
