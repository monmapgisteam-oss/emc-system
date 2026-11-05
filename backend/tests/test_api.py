import io
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    os.environ["EMC_DATABASE_URL"] = f"sqlite:///{tmp_path_factory.mktemp('db') / 'test.db'}"
    from fastapi.testclient import TestClient

    from app.auth import hash_password
    from app.database import SessionLocal
    from app.main import app
    from app.models import User

    with TestClient(app) as c:
        with SessionLocal() as db:
            db.add(User(username="tester", full_name="Тест", password_hash=hash_password("secret-pass")))
            db.commit()
        # Нэвтрээгүй үед API хаалттай
        assert c.get("/api/departments").status_code == 401
        r = c.post("/api/auth/login", json={"username": "tester", "password": "secret-pass"})
        assert r.status_code == 200, r.text
        yield c


def test_auth_me_and_wrong_password(client):
    assert client.get("/api/auth/me").json()["username"] == "tester"
    from fastapi.testclient import TestClient

    from app.main import app

    anon = TestClient(app)
    assert anon.post("/api/auth/login", json={"username": "tester", "password": "wrong"}).status_code == 401
    assert anon.get("/api/auth/me").status_code == 401


def test_login_throttle():
    from app import auth

    for _ in range(auth.MAX_FAILS):
        auth._record_fail("someone")
    with pytest.raises(auth.AuthError) as e:
        auth._check_throttle("someone")
    assert e.value.code == 429


def test_password_hash_roundtrip():
    from app.auth import hash_password, verify_password

    h = hash_password("Эрдэнэт-2026")
    assert verify_password("Эрдэнэт-2026", h) and not verify_password("x", h)


def test_mine_app_requires_login(client):
    from fastapi.testclient import TestClient

    from app.main import app

    anon = TestClient(app)
    for path in ("/uuliin-tsul/", "/data/excel.json", "/_next/static/x.js", "/logo.svg"):
        assert anon.get(path).status_code == 401


def test_departments_seeded(client):
    deps = client.get("/api/departments").json()
    assert len(deps) == 4
    assert deps[0]["code"] == "GMH"


def test_import_dataset_and_stats(client):
    csv = "Огноо,Цооног,Гүн,RQD\n2025-01-05,DH-1,120.5,78\n2025-01-20,DH-2,98,65\n2025-02-03,DH-3,150,81\n"
    r = client.post(
        "/api/departments/COM/datasets/import",
        files={"file": ("drill.csv", io.BytesIO(csv.encode("utf-8")), "text/csv")},
        data={"name": "Өрөмдлөг 2025"},
    )
    assert r.status_code == 200, r.text
    ds = r.json()
    assert ds["record_count"] == 3 and ds["date_column"] == "Огноо"

    stats = client.get(f"/api/datasets/{ds['id']}/stats").json()
    assert stats["numeric"]["RQD"]["max"] == 81
    assert stats["monthly"] == [["2025-01", 2], ["2025-02", 1]]

    page = client.get(f"/api/datasets/{ds['id']}/records", params={"q": "DH-2"}).json()
    assert page["total"] == 1


def test_displacement_import_and_alarm(client):
    start = datetime(2026, 10, 1)
    lines = ["point_code,measured_at,x,y,z"]
    disp = 0.0
    for d in range(30):
        disp += 1 + (0.5 * (d - 15) ** 1.6 if d > 15 else 0)  # мм
        lines.append(f"T1,{(start + timedelta(days=d)).isoformat()},{500000 + disp / 1000},5430000,1300")
        lines.append(f"T2,{(start + timedelta(days=d)).isoformat()},{500000 + d * 0.2 / 1000},5430000,1300")
    r = client.post(
        "/api/displacement/measurements/import",
        files={"file": ("m.csv", io.BytesIO("\n".join(lines).encode()), "text/csv")},
    )
    assert r.json() == {"inserted": 60, "skipped_duplicates": 0, "created_points": 2}

    points = {p["code"]: p for p in client.get("/api/displacement/points").json()}
    assert points["T1"]["summary"]["status"] == "alarm"
    assert points["T2"]["summary"]["status"] == "normal"
    assert abs(points["T2"]["summary"]["velocity"] - 0.2) < 0.01
    assert points["T1"]["summary"]["bearing_deg"] == 90.0  # зүүн тийш

    overview = client.get("/api/analytics/overview").json()
    assert overview["displacement_status"]["alarm"] == 1


def test_dashboards_seeded(client):
    dashboards = client.get("/api/departments/GMH/dashboards").json()
    assert len(dashboards) == 18
    assert dashboards[0]["group"] == "Геологи"


def _env_groups(client):
    return [(d["title"], d["group"]) for d in client.get("/api/departments/BOH/dashboards").json()][:4]


ENV_GROUPS = [
    ("Цагаан тоос 2013-2025", "Цагаан тоос"),
    ("Ус", "Хүрээлэн буй орчин"),
    ("Хөрс", "Хүрээлэн буй орчин"),
    ("Агаар", "Хүрээлэн буй орчин"),
]


def test_environment_groups(client):
    assert _env_groups(client) == ENV_GROUPS
    rows = client.get("/api/departments/BOH/dashboards").json()
    assert [(d["title"], d["group"]) for d in rows][4:6] == [("Ус", "Баяжуулах үйлдвэр"), ("Агаар", "Баяжуулах үйлдвэр")]
    # Бүлгүүд цэсэнд энэ дарааллаар гарна
    assert list(dict.fromkeys(d["group"] for d in rows)) == ["Цагаан тоос", "Хүрээлэн буй орчин", "Баяжуулах үйлдвэр", "Ногоон төгөл"]


def test_added_dashboards_reach_old_db_once(client):
    """Хуучин өгөгдлийн санд шинэ dashboard Ногоон төгөлийн өмнө орно. Дараа нь устгасан бол буцаж гарч ирэхгүй."""
    from sqlalchemy import delete, select

    from app.database import SessionLocal
    from app.models import ArcgisDashboard, Department
    from app.seed import ADDED_DASHBOARDS, apply_groups
    from app.services.plant_dashboards import PLANT_AIR

    def boh(db):
        db.expire_all()
        return db.scalar(select(Department).where(Department.code == "BOH"))

    def make_old(db):
        db.execute(delete(ArcgisDashboard).where(ArcgisDashboard.item_id.in_(ADDED_DASHBOARDS)))
        boh(db).dashboards[0].group = "Хяналт шинжилгээ"
        db.commit()

    with SessionLocal() as db:
        make_old(db)
        apply_groups(db)
        apply_groups(db)
        dep = boh(db)
        assert [d.group for d in dep.dashboards][3:7] == ["Хүрээлэн буй орчин", "Баяжуулах үйлдвэр", "Баяжуулах үйлдвэр", "Ногоон төгөл"]
        assert len(dep.dashboards) == 9
        # Админ устгасан: сервер дахин асахад буцаж гарч ирэхгүй
        db.execute(delete(ArcgisDashboard).where(ArcgisDashboard.item_id == PLANT_AIR))
        db.commit()
        apply_groups(db)
        assert len(boh(db).dashboards) == 8
        # Дараагийн тестүүдэд буцаана
        make_old(db)
        apply_groups(db)
        assert len(boh(db).dashboards) == 9


