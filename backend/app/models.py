from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    """Дотоод хэрэглэгч (ArcGIS-гүй үед нэвтрэх). Үндсэн нэвтрэлт нь ArcGIS Online-ы EMC эрхээр."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(20), default="user")  # user | admin
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class UserSession(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # cookie-д хадгалах санамсаргүй утга
    username: Mapped[str] = mapped_column(String(100), index=True)
    full_name: Mapped[str | None] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(20))  # arcgis | local
    role: Mapped[str] = mapped_column(String(20), default="user")
    arcgis_token: Mapped[str | None] = mapped_column(Text)
    arcgis_referer: Mapped[str | None] = mapped_column(String(300))
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Department(Base):
    """Хэлтэс. Дата нь хэлтэс бүрийн Dataset-үүдэд хадгалагдана."""

    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(16), default="#2563eb")
    sort_order: Mapped[int] = mapped_column(default=0)
    # [{"title": "...", "url": "..."}] — ArcGIS webmap, Experience апп гэх мэт
    links: Mapped[list] = mapped_column(JSON, default=list)

    datasets: Mapped[list["Dataset"]] = relationship(
        back_populates="department", cascade="all, delete-orphan"
    )
    dashboards: Mapped[list["ArcgisDashboard"]] = relationship(
        back_populates="department", cascade="all, delete-orphan", order_by="ArcgisDashboard.sort_order"
    )


class ArcgisDashboard(Base):
    """ArcGIS Online дээрх dashboard — системд шууд (live) зурагдана."""

    __tablename__ = "arcgis_dashboards"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(300))
    group: Mapped[str | None] = mapped_column(String(100))  # Дэд ангилал: Геологи, Хаягдлын далан...
    section: Mapped[str | None] = mapped_column(String(100))  # Нэг табд нэгтгэгдэх бүлэг: Өрөмдлөгийн тайлан...
    sort_order: Mapped[int] = mapped_column(default=0)

    department: Mapped[Department] = relationship(back_populates="dashboards")


class Dataset(Base):
    """Хэлтсийн нэг хүснэгт дата (Excel/CSV-ээс импортолсон)."""

    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    source_file: Mapped[str | None] = mapped_column(String(500))
    columns: Mapped[list] = mapped_column(JSON, default=list)
    date_column: Mapped[str | None] = mapped_column(String(200))
    lat_column: Mapped[str | None] = mapped_column(String(200))
    lon_column: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)  # орон нутгийн цаг

    department: Mapped[Department] = relationship(back_populates="datasets")
    records: Mapped[list["Record"]] = relationship(back_populates="dataset", cascade="all, delete-orphan")


class Record(Base):
    __tablename__ = "records"

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    data: Mapped[dict] = mapped_column(JSON)
    record_date: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)

    dataset: Mapped[Dataset] = relationship(back_populates="records")


class DashboardLayout(Base):
    """Dashboard-ын самбаруудын үндсэн хэмжээ (бүх хэрэглэгчид). Хоосон бол ArcGIS-ийн анхны байрлал."""

    __tablename__ = "dashboard_layouts"

    item_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    # {stack_id: [хэсгүүдийн харьцаа, ...]}
    sizes: Mapped[dict] = mapped_column(JSON, default=dict)
    # Самбаруудыг дахин байрлуулсан бүтэн layout мод (ArcGIS-ийн layout-ийг орлоно). Хоосон бол ArcGIS-ийнх.
    tree: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Өмнөх хувилбар ({sizes, tree}) — «Бүгдэд үндсэн болгох» эсвэл «ArcGIS анхных» дарсны дараа буцаахад
    backup: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Текст тохиргоо — жишээ нь газрын зургийн цэгийг өнгөлөх талбар {"color:<map>:<layer>": "field"}
    prefs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class MonitoringPoint(Base):
    """Уулын цулын шилжилтийн хяналтын цэг (призм, GNSS, экстенсометр...)."""

    __tablename__ = "monitoring_points"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(200))
    instrument: Mapped[str] = mapped_column(String(30), default="prism")
    sector: Mapped[str | None] = mapped_column(String(100))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    elevation: Mapped[float | None] = mapped_column(Float)
    # Хурдны босго, мм/хоног
    warning_velocity: Mapped[float] = mapped_column(Float, default=3.0)
    alarm_velocity: Mapped[float] = mapped_column(Float, default=10.0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str | None] = mapped_column(Text)

    measurements: Mapped[list["Measurement"]] = relationship(
        back_populates="point", cascade="all, delete-orphan", order_by="Measurement.measured_at"
    )


class Measurement(Base):
    """Цэгийн координатын хэмжилт, метрээр (UTM / орон нутгийн координат)."""

    __tablename__ = "measurements"
    __table_args__ = (UniqueConstraint("point_id", "measured_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    point_id: Mapped[int] = mapped_column(ForeignKey("monitoring_points.id", ondelete="CASCADE"), index=True)
    measured_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    x: Mapped[float] = mapped_column(Float)  # Easting
    y: Mapped[float] = mapped_column(Float)  # Northing
    z: Mapped[float] = mapped_column(Float)  # Өндөр

    point: Mapped[MonitoringPoint] = relationship(back_populates="measurements")
