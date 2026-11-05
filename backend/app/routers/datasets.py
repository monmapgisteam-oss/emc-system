from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Dataset, Record
from ..schemas import DatasetOut, RecordPage

router = APIRouter(prefix="/api/datasets", tags=["Дата"])


def _get(db: Session, dataset_id: int) -> Dataset:
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Дата олдсонгүй")
    return ds


@router.get("/{dataset_id}", response_model=DatasetOut)
def get_dataset(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get(db, dataset_id)
    out = DatasetOut.model_validate(ds)
    out.record_count = db.scalar(select(func.count(Record.id)).where(Record.dataset_id == ds.id))
    return out


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, dataset_id))
    db.commit()
    return {"ok": True}


@router.get("/{dataset_id}/records", response_model=RecordPage)
def list_records(
    dataset_id: int,
    limit: int = Query(100, le=5000),
    offset: int = 0,
    q: str = "",
    db: Session = Depends(get_db),
):
    _get(db, dataset_id)
    stmt = select(Record).where(Record.dataset_id == dataset_id)
    if q:
        stmt = stmt.where(cast(Record.data, String).ilike(f"%{q}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(stmt.order_by(Record.id).offset(offset).limit(limit)).all()
    return {"total": total, "items": items}


@router.get("/{dataset_id}/stats")
def dataset_stats(dataset_id: int, db: Session = Depends(get_db)):
    """Тоон баганын статистик, ангиллын баганын давтамж, сараар бичлэгийн тоо."""
    ds = _get(db, dataset_id)
    rows = db.execute(select(Record.data, Record.record_date).where(Record.dataset_id == ds.id)).all()

    numeric, categorical = {}, {}
    for col in ds.columns:
        values = [r.data.get(col) for r in rows if r.data.get(col) is not None]
        nums = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
        if values and len(nums) >= 0.8 * len(values):
            nums.sort()
            n = len(nums)
            numeric[col] = {
                "count": n,
                "min": nums[0],
                "max": nums[-1],
                "mean": sum(nums) / n,
                "median": nums[n // 2] if n % 2 else (nums[n // 2 - 1] + nums[n // 2]) / 2,
                "sum": sum(nums),
            }
        elif values:
            c = Counter(str(v) for v in values)
            if len(c) <= 50:
                categorical[col] = c.most_common(15)

    monthly = Counter(r.record_date.strftime("%Y-%m") for r in rows if r.record_date)
    return {
        "record_count": len(rows),
        "numeric": numeric,
        "categorical": categorical,
        "monthly": sorted(monthly.items()),
    }


@router.get("/{dataset_id}/series")
def dataset_series(dataset_id: int, column: str, agg: str = "sum", db: Session = Depends(get_db)):
    """Огнооны баганаар бүлэглэсэн тоон баганын сарын цуваа (sum | mean | count)."""
    ds = _get(db, dataset_id)
    if column not in ds.columns:
        raise HTTPException(400, "Багана олдсонгүй")
    buckets: dict[str, list[float]] = {}
    for data, when in db.execute(
        select(Record.data, Record.record_date).where(Record.dataset_id == ds.id, Record.record_date.is_not(None))
    ).all():
        v = data.get(column)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            buckets.setdefault(when.strftime("%Y-%m"), []).append(v)
    fn = {"sum": sum, "mean": lambda xs: sum(xs) / len(xs), "count": len}.get(agg, sum)
    return [{"period": k, "value": fn(v)} for k, v in sorted(buckets.items())]