def test_plant_dashboards_are_self_contained(client):
    """Хоёр самбар ArcGIS item-гүй: тодорхойлолт сүлжээгүй ирж, бүх холбоос, байрлал нь тодорхой виджет заана."""
    from app.services import arcgis
    from app.services.plant_dashboards import AIR_URL, PLANT_AIR, PLANT_WATER, WATER_URL

    for item_id, url in ((PLANT_WATER, WATER_URL), (PLANT_AIR, AIR_URL)):
        dash = client.get(f"/api/arcgis/dashboards/{item_id}").json()
        selectors = dash["header"]["selectors"]
        assert [s["datasets"][0]["groupByFields"][0] for s in selectors] == ["Сорьцын_нэр", "Жил", "Сар", "Өдөр"]
        widgets = {w["id"]: w for w in [*dash["widgets"], *selectors]}

        def items(node):
            return [node["id"]] if node["type"] == "itemLayoutElement" else [i for k in node["elements"] for i in items(k)]

        placed = items(dash["layout"])
        assert sorted(placed) == sorted(w["id"] for w in dash["widgets"])
        for w in widgets.values():
            for ds in w.get("datasets") or []:
                assert arcgis.resolve_source(ds["dataSource"])["url"] == url
            for ev in w.get("events") or []:
                for t in ev["actions"][0]["targets"]:
                    assert t["targetId"].split("#")[0] in widgets
        layers = client.get(f"/api/arcgis/webmaps/{item_id}/layers").json()["layers"]
        map_id = next(w["id"] for w in dash["widgets"] if w["type"] == "mapWidget")
        assert any(t["targetId"] == f"{map_id}#{layers[0]['id']}" for t in selectors[0]["events"][0]["actions"][0]["targets"])
        assert layers[0]["url"] == url and layers[0]["kind"] == "feature"


class FakeArcgis:
    """ArcGIS-ийн оронд: давхаргын мэдээлэл, статистик асуулгыг бичиж, хариулна."""

    def __init__(self, broken_field=None):
        self.queries = []
        self.broken_field = broken_field

    def __call__(self, url, params, method="GET"):
        from app.services.arcgis import ArcGISError

        if not url.endswith("/query"):
            return {"fields": [{"name": n, "type": "esriFieldTypeDouble"} for n in ("Сар", "pH", "Cu", "Мо")]}
        self.queries.append(params)
        stats = json.loads(params["outStatistics"])
        if any(s["onStatisticField"] == self.broken_field for s in stats):
            raise ArcGISError("Invalid field", 400)
        value = {"pH": 7.5, "Cu": 0.4, "Мо": 1.6}
        rows = [{"Сар": m, **{s["outStatisticFieldName"]: value.get(s["onStatisticField"], 1.0) * m for s in stats}} for m in (1, 2)]
        return {"features": [{"attributes": r} for r in rows]}


def _stat_ds(field, out, group=("Сар",), where=None):
    ds = {
        "type": "serviceDataset",
        "dataSource": {"url": "https://example.test/FeatureServer/0"},
        "groupByFields": list(group),
        "statisticDefinitions": [{"onStatisticField": field, "statisticType": "avg", "outStatisticFieldName": out}],
    }
    if where:
        ds["filter"] = where
    return ds


@pytest.fixture
def fake_arcgis(monkeypatch):
    from app.services import arcgis

    def install(**kwargs):
        fake = FakeArcgis(**kwargs)
        monkeypatch.setattr(arcgis, "_request", fake)
        arcgis.clear_cache()
        return fake

    yield install
    arcgis.clear_cache()


def test_batch_merges_same_query_and_keeps_each_widgets_names(fake_arcgis):
    """Давхцсан гаралтын нэртэй (AVG___) статистикууд нэг асуулгад нийлж, виджет бүр өөрийн утгаа авна."""
    from app.services import arcgis

    fake = fake_arcgis()
    results = arcgis.run_datasets([(_stat_ds("pH", "AVG___"), [], None), (_stat_ds("Cu", "AVG___"), [], None), (_stat_ds("Мо", "AVG_MO"), [], None)])

    assert len(fake.queries) == 1
    assert [r["rows"] for r in results] == [
        [{"Сар": 1, "AVG___": 7.5}, {"Сар": 2, "AVG___": 15.0}],
        [{"Сар": 1, "AVG___": 0.4}, {"Сар": 2, "AVG___": 0.8}],
        [{"Сар": 1, "AVG_MO": 1.6}, {"Сар": 2, "AVG_MO": 3.2}],
    ]
    # Дахин асуухад кэшээс, тус бүрийн `run_dataset` ч мөн кэшээс
    arcgis.run_datasets([(_stat_ds("pH", "AVG___"), [], None)])
    assert arcgis.run_dataset(_stat_ds("Cu", "AVG___"), [])["rows"] == results[1]["rows"]
    assert len(fake.queries) == 1


def test_batch_separates_different_where_and_grouping(fake_arcgis):
    from app.services import arcgis

    fake = fake_arcgis()
    month = {"field": "Сар", "op": "in", "values": [1]}
    arcgis.run_datasets([(_stat_ds("pH", "A"), [], None), (_stat_ds("Cu", "B"), [month], None), (_stat_ds("Мо", "C", group=()), [], None)])
    assert len(fake.queries) == 3


def test_batch_keeps_stat_ordering_query_apart(fake_arcgis):
    """Статистикийн утгаар эрэмбэлсэн асуулга нэрээ солихгүйн тулд нэгтгэгдэхгүй."""
    from app.services import arcgis

    fake = fake_arcgis()
    ordered = {**_stat_ds("pH", "AVG_PH"), "orderByFields": ["AVG_PH DESC"]}
    results = arcgis.run_datasets([(ordered, [], None), (_stat_ds("Cu", "AVG_CU"), [], None)])
    assert len(fake.queries) == 2
    assert results[0]["rows"][0]["AVG_PH"] == 7.5


def test_batch_error_stays_with_its_widget(fake_arcgis):
    """Нэг талбар буруу бол бусад виджет үр дүнгээ авч, зөвхөн тэр нь алдаа харуулна."""
    from app.services import arcgis

    fake_arcgis(broken_field="Cu")
    results = arcgis.run_datasets([(_stat_ds("pH", "A"), [], None), (_stat_ds("Cu", "B"), [], None)])
    assert results[0]["rows"][0]["A"] == 7.5
    assert isinstance(results[1], arcgis.ArcGISError) and results[1].code == 400


