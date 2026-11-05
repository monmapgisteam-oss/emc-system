import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ArcgisDashboard, DashboardLayout, Department
from ..services import arcgis

router = APIRouter(tags=["ArcGIS dashboard"])

ITEM_ID = re.compile(r"[0-9a-f]{32}")


class DashboardIn(BaseModel):
    url: str  # dashboard URL эсвэл item id
    title: str | None = None
    group: str | None = None


class RuntimeFilter(BaseModel):
    field: str
    op: str = "in"  # in | between | contains
    values: list


class QueryIn(BaseModel):
    widget_id: str
    dataset: str = "main"
    filters: list[RuntimeFilter] = []
    sort_desc: str | None = None  # энэ талбараар их нь эхэнд (олон бичлэгтэй давхарга)


class BatchIn(BaseModel):
    queries: list[QueryIn] = Field(max_length=300)


def _err(e: arcgis.ArcGISError):
    return HTTPException(e.code if e.code in (400, 401, 403, 404) else 502, str(e))


def _dash_out(d: ArcgisDashboard) -> dict:
    return {"id": d.id, "item_id": d.item_id, "title": d.title, "group": d.group, "section": d.section, "sort_order": d.sort_order}


@router.get("/api/arcgis/status")
def status():
    return {"portal": arcgis.PORTAL, "credentials": arcgis.has_credentials()}


@router.post("/api/arcgis/cache/clear")
def clear_cache():
    arcgis.clear_cache()
    return {"ok": True}


@router.get("/api/dashboards")
def all_dashboards(db: Session = Depends(get_db)):
    """Бүх хэлтсийн dashboard — нүүр хуудасны каталогт."""
    deps = db.scalars(select(Department).order_by(Department.sort_order)).all()
    return [
        {**_dash_out(d), "department": dep.code, "department_name": dep.name, "color": dep.color}
        for dep in deps
        for d in dep.dashboards
    ]


@router.get("/api/departments/{code}/dashboards")
def list_dashboards(code: str, db: Session = Depends(get_db)):
    dep = db.scalar(select(Department).where(Department.code == code.upper()))
    if not dep:
        raise HTTPException(404, "Хэлтэс олдсонгүй")
    return [_dash_out(d) for d in dep.dashboards]


@router.post("/api/departments/{code}/dashboards")
async def add_dashboard(code: str, body: DashboardIn, db: Session = Depends(get_db)):
    dep = db.scalar(select(Department).where(Department.code == code.upper()))
    if not dep:
        raise HTTPException(404, "Хэлтэс олдсонгүй")
    m = ITEM_ID.search(body.url)
    if not m:
        raise HTTPException(400, "URL-ээс dashboard-ын item id олдсонгүй")
    title = body.title
    try:
        meta = await run_in_threadpool(arcgis.item, m.group(0))
        if meta.get("type") != "Dashboard":
            raise HTTPException(400, f"Энэ item dashboard биш ({meta.get('type')})")
        title = title or meta.get("title")
    except arcgis.ArcGISError as e:
        if e.code != 403 or not title:
            raise _err(e)
    d = ArcgisDashboard(
        department_id=dep.id, item_id=m.group(0), title=title, group=body.group, sort_order=len(dep.dashboards)
    )
    db.add(d)
    db.commit()
    return _dash_out(d)


@router.delete("/api/dashboards/{dashboard_id}")
def delete_dashboard(dashboard_id: int, db: Session = Depends(get_db)):
    d = db.get(ArcgisDashboard, dashboard_id)
    if not d:
        raise HTTPException(404, "Dashboard олдсонгүй")
    db.delete(d)
    db.commit()
    return {"ok": True}


SNAPSHOTS = Path(__file__).resolve().parents[2] / "def_snapshots"


def _snapshot_def(d: dict):
    """Хаалттай dashboard-ын бүтцийг (виджет, байрлал — өгөгдөлгүй) хадгална: нэвтрэлтгүйгээр байрлал засварлахад."""
    if not ITEM_ID.fullmatch(str(d.get("id"))):
        return
    try:
        SNAPSHOTS.mkdir(exist_ok=True)
        (SNAPSHOTS / f"{d['id']}.json").write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


