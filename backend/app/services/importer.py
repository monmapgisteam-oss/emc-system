"""Excel/CSV файлыг хэлтсийн дата болон шилжилтийн хэмжилт болгон уншина."""

import io
import math
from datetime import date, datetime

import pandas as pd

DATE_HINTS = ("огноо", "date", "time", "datetime", "хугацаа")
LAT_HINTS = ("lat", "latitude", "өргөрөг")
LON_HINTS = ("lon", "lng", "long", "longitude", "уртраг")


def read_table(content: bytes, filename: str, sheet: str | int = 0) -> pd.DataFrame:
    name = filename.lower()
    if name.endswith((".csv", ".txt")):
        for enc in ("utf-8-sig", "cp1251"):
            try:
                return pd.read_csv(io.BytesIO(content), encoding=enc)
            except UnicodeDecodeError:
                continue
        raise ValueError("CSV файлын кодчилол танигдсангүй (UTF-8 эсвэл CP1251 байх ёстой)")
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        return pd.read_excel(io.BytesIO(content), sheet_name=sheet)
    raise ValueError("Зөвхөн .xlsx, .xlsm, .xls, .csv файл дэмжинэ")


def list_sheets(content: bytes) -> list[str]:
    return [str(s) for s in pd.ExcelFile(io.BytesIO(content)).sheet_names]


def _json_safe(v):
    if hasattr(v, "item") and not isinstance(v, (pd.Timestamp,)):  # numpy скаляр
        v = v.item()
    if v is None:
        return None
    if isinstance(v, float):
        return None if math.isnan(v) or math.isinf(v) else v
    if isinstance(v, (pd.Timestamp, datetime, date)):
        return None if pd.isna(v) else v.isoformat()
    if isinstance(v, (int, str, bool)):
        return v
    return None if pd.isna(v) else str(v)


def _find(columns: list[str], hints: tuple[str, ...]) -> str | None:
    for c in columns:
        lc = c.lower().strip()
        if lc in hints:
            return c
    for c in columns:
        if any(h in c.lower() for h in hints):
            return c
    return None


def _to_dt(v) -> datetime | None:
    if v is None:
        return None
    ts = pd.to_datetime(v, errors="coerce")
    return None if pd.isna(ts) else ts.to_pydatetime().replace(tzinfo=None)


def _to_float(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def prepare_records(df: pd.DataFrame) -> dict:
    df = df.dropna(how="all").dropna(axis=1, how="all")
    df.columns = [str(c).strip() or f"col_{i}" for i, c in enumerate(df.columns)]
    columns = list(df.columns)
    date_col = _find(columns, DATE_HINTS)
    lat_col = _find(columns, LAT_HINTS)
    lon_col = _find(columns, LON_HINTS)

    rows = []
    for raw in df.to_dict(orient="records"):
        rows.append(
            {
                "data": {k: _json_safe(v) for k, v in raw.items()},
                "record_date": _to_dt(raw.get(date_col)) if date_col else None,
                "lat": _to_float(raw.get(lat_col)) if lat_col else None,
                "lon": _to_float(raw.get(lon_col)) if lon_col else None,
            }
        )
    return {"columns": columns, "date_column": date_col, "lat_column": lat_col, "lon_column": lon_col, "rows": rows}


MEASUREMENT_ALIASES = {
    "point_code": ("point_code", "point", "code", "цэг", "цэгийн код", "prism"),
    "measured_at": ("measured_at", "datetime", "date", "time", "огноо", "хугацаа"),
    "x": ("x", "e", "easting", "east"),
    "y": ("y", "n", "northing", "north"),
    "z": ("z", "h", "elev", "elevation", "height", "өндөр"),
}


def prepare_measurements(df: pd.DataFrame) -> list[dict]:
    lower = {str(c).strip().lower(): c for c in df.columns}
    mapping = {}
    for key, aliases in MEASUREMENT_ALIASES.items():
        col = next((lower[a] for a in aliases if a in lower), None)
        if col is None:
            raise ValueError(f"'{key}' багана олдсонгүй. Шаардлагатай баганууд: point_code, measured_at, x, y, z")
        mapping[key] = col

    out = []
    for raw in df.to_dict(orient="records"):
        code = _json_safe(raw[mapping["point_code"]])
        when = _to_dt(raw[mapping["measured_at"]])
        x, y, z = (_to_float(raw[mapping[k]]) for k in ("x", "y", "z"))
        if code is None or when is None or None in (x, y, z):
            continue
        out.append({"point_code": str(code).strip(), "measured_at": when, "x": x, "y": y, "z": z})
    return out