def test_batch_keeps_user_token_in_worker_threads(fake_arcgis):
    """Зэрэгцээ thread дээр ч нэвтэрсэн хэрэглэгчийн кэш, token ашиглагдана."""
    from app.services import arcgis

    seen = []
    fake = fake_arcgis()
    original = arcgis._request

    def spy(url, params, method="GET"):
        seen.append(arcgis.token())
        return original(url, params, method)

    arcgis._request = spy
    try:
        arcgis.set_user("saruul", "user-token", "http://localhost")
        arcgis.run_datasets([(_stat_ds("pH", "A"), [], None), (_stat_ds("Cu", "B"), [], None)])
    finally:
        arcgis.set_user(None, None, None)
    assert seen and set(seen) == {"user-token"}
    assert any(k.startswith("u:saruul|q:") for k in arcgis._cache)
    assert fake.queries


def test_expired_definition_is_served_then_refreshed(monkeypatch):
    """Хугацаа нь дууссан тодорхойлолт хүлээлгүй хариулж, ард нь шинэчлэгдэнэ. Устсан бол хуучнаар цааш өгөхгүй."""
    import time

    from app.services import arcgis

    arcgis.clear_cache()
    calls = []

    def load(version):
        def fn():
            calls.append(version)
            return {"v": version}

        return fn

    assert arcgis._cached_item("x", load(1)) == {"v": 1}
    with arcgis._lock:
        arcgis._cache["pub|x"] = (time.time() - arcgis.ITEM_TTL - 1, {"v": 1})
    assert arcgis._cached_item("x", load(2)) == {"v": 1}
    for _ in range(100):
        if arcgis._cache["pub|x"][1] == {"v": 2}:
            break
        time.sleep(0.01)
    assert arcgis._cached_item("x", load(3)) == {"v": 2}
    assert calls == [1, 2]

    def gone():
        raise arcgis.ArcGISError("Item олдсонгүй", 404)

    with arcgis._lock:
        arcgis._cache["pub|x"] = (time.time() - arcgis.ITEM_TTL - 1, {"v": 2})
    assert arcgis._cached_item("x", gone) == {"v": 2}
    for _ in range(100):
        if "pub|x" not in arcgis._cache:
            break
        time.sleep(0.01)
    assert "pub|x" not in arcgis._cache
    arcgis.clear_cache()


def test_deleted_item_is_404_and_not_served_stale(monkeypatch):
    """ArcGIS устсан item-д 400 (CONT_0001) буцаадаг: олдсонгүй гэж ойлгож, хуучнаар цааш өгөхгүй."""
    import time

    from app.services import arcgis

    class Reply:
        status_code = 200

        def json(self):
            return {"error": {"code": 400, "messageCode": "CONT_0001", "message": "Item does not exist or is inaccessible.", "details": []}}

    monkeypatch.setattr(arcgis._client, "get", lambda *a, **k: Reply())
    arcgis.clear_cache()
    with pytest.raises(arcgis.ArcGISError) as e:
        arcgis.item("missing")
    assert e.value.code == 404
    with arcgis._lock:
        arcgis._cache["pub|item:gone"] = (time.time() - arcgis.ITEM_TTL - 1, {"type": "Dashboard"})
    assert arcgis.item("gone") == {"type": "Dashboard"}
    for _ in range(100):
        if "pub|item:gone" not in arcgis._cache:
            break
        time.sleep(0.01)
    assert "pub|item:gone" not in arcgis._cache
    arcgis.clear_cache()


def test_built_definitions_do_not_grow_without_limit(monkeypatch):
    from app.services import arcgis

    arcgis.clear_cache()
    monkeypatch.setattr(arcgis, "MAX_BUILT", 3)
    monkeypatch.setattr(arcgis, "item", lambda i: {"type": "Dashboard", "title": i})
    monkeypatch.setattr(arcgis, "item_data", lambda i: {"widgets": []})
    for i in range(10):
        arcgis.dashboard(f"d{i}")
    assert len(arcgis._built) == 3 and ("pub", "d9") in arcgis._built
    arcgis.clear_cache()


def test_slow_queries_do_not_block_cached_definitions(monkeypatch):
    """Бүх асуулгын thread удаан давхаргад завгүй байхад ч шүүлтүүр дарахад тодорхойлолт шууд уншигдана."""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from app.services import arcgis

    arcgis.clear_cache()
    monkeypatch.setattr(arcgis, "item", lambda i: {"type": "Dashboard", "title": i})
    monkeypatch.setattr(arcgis, "item_data", lambda i: {"widgets": []})
    release = threading.Event()
    blockers = [arcgis._submit_query(release.wait, 10) for _ in range(20)]
    try:
        with ThreadPoolExecutor(1) as caller:
            assert caller.submit(arcgis.dashboard, "abc").result(timeout=5)["id"] == "abc"
    finally:
        release.set()
        for blocker in blockers:
            blocker.result(timeout=5)
    arcgis.clear_cache()


def test_filters_on_missing_fields_are_reported(fake_arcgis):
    """Давхаргад талбар нь байхгүй шүүлтүүрийг алгассанаа хэлнэ: виджет «шүүгдсэн» тэмдэг харуулахгүй."""
    from app.services import arcgis

    fake_arcgis()
    known = {"field": "Сар", "op": "in", "values": [1]}
    missing = {"field": "Байхгүй", "op": "in", "values": ["x"]}
    assert arcgis.run_datasets([(_stat_ds("pH", "A"), [], None)])[0]["ignored_filters"] == 0
    # Шүүлтүүргүй хариу кэшид байгаа ч энэ асуулгын алгассан тоо зөв
    assert arcgis.run_datasets([(_stat_ds("pH", "A"), [missing], None)])[0]["ignored_filters"] == 1
    assert arcgis.run_datasets([(_stat_ds("pH", "A"), [known, missing], None)])[0]["ignored_filters"] == 1
    assert arcgis.run_dataset(_stat_ds("pH", "A"), [known])["ignored_filters"] == 0


def test_timed_out_merged_query_is_not_asked_again(monkeypatch):
    """Хариу өгөхгүй давхаргыг нэг нэгээр дахин асууж, виджетүүдийг хоёр дахин удаан хүлээлгэхгүй."""
    import httpx

    from app.services import arcgis

    calls = []

    def hung(url, params, method="GET"):
        if not url.endswith("/query"):
            return {"fields": [{"name": n, "type": "esriFieldTypeDouble"} for n in ("Сар", "pH", "Cu")]}
        calls.append(params)
        raise httpx.ReadTimeout("timed out")

    monkeypatch.setattr(arcgis, "_request", hung)
    arcgis.clear_cache()
    results = arcgis.run_datasets([(_stat_ds("pH", "A"), [], None), (_stat_ds("Cu", "B"), [], None)])
    assert all(isinstance(r, arcgis.ArcGISError) for r in results)
    assert len(calls) == 1
    arcgis.clear_cache()


