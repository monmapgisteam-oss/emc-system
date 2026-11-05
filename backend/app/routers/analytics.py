from collections import Counter

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Dataset, Department, Measurement, MonitoringPoint, Record
from .displacement import _analyze

router = APIRouter(prefix="/api/analytics", tags=["Дүн шинжилгээ"])


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    deps = db.scalars(select(Department).order_by(Department.sort_order)).all()
    ds_counts = dict(db.execute(select(Dataset.department_id, func.count(Dataset.id)).group_by(Dataset.department_id)).all())
    rec_counts = dict(
        db.execute(select(Dataset.department_id, func.count(Record.id)).join(Record).group_by(Dataset.department_id)).all()
    )

    monthly: dict[str, Counter] = {}
    for dep_id, when in db.execute(
        select(Dataset.department_id, Record.record_date).join(Record).where(Record.record_date.is_not(None))
    ).all():
        monthly.setdefault(when.strftime("%Y-%m"), Counter())[dep_id] += 1
    code_by_id = {d.id: d.code for d in deps}
    monthly_rows = [
        {"period": k, **{code_by_id[i]: n for i, n in c.items()}} for k, c in sorted(monthly.items())
    ]

    status = Counter()
    alerts = []
    for p in db.scalars(select(MonitoringPoint).where(MonitoringPoint.active.is_(True))).all():
        s = _analyze(p, 3.0)["summary"]
        status[s["status"]] += 1
        if s["status"] in ("warning", "alarm"):
            alerts.append({"id": p.id, "code": p.code, "sector": p.sector, **s})
    alerts.sort(key=lambda a: (a["status"] != "alarm", -(a.get("velocity") or 0)))

    recent = db.scalars(select(Dataset).order_by(Dataset.created_at.desc()).limit(8)).all()
    return {
        "totals": {
            "departments": len(deps),
            "datasets": sum(ds_counts.values()),
            "records": sum(rec_counts.values()),
            "points": db.scalar(select(func.count(MonitoringPoint.id))),
            "measurements": db.scalar(select(func.count(Measurement.id))),
            "dashboards": sum(len(d.dashboards) for d in deps),
        },
        "departments": [
            {
                "code": d.code,
                "name": d.name,
                "color": d.color,
                "datasets": ds_counts.get(d.id, 0),
                "records": rec_counts.get(d.id, 0),
                "dashboards": len(d.dashboards),
                "description": d.description,
            }
            for d in deps
        ],
        "monthly": monthly_rows,
        "displacement_status": dict(status),
        "alerts": alerts[:10],
        "recent_datasets": [
            {"id": d.id, "name": d.name, "department": code_by_id.get(d.department_id), "created_at": d.created_at}
            for d in recent
        ],
    }