@router.get("/api/arcgis/dashboards/{item_id}")
async def dashboard_definition(item_id: str):
    def load():
        d = arcgis.dashboard(item_id)
        if d.get("access") != "public":
            _snapshot_def(d)
        return d

    try:
        # JSON нь шууд ArcGIS-ээс ирсэн: том тодорхойлолтыг дахин хөрвүүлж цаг алдахгүй
        return JSONResponse(await run_in_threadpool(load))
    except arcgis.ArcGISError as e:
        raise _err(e)


def _dataset_of(dash: dict, query: QueryIn) -> dict:
    widget = arcgis.find_widget(dash, query.widget_id)
    ds = next((d for d in widget.get("datasets") or [] if d.get("name") == query.dataset), None)
    if ds is None:
        raise arcgis.ArcGISError("Виджетийн dataset олдсонгүй", 404)
    return ds


@router.post("/api/arcgis/dashboards/{item_id}/query")
async def dashboard_query(item_id: str, body: QueryIn):
    """Нэг виджетийн асуулга. Хуучин frontend (барьсан dist, нээлттэй таб) шинэчлэгдэх хүртэл ажилласаар байна."""

    def run():
        ds = _dataset_of(arcgis.dashboard(item_id), body)
        return arcgis.run_dataset(ds, [f.model_dump() for f in body.filters], body.sort_desc)

    try:
        return JSONResponse(await run_in_threadpool(run))
    except arcgis.ArcGISError as e:
        raise _err(e)


@router.post("/api/arcgis/dashboards/{item_id}/query-batch")
async def dashboard_query_batch(item_id: str, body: BatchIn):
    """Нэг дор гарсан виджетүүдийн асуулга нэг хүсэлтээр: хөтчийн зэрэг хүсэлтийн хязгаарт зогсохгүй."""

    def run():
        dash = arcgis.dashboard(item_id)
        results: list = [None] * len(body.queries)
        valid = []
        for i, query in enumerate(body.queries):
            try:
                valid.append((i, (_dataset_of(dash, query), [f.model_dump() for f in query.filters], query.sort_desc)))
            except arcgis.ArcGISError as e:
                results[i] = e
        for (i, _), result in zip(valid, arcgis.run_datasets([q for _, q in valid])):
            results[i] = result
        return {"results": [{"error": str(r), "status": r.code} if isinstance(r, arcgis.ArcGISError) else r for r in results]}

    try:
        return JSONResponse(await run_in_threadpool(run))
    except arcgis.ArcGISError as e:
        raise _err(e)


class LayoutIn(BaseModel):
    sizes: dict[str, list[float]] = {}
    tree: dict | None = None
    prefs: dict[str, str | None] = {}


def _layout_out(lay: DashboardLayout | None) -> dict:
    if not lay:
        return {"sizes": {}, "tree": None, "prefs": {}, "updated_by": None, "updated_at": None, "has_backup": False}
    return {
        "sizes": lay.sizes or {},
        "tree": lay.tree,
        "prefs": lay.prefs or {},
        "updated_by": lay.updated_by,
        "updated_at": lay.updated_at.isoformat() if lay.updated_at else None,
        "has_backup": bool(lay.backup),
    }


def _snapshot(lay: DashboardLayout) -> dict | None:
    return {"sizes": lay.sizes or {}, "tree": lay.tree, "prefs": lay.prefs or {}} if (lay.sizes or lay.tree or lay.prefs) else None


LAYOUT_TYPES = {"stackLayoutElement", "tabsLayoutElement", "itemLayoutElement"}


def _check_tree(node: dict, depth: int = 0):
    """Хэрэглэгчийн layout модыг шалгана: зөвхөн мэдэгдэх төрөл, хэт гүн/том биш."""
    if depth > 8 or not isinstance(node, dict) or node.get("type") not in LAYOUT_TYPES or not isinstance(node.get("id"), str):
        raise HTTPException(400, "Layout бүтэц буруу")
    kids = node.get("elements") or []
    if not isinstance(kids, list) or len(kids) > 30:
        raise HTTPException(400, "Layout бүтэц буруу")
    for k in kids:
        _check_tree(k, depth + 1)