def test_single_query_route_still_works_for_old_frontend(client, fake_arcgis):
    """start.bat барьсан dist-ийг дахин бүтээдэггүй: хуучин frontend татсны дараа ч ажиллана."""
    from app.services.plant_dashboards import PLANT_WATER

    fake_arcgis()
    url = f"/api/arcgis/dashboards/{PLANT_WATER}/query"
    ok = client.post(url, json={"widget_id": "plant-water-chart-ph", "dataset": "main", "filters": []})
    assert ok.status_code == 200 and ok.json()["rows"]
    assert client.post(url, json={"widget_id": "no-such-widget", "dataset": "main", "filters": []}).status_code == 404


def test_batch_unexpected_error_stays_with_its_widget(fake_arcgis):
    """ArcGIS-ийн алдаа биш, төлөвлөөгүй алдаа ч зөвхөн тэр виджетэд үлдэнэ."""
    from app.services import arcgis

    fake_arcgis()
    bad = _stat_ds("pH", "A")
    del bad["statisticDefinitions"][0]["outStatisticFieldName"]
    results = arcgis.run_datasets([(bad, [], None), (_stat_ds("Cu", "B"), [], None)])
    assert results[1]["rows"][0]["B"] == 0.4
    assert len(results) == 2


def test_batch_asks_a_closed_source_only_once(monkeypatch):
    """Хаалттай давхарга: 30 виджет тус бүр дахин асууж хүсэлтийг хүлээлгэхгүй."""
    from app.services import arcgis

    calls = []

    def closed(url, params, method="GET"):
        calls.append(url)
        raise arcgis.ArcGISError("Энэ item хаалттай. ArcGIS нэвтрэх эрх тохируулна уу.", 403)

    monkeypatch.setattr(arcgis, "_request", closed)
    arcgis.clear_cache()
    results = arcgis.run_datasets([(_stat_ds("pH", f"V{i}"), [], None) for i in range(30)])
    assert all(isinstance(r, arcgis.ArcGISError) and r.code == 403 for r in results)
    assert len(calls) == 1
    arcgis.clear_cache()


def test_dashboard_rebuilds_when_data_changes(monkeypatch):
    """Шинэ огноотой хуучин виджет кэшлэгдэхгүй: data шинэчлэгдэхэд тодорхойлолт дахин бүтнэ."""
    from app.services import arcgis

    arcgis.clear_cache()
    meta = {"type": "Dashboard", "title": "T", "modified": 2}
    old_data = {"desktopView": {"widgets": [{"id": "old", "type": "indicatorWidget"}]}}
    new_data = {"desktopView": {"widgets": [{"id": "new", "type": "indicatorWidget"}]}}
    state = {"data": old_data}
    monkeypatch.setattr(arcgis, "item", lambda i: meta)
    monkeypatch.setattr(arcgis, "item_data", lambda i: state["data"])
    first = arcgis.dashboard("abc")
    assert first["widgets"][0]["id"] == "old" and arcgis.dashboard("abc") is first
    state["data"] = new_data
    assert arcgis.dashboard("abc")["widgets"][0]["id"] == "new"
    arcgis.clear_cache()


def test_cache_does_not_grow_without_limit(monkeypatch):
    from app.services import arcgis

    arcgis.clear_cache()
    monkeypatch.setattr(arcgis, "MAX_CACHE", 100)
    for i in range(250):
        arcgis._put(f"k{i}", i)
    assert len(arcgis._cache) <= 100
    assert "k249" in arcgis._cache and "k0" not in arcgis._cache
    arcgis.clear_cache()


def test_changed_arcgis_dashboard_still_opens():
    """ArcGIS дээр бүтэц өөрчлөгдсөн ч самбар унахгүй: нэмэлт нь хэрэгжих хэмжээгээр, эс бөгөөс анхны хэлбэрээр."""
    from app.services.dashboard_extras import EXTRAS, apply
    from app.services.env_extras import AIR, DUST, GROVE, RECLAMATION, SOIL, TREES, WATER

    empty = {"header": {"selectors": []}, "layout": None, "widgets": []}
    strange_layout = {"type": "stackLayoutElement", "id": "r", "elements": [{"type": "itemLayoutElement", "id": "x"}]}
    strange = {"header": None, "layout": strange_layout, "widgets": [{"id": "x", "type": "serialChartWidget", "chartConfig": {"stackedType": None}}]}
    for item_id in (WATER, SOIL, AIR, DUST, RECLAMATION, GROVE, TREES):
        assert item_id in EXTRAS
        assert apply({**empty, "id": item_id})["id"] == item_id
        assert apply({**strange, "id": item_id})["widgets"][0]["id"] == "x"
    # Алдаа гарвал анхны тодорхойлолт
    EXTRAS["boom"] = lambda d: 1 / 0
    try:
        original = {"id": "boom", "widgets": []}
        assert apply(original) is original
    finally:
        del EXTRAS["boom"]


def test_query_batch_endpoint(client, fake_arcgis, monkeypatch):
    """Хариу нь асуултын дарааллаар, олдоогүй виджет зөвхөн өөрөө алдаа авна."""
    from app.services.plant_dashboards import PLANT_AIR

    fake = fake_arcgis()
    r = client.post(
        f"/api/arcgis/dashboards/{PLANT_AIR}/query-batch",
        json={"queries": [{"widget_id": "missing"}, {"widget_id": "plant-air-chart-so2"}, {"widget_id": "plant-air-chart-co"}]},
    )
    assert r.status_code == 200, r.text
    results = r.json()["results"]
    assert results[0]["status"] == 404
    assert "rows" in results[1] and "rows" in results[2]
    assert len(fake.queries) == 1
    assert client.post(f"/api/arcgis/dashboards/{PLANT_AIR}/query-batch", json={"queries": [{"widget_id": "x"}] * 301}).status_code == 422


def test_large_responses_are_compressed(client):
    from app.services.plant_dashboards import PLANT_WATER

    r = client.get(f"/api/arcgis/dashboards/{PLANT_WATER}", headers={"Accept-Encoding": "gzip"})
    assert r.headers["content-encoding"] == "gzip"
    assert r.json()["id"] == PLANT_WATER


