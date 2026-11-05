"""Уулын цулын шилжилтийн дүн шинжилгээ.

- Шилжилт: эхний (суурь) хэмжилтээс хойших dE, dN, dZ, хэвтээ, 3D (мм)
- Хурд: сүүлийн `window_days` хоногийн шилжилтэд шугаман регресс (мм/хоног)
- Хурдатгал: хурдны цуваанд мөн адил регресс (мм/хоног²)
- Нуралтын урьдчилсан хугацаа: Fukuzono-гийн урвуу хурдны арга (1/v → 0)
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np

MIN_VELOCITY = 0.05  # мм/хоног, үүнээс бага хурдыг урвуу хурдад тооцохгүй
PREDICT_MIN_POINTS = 5
PREDICT_MIN_R2 = 0.6


@dataclass
class Thresholds:
    warning: float
    alarm: float


def _slope(t: np.ndarray, v: np.ndarray) -> float | None:
    if len(t) < 2 or np.ptp(t) == 0:
        return None
    return float(np.polyfit(t, v, 1)[0])


def _rolling_slope(t: np.ndarray, v: np.ndarray, window: float) -> list[float | None]:
    out: list[float | None] = []
    for i in range(len(t)):
        mask = (t >= t[i] - window) & (t <= t[i]) & ~np.isnan(v)
        out.append(_slope(t[mask], v[mask]))
    return out


def predict_failure(t: np.ndarray, inv_v: np.ndarray, n_points: int = 10) -> dict | None:
    """Урвуу хурдны сүүлийн цэгүүдэд шугам тааруулж 1/v = 0 болох хугацааг олно."""
    valid = ~np.isnan(inv_v)
    tt, iv = t[valid][-n_points:], inv_v[valid][-n_points:]
    if len(tt) < PREDICT_MIN_POINTS or np.ptp(tt) == 0:
        return None
    slope, intercept = np.polyfit(tt, iv, 1)
    if slope >= 0:
        return None
    fitted = slope * tt + intercept
    ss_res = float(np.sum((iv - fitted) ** 2))
    ss_tot = float(np.sum((iv - iv.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    if r2 < PREDICT_MIN_R2:
        return None
    t_fail = -intercept / slope
    if t_fail < tt[-1]:
        return None
    return {"t_days": float(t_fail), "r2": round(r2, 3), "slope": float(slope), "intercept": float(intercept)}


def classify(velocity: float | None, days_to_failure: float | None, th: Thresholds) -> str:
    if velocity is None:
        return "no_data"
    if velocity >= th.alarm or (days_to_failure is not None and days_to_failure <= 7):
        return "alarm"
    if velocity >= th.warning or (days_to_failure is not None and days_to_failure <= 30):
        return "warning"
    return "normal"


def _r(x, n=3):
    if x is None:
        return None
    x = float(x)
    return None if np.isnan(x) else round(x, n)


def analyze(
    times: list[datetime],
    xyz: list[tuple[float, float, float]],
    thresholds: Thresholds,
    window_days: float = 3.0,
) -> dict:
    if not times:
        return {"series": [], "summary": {"status": "no_data", "count": 0}}

    t0 = times[0]
    t = np.array([(ti - t0).total_seconds() / 86400 for ti in times])
    p = np.asarray(xyz, dtype=float)
    d = (p - p[0]) * 1000.0  # мм
    de, dn, dz = d[:, 0], d[:, 1], d[:, 2]
    dh = np.hypot(de, dn)
    d3 = np.sqrt(de**2 + dn**2 + dz**2)

    vel = _rolling_slope(t, d3, window_days)
    vel_arr = np.array([np.nan if v is None else v for v in vel])
    acc = _rolling_slope(t, vel_arr, window_days)
    with np.errstate(divide="ignore", invalid="ignore"):
        inv_v = np.where(vel_arr > MIN_VELOCITY, 1.0 / vel_arr, np.nan)

    pred = predict_failure(t, inv_v)
    failure_at = t0 + timedelta(days=pred["t_days"]) if pred else None
    days_to_failure = pred["t_days"] - t[-1] if pred else None

    series = [
        {
            "measured_at": times[i].isoformat(),
            "de": _r(de[i], 2),
            "dn": _r(dn[i], 2),
            "dz": _r(dz[i], 2),
            "dh": _r(dh[i], 2),
            "d3": _r(d3[i], 2),
            "velocity": _r(vel[i]),
            "acceleration": _r(acc[i], 4),
            "inv_velocity": _r(inv_v[i], 4),
        }
        for i in range(len(times))
    ]

    last_v = vel[-1]
    summary = {
        "count": len(times),
        "first_at": times[0].isoformat(),
        "last_at": times[-1].isoformat(),
        "total_mm": _r(d3[-1], 2),
        "horizontal_mm": _r(dh[-1], 2),
        "vertical_mm": _r(dz[-1], 2),
        "velocity": _r(last_v),
        "acceleration": _r(acc[-1], 4),
        # Хэвтээ шилжилтийн чиглэл, хойд зүгээс цагийн зүүний дагуу (градус)
        "bearing_deg": _r(np.degrees(np.arctan2(de[-1], dn[-1])) % 360, 1) if dh[-1] > 0 else None,
        "predicted_failure_at": failure_at.isoformat() if failure_at else None,
        "days_to_failure": _r(days_to_failure, 1),
        "prediction_r2": pred["r2"] if pred else None,
        "status": classify(last_v, days_to_failure, thresholds),
        "window_days": window_days,
    }
    return {"series": series, "summary": summary}
