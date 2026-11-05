"""Анхны тохиргоо: 4 хэлтэс үүсгэнэ. `--demo` өгвөл шилжилтийн туршилтын дата нэмнэ.

    python -m app.seed          # зөвхөн хэлтсүүд
    python -m app.seed --demo   # + туршилтын хяналтын цэгүүд (DEMO-*)
"""

import math
import random
import sys
from datetime import datetime, timedelta

from sqlalchemy import select

from .database import Base, SessionLocal, engine
from .models import ArcgisDashboard, Department, Measurement, MonitoringPoint

MAPVIEWER = "https://erdenetmining.maps.arcgis.com/apps/mapviewer/index.html?webmap="
EXPERIENCE = "https://experience.arcgis.com/experience/"
SCENE = "https://erdenetmining.maps.arcgis.com/home/webscene/viewer.html?webscene="

DRILL_REPORT = "Өрөмдлөгийн тайлан"
WATER_BALANCE = "Усны баланс"

# Хэлтсүүд — «EMC united HUB»-ын «Нэгдсэн систем» цэсийн дарааллаар. Код нь URL-д хэрэглэгдэнэ.
# Өнгө нь бараан дэвсгэр дээр шалгагдсан ангиллын палитрын 1–7 дахь слот, дарааллаар нь.
# dashboards: (ArcGIS item id, нэр, дэд ангилал[, нэг табд нэгтгэх бүлэг])
DEPARTMENTS = [
    {
        "code": "GMH",
        "name": "Геологи, маркшейдер",
        "color": "#3987e5",
        "description": "Геологи, уул уурхай, хаягдлын далан, кадастр ба лицензийн талбай",
        "links": [
            {"title": "Геологийн зураг", "url": MAPVIEWER + "2e2c998d01f74db19dc45e12519ae619"},
            {"title": "Геофизикийн зураг", "url": MAPVIEWER + "c8c6227616b346e7bf2c5f561fb67dd8"},
            {"title": "Геохимийн мэдээлэл", "url": MAPVIEWER + "f1a296ee3a5c4c11bfd280dcdbb3bf6b"},
            {"title": "3D загвар (EMC Realistic)", "url": EXPERIENCE + "f143761080d84cd59c4aac12534ed6f4"},
            {"title": "EMC Schematic", "url": SCENE + "d6d031c558ed47e781626d76e2391ada"},
            {"title": "CCTV", "url": EXPERIENCE + "02b1b62efcf34518a4475029b6d3a5bc"},
            {"title": "Үндсэн геомэдээллийн сан", "url": "https://erdenetmining.maps.arcgis.com/apps/instant/atlas/index.html?appid=a4df590b646243dcbf7c2288b4c85b7b"},
        ],
        "dashboards": [
            ("e009bee96a01463da6ea562c3ec8f030", "Хайгуулын цооногийн мэдээлэл", "Геологи"),
            ("ef613a0502c74faf9ed7ed95412dd4e0", "Цооногийн мэдээлэл", "Геологи"),
            ("d50ba73480fd4a96ae83656d7438ed1f", "Нэгдсэн тайлан", "Геологи", DRILL_REPORT),
            ("f32f890793984c13824263d87e9c969e", "Өрмийн машин", "Геологи", DRILL_REPORT),
            ("0b51c6d23a604d54aa2ef92683d0ac0a", "Цооног ба интервал", "Геологи", DRILL_REPORT),
            ("d794edd303ad4a788a91b9378dfc0461", "Овоолго", "Уул уурхай"),
            ("e3629640d8dd45698968acc1244cf133", "Нөөцийн мэдээлэл", "Уул уурхай"),
            ("7de28b1b1fd84d75be4cfb3b376c1113", "Түүхэн мэдээлэл", "Уул уурхай"),
            ("e50476e7809b4a76a0650bbe1e45e8b2", "Хиймэл нуурын түүхэн мэдээлэл", "Хаягдлын далан"),
            ("f17b1fc982aa4db687f1927f37416ce4", "Оролт", "Хаягдлын далан", WATER_BALANCE),
            ("60269f37a24a4bcda81469f3e8bf607f", "Гаралт", "Хаягдлын далан", WATER_BALANCE),
            ("4aa22bcf722b42af9a04bfbc38a46758", "Ерөнхий мэдээлэл", "Хаягдлын далан", WATER_BALANCE),
            ("38f309925fe447bb886268dd921b3da0", "Бусад мэдээлэл", "Хаягдлын далан", WATER_BALANCE),
            ("c78ba973fe1e4dfe9eb2569a83558e0c", "Говил", "Хаягдлын далан"),
            ("add0cac7777548b8ae50a56540ac9dab", "Пьезометр", "Хаягдлын далан"),
            ("6881797668e94c309b6da112353c31f7", "Цацраг худаг", "Хаягдлын далан"),
            ("e1ec8b20a6d347e68e64349abf134d50", "Газрын бүртгэл", "Кадастр"),
            ("b84bc4b55e2d45d99e2e85cb8aaf08c3", "Лицензийн талбай", "Кадастр"),
        ],
    },
    {
        "code": "COM",
        "name": "Холбоо шугамын байгууламж",
        "color": "#d95926",
        "description": "Кабелийн сүлжээ, дуудлага, үзлэг",
        "links": [],
        "dashboards": [
            ("8cbeb0e832c345c88edf491a518af092", "Кабелийн сүлжээ", "Кабелийн сүлжээ"),
            ("a7183226293c4b2788e7b00164fba242", "Кабель дуудлага, үзлэг", "Кабелийн сүлжээ"),
        ],
    },
    {
        "code": "BOH",
        "name": "Байгаль орчин, ногоон хөгжил",
        "color": "#c98500",
        "description": "Нөхөн сэргээлт, хөрс, ус, агаар, цагаан тоос, модны бүртгэл",
        "links": [],
        "dashboards": [
            ("2fc14c08d9994d64aa7a3ae0beeb5ac7", "Цагаан тоос 2013-2025", "Хяналт шинжилгээ"),
            ("a61b6ca8b88c4c7db3dfb3305d4168f0", "Хөрс", "Хяналт шинжилгээ"),
            ("3b0fe193e4d64909a00e12887494531f", "Ус", "Хяналт шинжилгээ"),
            ("55e91e367ac0480c8e0f4d4abd94f817", "Агаар", "Хяналт шинжилгээ"),
            ("41e720a94df34af4a2914a5867a150df", "Нөхөн сэргээлт", "Ногоон төгөл"),
            ("743b66104ae6488b9c78dbb06cb74de9", "Ногоон төгөл", "Ногоон төгөл"),
            ("25408bc53b2142ec91ca41b0720f644c", "Нэгдсэн модны бүртгэл", "Ногоон төгөл"),
        ],
    },
    {
        "code": "HSE",
        "name": "ХАБЭА",
        "color": "#008300",
        "description": "Хөдөлмөрийн аюулгүй байдал, эрүүл ахуй, хяналтын камер",
        "links": [{"title": "Хяналтын камер (3D)", "url": SCENE + "cc73e402e8a44a0fa3499a20ab08d0ff"}],
        "dashboards": [
            ("5c194c8de5fe41b0951b15efb98a9cd6", "Хөдөлмөрийн аюулгүй байдал", "Аюулгүй байдал"),
        ],
    },
]