def _env_dashboard():
    """ArcGIS-ийн хэлбэртэй жижиг dashboard: нэг өгөгдлийн давхарга, өөр нэртэй байршилтай газрын зураг."""
    src = {"type": "layerDataSource", "itemId": "x", "layerId": "data"}

    def ds(*group, stat="pH"):
        return [{"name": "main", "dataSource": src, "groupByFields": list(group), "statisticDefinitions": [{"onStatisticField": stat, "statisticType": "avg", "outStatisticFieldName": "A"}]}]

    place_to_map = {
        "targetId": "map#points",
        "by": "whereClause",
        "fieldMap": [{"sourceName": "Сорьцын_нэр", "targetName": "Байршил"}],
    }
    month_to_map = {"targetId": "map#points", "by": "whereClause"}
    events = lambda *targets: [{"type": "selectionChanged", "actions": [{"type": "filter", "targets": list(targets)}]}]
    return {
        "id": "d",
        "header": {
            "selectors": [
                {"id": "sel-place", "type": "categorySelectorWidget", "label": "БАЙРШЛААР ШҮҮХ", "datasets": ds("Сорьцын_нэр"), "events": events(place_to_map)},
                {"id": "sel-month", "type": "categorySelectorWidget", "label": "САРААР ШҮҮХ", "datasets": ds("Сар"), "events": events(month_to_map)},
            ]
        },
        "layout": {"type": "stackLayoutElement", "id": "root", "elements": []},
        "widgets": [
            {"id": "card", "type": "indicatorWidget", "datasets": ds()},
            {"id": "chart", "type": "serialChartWidget", "categoryType": "groupByValues", "datasets": ds("Сар"), "chartConfig": {"axes": []}},
            {"id": "pie", "type": "pieChartWidget", "categoryType": "groupByValues", "datasets": ds("Чиглэл")},
            {"id": "map", "type": "mapWidget", "itemId": "x"},
        ],
    }


def _targets(widget):
    return {t["targetId"]: t for ev in widget.get("events") or [] for a in ev["actions"] for t in a["targets"]}


def test_link_all_connects_every_widget():
    from app.services.env_extras import link_all

    dash = _env_dashboard()
    link_all(dash)
    by = {w["id"]: w for w in [*dash["widgets"], *dash["header"]["selectors"]]}
    # Сонгогч, график, дугуй бүр бусдыгаа, сонгогчдыг ч шүүнэ. Өөрийгөө шүүхгүй
    for src, others in (("sel-month", {"sel-place", "card", "chart", "pie"}), ("chart", {"sel-place", "sel-month", "card", "pie"}), ("pie", {"sel-place", "sel-month", "card", "chart"})):
        assert {t.split("#")[0] for t in _targets(by[src])} >= others
        assert f"{src}#main" not in _targets(by[src])
    # Карт дээр сонгох боломжгүй
    assert "events" not in by["card"]
    # Газрын зураг зөвхөн мэдэгдэж буй талбараар: Сар нь давхаргад бий, Чиглэл нь мэдэгдээгүй
    assert "map#points" in _targets(by["chart"])
    assert "map#points" not in _targets(by["pie"])
    assert _targets(by["sel-place"])["map#points"]["fieldMap"] == [{"sourceName": "Сорьцын_нэр", "targetName": "Байршил"}]


def test_map_click_filters_by_place_with_the_layers_own_field():
    from app.services.env_extras import link_all

    dash = _env_dashboard()
    link_all(dash)
    m = next(w for w in dash["widgets"] if w["id"] == "map")
    assert m["clickFields"] == {"points": "Байршил"}
    targets = _targets(m)
    assert {t.split("#")[0] for t in targets} == {"sel-place", "sel-month", "card", "chart", "pie"}
    assert targets["chart#main"]["fieldMap"] == [{"sourceName": "Байршил", "targetName": "Сорьцын_нэр"}]


def test_add_guides_keeps_two_standards_with_same_value_and_skips_duplicates():
    from app.services.env_extras import add_guides, guide

    w = {"chartConfig": {"axes": [{"valueFormat": {"type": "category"}}, {"valueFormat": {"type": "number"}, "guides": [guide(1, "MNS A")]}]}}
    add_guides(w, [guide(1, "MNS A"), guide(1, "MNS B"), guide(2, "MNS B")])
    guides = w["chartConfig"]["axes"][1]["guides"]
    assert [(g["start"], g["label"]["text"]) for g in guides] == [(1, "MNS A"), (1, "MNS B"), (2, "MNS B")]
    assert "guides" not in w["chartConfig"]["axes"][0]


def test_soil_charts_are_stacked_with_a_value_in_each_segment():
    """ArcGIS шиг давхарласан, хэсэг бүр утгатай, байршил бүр бүх графикт нэг өнгөтэй."""
    from app.services.env_extras import AIR, SOIL, SOIL_GUIDES, SOIL_PLACES, SOIL_STANDARD
    from app.services.dashboard_extras import apply

    src = {"layerId": "data"}
    chart = lambda wid, stat="avg": {"id": wid, "type": "serialChartWidget", "categoryType": "groupByValues", "splitBy": {"fieldName": "Сорьцын_нэр"}, "chartConfig": {"stackedType": "stacked"}, "datasets": [{"name": "main", "dataSource": src, "groupByFields": ["Он", "Сорьцын_нэр"], "statisticDefinitions": [{"statisticType": stat, "onStatisticField": "x", "outStatisticFieldName": "v"}]}]}
    item = lambda wid: {"type": "itemLayoutElement", "id": wid}
    keys = [f"{k}-x" for k in SOIL_GUIDES]
    widgets = [*(chart(k) for k in keys), chart("sum-chart", "sum"), {"id": "card", "type": "indicatorWidget"}, {"id": "map", "type": "mapWidget"}]
    layout = {"type": "stackLayoutElement", "id": "root", "elements": [
        {"type": "groupLayoutElement", "id": "cards", "elements": [item("card")]},
        {"type": "stackLayoutElement", "id": "mid", "elements": [item("map")]},
        {"type": "stackLayoutElement", "id": "right", "elements": [{"type": "tabsLayoutElement", "id": "t", "elements": [*(item(k) for k in keys), item("sum-chart")]}]},
    ]}
    by = {w["id"][:8]: w for w in apply({"id": SOIL, "header": {"selectors": []}, "layout": layout, "widgets": widgets})["widgets"]}
    cu = by["d57bf114"]["chartConfig"]
    assert cu["stackedType"] == "stacked" and cu["segmentLabels"] is True
    assert cu["splitColors"] == SOIL_PLACES and cu["splitOrder"] == list(SOIL_PLACES)
    assert [(g["start"], g["label"]["text"]) for a in cu["axes"] for g in a["guides"]] == [(100, SOIL_STANDARD)]
    # Бусад самбарт дунджийг давхарлахгүй: температурын нийлбэр утгагүй
    air_chart = chart("4390a116-x")
    other = {"id": AIR, "header": {"selectors": []}, "layout": None, "widgets": [{**chart("temp"), "chartConfig": {"stackedType": "stacked", "series": []}}, {**air_chart, "chartConfig": {"series": [], "axes": []}}]}
    assert apply(other)["widgets"][0]["chartConfig"]["stackedType"] == "sideBySide"


