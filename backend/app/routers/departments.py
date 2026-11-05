from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Dataset, Department, Record
from ..schemas import DatasetOut, DepartmentOut, DepartmentUpdate
from ..services import importer

router = APIRouter(prefix="/api/departments", tags=["Хэлтэс"])


def _counts(db: Session) -> tuple[dict[int, int], dict[int, int]]:
    ds = dict(db.execute(select(Dataset.department_id, func.count(Dataset.id)).group_by(Dataset.department_id)).all())
    rc = dict(
        db.execute(
            select(Dataset.department_id, func.count(Record.id)).join(Record).group_by(Dataset.department_id)
        ).all()
    )
    return ds, rc


def _get(db: Session, code: str) -> Department:
    dep = db.scalar(select(Department).where(Department.code == code.upper()))
    if not dep:
        raise HTTPException(404, "Хэлтэс олдсонгүй")
    return dep


def _out(dep: Department, ds: dict, rc: dict) -> DepartmentOut:
    out = DepartmentOut.model_validate(dep)
    out.dataset_count, out.record_count = ds.get(dep.id, 0), rc.get(dep.id, 0)
    out.dashboard_count = len(dep.dashboards)
    return out


@router.get("", response_model=list[DepartmentOut])
def list_departments(db: Session = Depends(get_db)):
    ds, rc = _counts(db)
    deps = db.scalars(select(Department).order_by(Department.sort_order)).all()
    return [_out(d, ds, rc) for d in deps]


@router.get("/{code}", response_model=DepartmentOut)
def get_department(code: str, db: Session = Depends(get_db)):
    ds, rc = _counts(db)
    return _out(_get(db, code), ds, rc)


@router.put("/{code}", response_model=DepartmentOut)
def update_department(code: str, body: DepartmentUpdate, db: Session = Depends(get_db)):
    dep = _get(db, code)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(dep, k, v)
    db.commit()
    ds, rc = _counts(db)
    return _out(dep, ds, rc)


@router.get("/{code}/datasets", response_model=list[DatasetOut])
def list_datasets(code: str, db: Session = Depends(get_db)):
    dep = _get(db, code)
    counts = dict(
        db.execute(
            select(Record.dataset_id, func.count(Record.id))
            .join(Dataset)
            .where(Dataset.department_id == dep.id)
            .group_by(Record.dataset_id)
        ).all()
    )
    out = []
    for d in sorted(dep.datasets, key=lambda d: d.created_at, reverse=True):
        item = DatasetOut.model_validate(d)
        item.record_count = counts.get(d.id, 0)
        out.append(item)
    return out


@router.post("/{code}/sheets")
async def preview_sheets(code: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Excel файлын хуудсуудын нэрсийг буцаана (импортын өмнө сонгуулахад)."""
    _get(db, code)
    content = await file.read()
    if not file.filename.lower().endswith((".xlsx", ".xlsm", ".xls")):
        return {"sheets": []}
    return {"sheets": importer.list_sheets(content)}


@router.post("/{code}/datasets/import", response_model=DatasetOut)
async def import_dataset(
    code: str,
    file: UploadFile = File(...),
    name: str = Form(""),
    description: str = Form(""),
    sheet: str = Form(""),
    db: Session = Depends(get_db),
):
    dep = _get(db, code)
    content = await file.read()
    try:
        df = importer.read_table(content, file.filename, sheet or 0)
        prepared = importer.prepare_records(df)
    except ValueError as e:
        raise HTTPException(400, str(e))

    ds_name = name.strip() or (f"{file.filename} / {sheet}" if sheet else file.filename)
    ds = Dataset(
        department_id=dep.id,
        name=ds_name,
        description=description or None,
        source_file=file.filename,
        columns=prepared["columns"],
        date_column=prepared["date_column"],
        lat_column=prepared["lat_column"],
        lon_column=prepared["lon_column"],
    )
    ds.records = [Record(**r) for r in prepared["rows"]]
    db.add(ds)
    db.commit()
    db.refresh(ds)
    out = DatasetOut.model_validate(ds)
    out.record_count = len(prepared["rows"])
    return out
