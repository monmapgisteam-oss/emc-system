from datetime import datetime

from pydantic import BaseModel, ConfigDict


class Link(BaseModel):
    title: str
    url: str


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: str | None
    color: str
    sort_order: int
    links: list[Link]
    dataset_count: int = 0
    record_count: int = 0
    dashboard_count: int = 0


class DepartmentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    links: list[Link] | None = None


class DatasetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    department_id: int
    name: str
    description: str | None
    source_file: str | None
    columns: list[str]
    date_column: str | None
    lat_column: str | None
    lon_column: str | None
    created_at: datetime
    record_count: int = 0


class RecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    data: dict
    record_date: datetime | None
    lat: float | None
    lon: float | None


class RecordPage(BaseModel):
    total: int
    items: list[RecordOut]


class PointBase(BaseModel):
    code: str
    name: str | None = None
    instrument: str = "prism"
    sector: str | None = None
    lat: float | None = None
    lon: float | None = None
    elevation: float | None = None
    warning_velocity: float = 3.0
    alarm_velocity: float = 10.0
    active: bool = True
    note: str | None = None


class PointUpdate(BaseModel):
    name: str | None = None
    instrument: str | None = None
    sector: str | None = None
    lat: float | None = None
    lon: float | None = None
    elevation: float | None = None
    warning_velocity: float | None = None
    alarm_velocity: float | None = None
    active: bool | None = None
    note: str | None = None


class PointOut(PointBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    summary: dict | None = None


class MeasurementIn(BaseModel):
    measured_at: datetime
    x: float
    y: float
    z: float