def test_monitor_layout_puts_cards_on_top_and_keeps_tab_groups():
    from app.services.env_extras import monitor_layout

    item = lambda wid, **extra: {"type": "itemLayoutElement", "id": wid, **extra}
    types = {f"c{i}": "indicatorWidget" for i in range(5)} | {"wind": "indicatorWidget", "map": "mapWidget", "pie": "pieChartWidget", "a": "serialChartWidget", "b": "serialChartWidget"}
    dash = {
        "widgets": [{"id": k, "type": v} for k, v in types.items()],
        "layout": {"type": "stackLayoutElement", "id": "root", "elements": [
            {"type": "stackLayoutElement", "id": "left", "elements": [item(f"c{i}") for i in range(5)]},
            {"type": "stackLayoutElement", "id": "mid", "elements": [item("map"), {"type": "stackLayoutElement", "id": "w", "elements": [item("wind"), item("pie")]}]},
            {"type": "stackLayoutElement", "id": "right", "elements": [{"type": "tabsLayoutElement", "id": "t1", "elements": [item("a", tabName="A"), item("b", tabName="B")]}]},
        ]},
    }
    monitor_layout(dash)
    rows = dash["layout"]["elements"]
    assert [[i["id"] for i in r["elements"]] for r in rows[:2]] == [["c0", "c1", "c2"], ["c3", "c4", "wind"]]
    assert [(x["id"], x["type"], x["width"]) for x in rows[2]["elements"]] == [("map", "itemLayoutElement", 0.75), ("pie", "itemLayoutElement", 0.25)]
    tabs = rows[3]["elements"][0]
    assert tabs["type"] == "tabsLayoutElement" and [t["tabName"] for t in tabs["elements"]] == ["A", "B"]


def test_monitor_layout_loses_no_widget():
    """Таб биш график, жагсаалт, хоёр дахь дугуй ч шинэ байрлалд үлдэнэ. Танихгүй бүтэц хөндөгдөхгүй."""
    from app.services.env_extras import _leaves, monitor_layout

    item = lambda wid: {"type": "itemLayoutElement", "id": wid}
    types = {"c": "indicatorWidget", "wind": "indicatorWidget", "map": "mapWidget", "pie": "pieChartWidget", "pie2": "pieChartWidget", "list": "listWidget", "free": "serialChartWidget", "a": "serialChartWidget"}
    dash = {
        "widgets": [{"id": k, "type": v} for k, v in types.items()],
        "layout": {"type": "stackLayoutElement", "id": "root", "elements": [
            {"type": "stackLayoutElement", "id": "left", "elements": [item("c")]},
            {"type": "stackLayoutElement", "id": "mid", "elements": [item("map"), item("wind"), item("pie"), item("pie2"), item("list"), item("free")]},
            {"type": "tabsLayoutElement", "id": "t", "elements": [item("a")]},
        ]},
    }
    monitor_layout(dash)
    assert sorted(i["id"] for i in _leaves(dash["layout"])) == sorted(types)
    for no_map in ({"widgets": [{"id": "c", "type": "indicatorWidget"}], "layout": {"type": "stackLayoutElement", "id": "root", "elements": [{"type": "stackLayoutElement", "id": "l", "elements": [item("c")]}]}},):
        before = no_map["layout"]
        monitor_layout(no_map)
        assert no_map["layout"] is before


def test_link_all_reaches_other_layers_but_only_known_map_layers():
    """Өөр давхаргын виджетэд ижил нэрээр (талбаргүй бол сервер алгасна). Өөр webmap-ын ижил layerId нь нэг давхарга биш."""
    from app.services.env_extras import _layer_of, link_all

    src = lambda item_id, *group: [{"name": "main", "dataSource": {"itemId": item_id, "layerId": 0}, "groupByFields": list(group)}]
    dash = {
        "header": {"selectors": [{"id": "sel", "type": "categorySelectorWidget", "label": "Он", "datasets": src("web-a", "Он")}]},
        "widgets": [
            {"id": "same", "type": "serialChartWidget", "categoryType": "groupByValues", "datasets": src("web-a", "Сар")},
            {"id": "other", "type": "serialChartWidget", "categoryType": "groupByValues", "datasets": src("web-b", "Сар")},
            {"id": "map", "type": "mapWidget", "itemId": "web-a"},
        ],
    }
    # Газрын зураг мэдэгдсэн давхаргатай ч «Он» талбар нь мэдэгдээгүй
    dash["widgets"][0]["events"] = [{"type": "selectionChanged", "actions": [{"type": "filter", "targets": [{"targetId": "map#points", "by": "whereClause"}]}]}]
    link_all(dash)
    assert _layer_of(dash["widgets"][0]) != _layer_of(dash["widgets"][1])
    targets = {t["targetId"]: t for ev in dash["header"]["selectors"][0]["events"] for a in ev["actions"] for t in a["targets"]}
    assert "same#main" in targets and "other#main" in targets
    assert "fieldMap" not in targets["other#main"]
    assert "map#points" not in targets


def test_filter_on_field_missing_from_layer_is_skipped(fake_arcgis):
    """Өөр давхаргын виджетээс ирсэн, энэ давхаргад байхгүй талбарын шүүлтүүр ArcGIS-ийн алдаа үүсгэхгүй."""
    from app.services import arcgis

    fake = fake_arcgis()
    filters = [{"field": "Сар", "op": "in", "values": [1]}, {"field": "Байхгүй", "op": "in", "values": ["x"]}]
    result = arcgis.run_datasets([(_stat_ds("pH", "A"), filters, None)])[0]
    assert "rows" in result
    assert "Сар" in fake.queries[0]["where"] and "Байхгүй" not in fake.queries[0]["where"]


def test_sentence_case_keeps_formulas_units_and_abbreviations():
    from app.services.env_extras import sentence_case

    assert sentence_case("НИЙТ ТООСНЫ АГУУЛАМЖ, мг/м3") == "Нийт тоосны агууламж, мг/м3"
    assert sentence_case("ДЭГДЭЛТИЙН ТОО /ЖИЛ/") == "Дэгдэлтийн тоо /жил/"
    assert sentence_case('<p style="text-align:center;"><strong>МОДНЫ ТОО, ТӨРЛӨӨР</strong></p>') == '<p style="text-align:center;"><strong>Модны тоо, төрлөөр</strong></p>'
    assert sentence_case("АГААР t⁰C") == "Агаар t⁰C"
    for unchanged in ("ХҮ", "БХХ", "ТОО", "pH /дундаж/", "Cu мг/кг (дундаж)", "SO₄²⁻ /дундаж/"):
        assert sentence_case(unchanged) == unchanged


def _guides_of(widget):
    return sorted((g["start"], g["label"]["text"]) for a in widget["chartConfig"].get("axes") or [] for g in a.get("guides") or [])


def test_plant_water_guides_from_excel():
    """Хоёр стандарт тус бүр нэг утгатай бол 1 шугамтай. pH-д шугам зурахгүй."""
    from app.services import arcgis
    from app.services.plant_dashboards import PLANT_WATER

    by = {w["id"]: w for w in arcgis.dashboard(PLANT_WATER)["widgets"]}
    a, b = "MNS 4943:2015", "MNS 6148:2010"
    assert _guides_of(by["plant-water-chart-ph"]) == []
    assert _guides_of(by["plant-water-chart-cu"]) == [(1, a), (1, b)]
    assert _guides_of(by["plant-water-chart-mo"]) == [(0.04, b), (0.5, a)]
    assert _guides_of(by["plant-water-chart-so4"]) == [(500, b)]
    assert _guides_of(by["plant-water-chart-ec"]) == [(1000, a)]
    assert _guides_of(by["plant-water-chart-sio2"]) == []