# Эрдэнэтийн уурхайн орчим (туршилтын цэгүүдийн байршилд)
PIT_LAT, PIT_LON = 49.021, 104.122


REMOVED_DEPARTMENTS = ("MEC", "NHT", "GHE")


def seed_departments(db) -> int:
    """Байхгүй хэлтсийг dashboard-уудтай нь нэмнэ. Байгаа хэлтсийг (UI-аар зассан бол) хөндөхгүй."""
    added = 0
    for i, d in enumerate(DEPARTMENTS):
        if db.scalar(select(Department).where(Department.code == d["code"])):
            continue
        dep = Department(sort_order=i, **{k: v for k, v in d.items() if k != "dashboards"})
        dep.dashboards = [
            ArcgisDashboard(item_id=t[0], title=t[1], group=t[2], section=(t[3:] or [None])[0], sort_order=j)
            for j, t in enumerate(d["dashboards"])
        ]
        db.add(dep)
        added += 1
    db.commit()
    return added


def remove_departments(db) -> None:
    """Цэснээс хасагдсан хэлтсийг өмнө үүссэн өгөгдлийн сангаас устгана. Байршуулсан өгөгдөлтэй бол хөндөхгүй."""
    for dep in db.scalars(select(Department).where(Department.code.in_(REMOVED_DEPARTMENTS))):
        if not dep.datasets:
            db.delete(dep)
    db.commit()