@router.get("/api/arcgis/dashboards/{item_id}/layout")
def get_layout(item_id: str, db: Session = Depends(get_db)):
    """Бүх хэрэглэгчид харагдах үндсэн байрлал (самбаруудын хэмжээ)."""
    return _layout_out(db.get(DashboardLayout, item_id))


@router.put("/api/arcgis/dashboards/{item_id}/layout")
def save_layout(item_id: str, body: LayoutIn, request: Request, db: Session = Depends(get_db)):
    if not ITEM_ID.fullmatch(item_id):
        raise HTTPException(400, "Буруу item id")
    clean = {}
    for stack_id, sizes in body.sizes.items():
        if len(stack_id) > 64 or not sizes or len(sizes) > 50 or any(not (0 < s < 1e6) for s in sizes):
            raise HTTPException(400, "Байрлалын утга буруу")
        clean[stack_id] = [round(s, 5) for s in sizes]
    lay = db.get(DashboardLayout, item_id) or DashboardLayout(item_id=item_id)
    lay.backup = _snapshot(lay) or lay.backup
    # Өмнө хадгалсан бусад хэсгийг хадгалж, шинээр ирсэн хэсгүүдийг дарж бичнэ
    lay.sizes = {**(lay.sizes or {}), **clean}
    if body.prefs:
        for k, v in body.prefs.items():
            if len(k) > 120 or (v is not None and len(v) > 120):
                raise HTTPException(400, "Тохиргооны утга буруу")
        merged = {**(lay.prefs or {}), **body.prefs}
        lay.prefs = {k: v for k, v in merged.items() if v}
    if body.tree is not None:
        _check_tree(body.tree)
        lay.tree = body.tree
    user = getattr(request.state, "user", None)
    lay.updated_by = (user.full_name or user.username) if user else None
    db.add(lay)
    db.commit()
    return _layout_out(lay)


@router.delete("/api/arcgis/dashboards/{item_id}/layout")
def reset_layout(item_id: str, db: Session = Depends(get_db)):
    """Үндсэн байрлалыг ArcGIS-ийн анхных руу буцаана (өмнөхийг нь буцааж болохоор хадгална)."""
    lay = db.get(DashboardLayout, item_id)
    if not lay:
        return _layout_out(None)
    lay.backup = _snapshot(lay) or lay.backup
    lay.sizes, lay.tree, lay.prefs = {}, None, {}
    db.commit()
    return _layout_out(lay)


@router.post("/api/arcgis/dashboards/{item_id}/layout/undo")
def undo_layout(item_id: str, request: Request, db: Session = Depends(get_db)):
    """Өмнөх үндсэн байрлалыг сэргээнэ (одоогийнхтой нь сольж — дахин дарвал буцна)."""
    lay = db.get(DashboardLayout, item_id)
    if not lay or not lay.backup:
        raise HTTPException(404, "Буцаах өмнөх байрлал алга")
    current = _snapshot(lay)
    lay.sizes, lay.tree, lay.prefs = lay.backup.get("sizes") or {}, lay.backup.get("tree"), lay.backup.get("prefs") or {}
    lay.backup = current
    user = getattr(request.state, "user", None)
    lay.updated_by = (user.full_name or user.username) if user else lay.updated_by
    db.commit()
    return _layout_out(lay)


@router.get("/api/arcgis/webmaps/{item_id}/tree")
async def webmap_tree(item_id: str):
    try:
        return await run_in_threadpool(arcgis.map_tree, item_id)
    except arcgis.ArcGISError as e:
        raise _err(e)


@router.get("/api/arcgis/webmaps/{item_id}/layers")
async def webmap_layers(item_id: str):
    try:
        return await run_in_threadpool(arcgis.map_layers, item_id)
    except arcgis.ArcGISError as e:
        raise _err(e)
