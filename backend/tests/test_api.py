import io
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
