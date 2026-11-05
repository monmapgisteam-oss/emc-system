from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Measurement, MonitoringPoint
from ..schemas import MeasurementIn, PointBase, PointOut, PointUpdate
from ..services import importer
from ..services.displacement import Thresholds, analyze

router = APIRouter(prefix="/api/displacement", tags=["Уулын цулын шилжилт"])


def _analyze(p: MonitoringPoint, window_days: float) -> dict:
    ms = p.measurements
    return analyze(
        [m.measured_at for m in ms],
        [(m.x, m.y, m.z) for m in ms],
        Thresholds(p.warning_velocity, p.alarm_velocity),
        window_days,
    )


def _get(db: Session, point_id: int) -> MonitoringPoint:
    p = db.get(MonitoringPoint, point_id)
    if not p:
        raise HTTPException(404, "Цэг олдсонгүй")
    return p


@router.get("/points", response_model=list[PointOut])
def list_points(window_days: float = Query(3.0, gt=0), db: Session = Depends(get_db)):
    out = []
    for p in db.scalars(select(MonitoringPoint).order_by(MonitoringPoint.code)).all():
        item = PointOut.model_validate(p)
        item.summary = _analyze(p, window_days)["summary"]
        out.append(item)
    return out


@router.post("/points", response_model=PointOut)
def create_point(body: PointBase, db: Session = Depends(get_db)):
    if db.scalar(select(MonitoringPoint).where(MonitoringPoint.code == body.code)):
        raise HTTPException(400, "Ийм кодтой цэг бүртгэлтэй байна")
    p = MonitoringPoint(**body.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.put("/points/{point_id}", response_model=PointOut)
def update_point(point_id: int, body: PointUpdate, db: Session = Depends(get_db)):
    p = _get(db, point_id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    db.commit()
    return p


@router.delete("/points/{point_id}")
def delete_point(point_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, point_id))
    db.commit()
    return {"ok": True}


@router.get("/points/{point_id}/analysis")
def point_analysis(point_id: int, window_days: float = Query(3.0, gt=0), db: Session = Depends(get_db)):
    p = _get(db, point_id)
    return {"point": PointOut.model_validate(p).model_dump(exclude={"summary"}), **_analyze(p, window_days)}


@router.post("/points/{point_id}/measurements")
def add_measurement(point_id: int, body: MeasurementIn, db: Session = Depends(get_db)):
    p = _get(db, point_id)
    db.add(Measurement(point_id=p.id, **body.model_dump()))
    db.commit()
    return {"ok": True}


@router.post("/measurements/import")
async def import_measurements(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """CSV/Excel: point_code, measured_at, x, y, z. Шинэ цэгийн код ирвэл автоматаар бүртгэнэ."""
    content = await file.read()
    try:
        rows = importer.prepare_measurements(importer.read_table(content, file.filename))
    except ValueError as e:
        raise HTTPException(400, str(e))

    points = {p.code: p for p in db.scalars(select(MonitoringPoint)).all()}
    existing = {(m.point_id, m.measured_at) for m in db.scalars(select(Measurement)).all()}
    created_points = inserted = skipped = 0
    for r in rows:
        p = points.get(r["point_code"])
        if p is None:
            p = MonitoringPoint(code=r["point_code"])
            db.add(p)
            db.flush()
            points[p.code] = p
            created_points += 1
        key = (p.id, r["measured_at"])
        if key in existing:
            skipped += 1
            continue
        existing.add(key)
        db.add(Measurement(point_id=p.id, measured_at=r["measured_at"], x=r["x"], y=r["y"], z=r["z"]))
        inserted += 1
    db.commit()
    return {"inserted": inserted, "skipped_duplicates": skipped, "created_points": created_points}