def test_only_wind_direction_pies_show_full_legend():
    from app.services.env_extras import env_style
    from app.services.plant_dashboards import PLANT_AIR, PLANT_WATER, get

    pie = lambda wid, field: {"id": wid, "type": "pieChartWidget", "datasets": [{"groupByFields": [field]}]}
    dash = {"widgets": [pie("wind", "Салхины_чиглэл"), pie("tree", "модны_төрөл")], "layout": None}
    env_style(dash)
    assert dash["widgets"][0]["chartConfig"]["fullLegend"] is True
    assert "fullLegend" not in dash["widgets"][1].get("chartConfig", {})
    for plant in (PLANT_WATER, PLANT_AIR):
        assert next(w for w in get(plant)["widgets"] if w["type"] == "pieChartWidget")["chartConfig"]["fullLegend"] is True


def test_water_ph_chart_has_no_guides():
    """Хүрээлэн буй орчны усны pH-д стандартын шугам зурахгүй."""
    from app.services.dashboard_extras import apply
    from app.services.env_extras import WATER

    ph = {"id": "8a2ea68a-x", "type": "serialChartWidget", "chartConfig": {"axes": []}}
    layout = {"type": "stackLayoutElement", "id": "root", "elements": [{"type": "itemLayoutElement", "id": ph["id"]}]}
    dash = apply({"id": WATER, "header": {"selectors": []}, "layout": layout, "widgets": [ph]})
    assert dash["theme"] == "env"  # хувиргалт ажилласан, алдаанаас болж эх хувь буцаагүй
    assert _guides_of(dash["widgets"][0]) == []


def test_plant_map_filters_everything_else():
    from app.services import arcgis
    from app.services.plant_dashboards import PLANT_AIR

    dash = arcgis.dashboard(PLANT_AIR)
    m = next(w for w in dash["widgets"] if w["type"] == "mapWidget")
    assert m["clickFields"] == {"plant-air-layer": "Сорьцын_нэр"}
    others = {w["id"] for w in [*dash["widgets"], *dash["header"]["selectors"]] if w.get("datasets")}
    assert {t.split("#")[0] for t in _targets(m)} == others


def test_plant_filters_to_sql():
    """O₂-ийн 0 (хэмжээгүй) дунджид орохгүй, «-» чиглэл дугуйд орохгүй."""
    from app.services import arcgis
    from app.services.plant_dashboards import PLANT_AIR

    by_id = {w["id"]: w for w in arcgis.dashboard(PLANT_AIR)["widgets"]}
    assert arcgis.filter_to_sql(by_id["plant-air-ind-o2"]["datasets"][0]["filter"]) == "O_ > 0"
    assert arcgis.filter_to_sql(by_id["plant-air-chart-o2"]["datasets"][0]["filter"]) == "(Сар IS NOT NULL AND O_ > 0)"
    assert arcgis.filter_to_sql(by_id["plant-air-chart-dust"]["datasets"][0]["filter"]) == "(Сар IS NOT NULL)"
    assert arcgis.filter_to_sql(by_id["plant-air-direction"]["datasets"][0]["filter"]) == "(чиглэл IS NOT NULL AND чиглэл <> '-')"


def test_retired_group_moves_existing_rows(client):
    """Хуучин өгөгдлийн сан: «Хяналт шинжилгээ» дэх мөрүүд шинэ бүлэгт орж, өөр бүлгийн мөр хөндөгдөхгүй."""
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import ArcgisDashboard
    from app.seed import apply_groups

    with SessionLocal() as db:
        moved = db.scalar(select(ArcgisDashboard).where(ArcgisDashboard.title == "Ус"))
        moved.group, moved.sort_order = "Хяналт шинжилгээ", 99
        custom = db.scalar(select(ArcgisDashboard).where(ArcgisDashboard.title == "Хөрс"))
        custom.group = "Өөрөө зассан"
        db.commit()
        apply_groups(db)
        assert (moved.group, moved.sort_order) == ("Хүрээлэн буй орчин", 1)
        assert custom.group == "Өөрөө зассан"
        custom.group = "Хүрээлэн буй орчин"
        db.commit()


def test_added_row_in_retired_group_does_not_rerun_migration(client):
    """API-аар нэмсэн мөр шилжилтийг эхлүүлэхгүй: устгасан dashboard буцаж гарахгүй. Шилжилт явбал хамт шилжинэ."""
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import ArcgisDashboard, Department
    from app.seed import apply_groups
    from app.services.env_extras import WATER
    from app.services.plant_dashboards import PLANT_WATER

    with SessionLocal() as db:
        dep = db.scalar(select(Department).where(Department.code == "BOH"))
        extra = ArcgisDashboard(item_id="f" * 32, title="Нэмсэн", group="Хяналт шинжилгээ", sort_order=500)
        dep.dashboards.append(extra)
        db.delete(next(r for r in dep.dashboards if r.item_id == PLANT_WATER))
        db.commit()
        apply_groups(db)
        db.refresh(dep)
        assert (extra.group, extra.sort_order) == ("Хяналт шинжилгээ", 500)
        assert not any(r.item_id == PLANT_WATER for r in dep.dashboards)

        water = next(r for r in dep.dashboards if r.item_id == WATER)
        water.group = "Хяналт шинжилгээ"
        db.commit()
        apply_groups(db)
        db.commit()
        db.refresh(dep)
        assert water.group == extra.group == "Хүрээлэн буй орчин"
        assert any(r.item_id == PLANT_WATER for r in dep.dashboards)
        db.delete(extra)
        db.commit()


def test_remove_departments_keeps_what_people_added(client):
    """Хасагдсан хэлтсийн seed мөр л устна. Нэмсэн dashboard, холбоос нь буцаагдахгүй устгагдахгүй."""
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import ArcgisDashboard, Department
    from app.seed import REMOVED_DEPARTMENTS, remove_departments

    row = lambda item_id: ArcgisDashboard(item_id=item_id, title="T", group="G", sort_order=0)
    with SessionLocal() as db:
        db.add(Department(code="GHE", name="Зөвхөн seed", dashboards=[row(i) for i in REMOVED_DEPARTMENTS["GHE"]]))
        db.add(Department(code="NHT", name="Нэмсэн dashboard", dashboards=[row(REMOVED_DEPARTMENTS["NHT"][0]), row("a" * 32)]))
        db.add(Department(code="MEC", name="Холбоостой", links=[{"title": "x", "url": "https://example.test"}]))
        db.commit()
        remove_departments(db)
        left = db.scalars(select(Department).where(Department.code.in_(REMOVED_DEPARTMENTS))).all()
        assert {d.code for d in left} == {"NHT", "MEC"}
        assert len(next(d for d in left if d.code == "NHT").dashboards) == 2
        for d in left:
            db.delete(d)
        db.commit()