def apply_sections(db) -> None:
    """Өмнө үүссэн өгөгдлийн санд нэгтгэсэн табын бүлэг, нэр, дарааллыг нэг удаа тавина."""
    for d in DEPARTMENTS:
        for j, t in enumerate(d["dashboards"]):
            if len(t) < 4:
                continue
            for row in db.scalars(select(ArcgisDashboard).where(ArcgisDashboard.item_id == t[0], ArcgisDashboard.section.is_(None))):
                row.title, row.section, row.sort_order = t[1], t[3], j
    db.commit()


def seed_demo_displacement(db, days: int = 60) -> int:
    rnd = random.Random(42)
    start = datetime(2026, 9, 1, 8, 0)
    sectors = ["Хойд хана", "Зүүн хана", "Өмнөд хана", "Баруун хана"]
    created = 0
    for i in range(12):
        code = f"DEMO-P{i + 1:02d}"
        if db.scalar(select(MonitoringPoint).where(MonitoringPoint.code == code)):
            continue
        angle = 2 * math.pi * i / 12
        p = MonitoringPoint(
            code=code,
            name=f"Призм {i + 1}",
            instrument="prism",
            sector=sectors[i // 3],
            lat=PIT_LAT + 0.011 * math.cos(angle),
            lon=PIT_LON + 0.017 * math.sin(angle),
            elevation=1300 + rnd.uniform(-60, 60),
            note="DEMO — туршилтын зохиомол дата",
        )
        db.add(p)
        db.flush()

        # Ханын налуугийн доош (төв рүү) чиглэлтэй шилжилт
        ux, uy = -math.sin(angle), -math.cos(angle)
        base_v = rnd.uniform(0.2, 1.5)  # мм/хоног
        accelerating = i == 4  # нэг цэг хурдсаж буй (нуралтын өмнөх) горимтой
        moderate = i in (8, 9)
        x0, y0, z0 = 500000 + 900 * math.sin(angle), 5430000 + 900 * math.cos(angle), p.elevation
        disp = 0.0
        for day in range(days):
            if accelerating and day > 35:
                v = base_v + 0.35 * (day - 35) ** 1.5
            elif moderate:
                v = base_v + 3.0
            else:
                v = base_v
            disp += v
            noise = [rnd.gauss(0, 0.6) for _ in range(3)]
            db.add(
                Measurement(
                    point_id=p.id,
                    measured_at=start + timedelta(days=day),
                    x=x0 + (ux * disp * 0.9 + noise[0]) / 1000,
                    y=y0 + (uy * disp * 0.9 + noise[1]) / 1000,
                    z=z0 + (-disp * 0.4 + noise[2]) / 1000,
                )
            )
        created += 1
    db.commit()
    return created


def main():
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        print(f"Хэлтэс нэмэгдсэн: {seed_departments(db)}")
        if "--demo" in sys.argv:
            print(f"Туршилтын цэг нэмэгдсэн: {seed_demo_displacement(db)}")


if __name__ == "__main__":
    main()