def test_tsul_binary_assets_are_not_gzipped():
    """Хоёртын файлыг шахахгүй, API, JSON шахагдсаар."""
    from fastapi.testclient import TestClient
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.responses import Response
    from starlette.routing import Route

    from app.main import AppGZip

    app = Starlette(routes=[Route("/{path:path}", lambda r: Response(b"x" * 5000))], middleware=[Middleware(AppGZip, minimum_size=1024)])
    web = TestClient(app)
    encoding = lambda path: web.get(path, headers={"Accept-Encoding": "gzip"}).headers.get("content-encoding")
    assert encoding("/data/pit_01.glb") is None and encoding("/data/blocks_03.bin") is None
    assert encoding("/data/excel.json") == "gzip" and encoding("/api/x") == "gzip"


def test_env_maps_use_firefly_symbols_by_theme():
    """Цагаан тоос цэнхэр, ус цэнхэр, хөрс нил ягаан, агаар цагаан. Бусад самбарын зураг хэвээр."""
    from app.services.dashboard_extras import apply
    from app.services.env_extras import AIR, DUST, GROVE, RECLAMATION, SOIL, TREES, WATER
    from app.services.plant_dashboards import PLANT_AIR, PLANT_WATER, get

    def firefly(item_id):
        dash = {"id": item_id, "header": {"selectors": []}, "layout": None, "widgets": [{"id": "m", "type": "mapWidget"}, {"id": "c", "type": "indicatorWidget"}]}
        out = apply(dash)["widgets"]
        assert "firefly" not in out[1]
        return out[0].get("firefly")

    assert [firefly(i) for i in (DUST, WATER, SOIL, AIR)] == ["cyan", "water", "purple", "white"]
    assert [firefly(i) for i in (RECLAMATION, GROVE, TREES)] == [None, None, None]
    plant = lambda i: next(w for w in get(i)["widgets"] if w["type"] == "mapWidget")["firefly"]
    assert (plant(PLANT_WATER), plant(PLANT_AIR)) == ("water", "white")
    # Шошгын хамгаалалт бүх Байгаль орчны зурагт, Firefly-гүй самбарт ч
    grove = {"id": GROVE, "header": {"selectors": []}, "layout": None, "widgets": [{"id": "m", "type": "mapWidget"}]}
    assert apply(grove)["widgets"][0]["labelsInside"] is True


def test_env_dashboards_tell_the_frontend_their_links_are_complete():
    """Газрын зураг шууд ArcGIS рүү асуудаг: frontend байхгүй талбараар холбоос таамаглахгүй."""
    from app.services.env_extras import link_all

    dash = {"widgets": [{"id": "map", "type": "mapWidget"}], "header": {"selectors": []}}
    link_all(dash)
    assert dash["linksComplete"] is True


def test_filter_to_sql():
    from app.services.arcgis import filter_to_sql, runtime_filter_to_sql

    node = {
        "type": "filterGroup",
        "condition": "OR",
        "rules": [
            {"type": "filterRule", "field": {"name": "Он", "type": "integer"}, "operator": "not_equal", "constraint": {"type": "value", "value": 0}},
            {"type": "filterRule", "field": {"name": "Нэр", "type": "string"}, "operator": "is_in", "constraint": {"values": ["А", "Б'В"]}},
        ],
    }
    assert filter_to_sql(node) == "(Он <> 0 OR Нэр IN ('А', 'Б''В'))"
    types = {"dugaar": "esriFieldTypeString", "ognoo": "esriFieldTypeDate"}
    assert runtime_filter_to_sql({"field": "dugaar", "op": "in", "values": ["1", None]}, types) == "(dugaar IN ('1') OR dugaar IS NULL)"
    assert runtime_filter_to_sql({"field": "ognoo", "op": "between", "values": [None, "2025-01-01T00:00:00"]}, types).startswith("ognoo <= ")
    # Нөөц үг нэртэй талбар хашилтлагдсан ч төрлөө алдахгүй
    reserved = runtime_filter_to_sql({"field": "end", "op": "between", "values": ["2020-01-01T00:00:00", None]}, {"end": "esriFieldTypeDate"})
    assert reserved == "\"end\" >= timestamp '2020-01-01 00:00:00'"
    with pytest.raises(Exception):
        runtime_filter_to_sql({"field": "x; DROP", "op": "in", "values": [1]}, types)


def test_dashboard_layout_roundtrip(client):
    item = "ef613a0502c74faf9ed7ed95412dd4e0"
    assert client.get(f"/api/arcgis/dashboards/{item}/layout").json()["sizes"] == {}
    r = client.put(f"/api/arcgis/dashboards/{item}/layout", json={"sizes": {"root": [0.75, 0.25]}})
    assert r.status_code == 200 and r.json()["updated_by"] == "Тест"
    client.put(f"/api/arcgis/dashboards/{item}/layout", json={"sizes": {"top": [0.12, 0.755, 0.125]}})
    assert client.get(f"/api/arcgis/dashboards/{item}/layout").json()["sizes"] == {"root": [0.75, 0.25], "top": [0.12, 0.755, 0.125]}
    assert client.put(f"/api/arcgis/dashboards/{item}/layout", json={"sizes": {"x": [-1]}}).status_code == 400
    client.delete(f"/api/arcgis/dashboards/{item}/layout")
    out = client.get(f"/api/arcgis/dashboards/{item}/layout").json()
    assert out["sizes"] == {} and out["has_backup"]
    # Андуурч устгасныг буцаана
    assert client.post(f"/api/arcgis/dashboards/{item}/layout/undo").json()["sizes"]["root"] == [0.75, 0.25]
    client.delete(f"/api/arcgis/dashboards/{item}/layout")


def test_dashboard_layout_tree(client):
    item = "7b367c183a764b76a033d3df731a8d2f"
    tree = {"type": "stackLayoutElement", "id": "r", "orientation": "row", "elements": [{"type": "itemLayoutElement", "id": "w1"}]}
    assert client.put(f"/api/arcgis/dashboards/{item}/layout", json={"tree": tree}).json()["tree"] == tree
    assert client.put(f"/api/arcgis/dashboards/{item}/layout", json={"tree": {"type": "script", "id": "x"}}).status_code == 400
    client.delete(f"/api/arcgis/dashboards/{item}/layout")


def test_contains_filter():
    from app.services.arcgis import runtime_filter_to_sql

    assert runtime_filter_to_sql({"field": "ners", "op": "contains", "values": ["Болд", "O'Neil"]}, {}) == "(ners LIKE '%Болд%' OR ners LIKE '%O''Neil%')"
