from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

from . import auth
from .config import settings
from .database import Base, SessionLocal, engine
from .routers import analytics, dashboards, datasets, departments, displacement
from .routers import auth as auth_router
from .seed import seed_departments, apply_sections, remove_departments
from .services import arcgis

FRONTEND_DIST = (Path(__file__).resolve().parents[2] / "frontend" / "dist").resolve()
# Цулын шилжилтийн 3D апп (uuliin_tsul): файлууд нь үндэс замаас (/data, /_next) уншигдана
TSUL_OUT = (Path(__file__).resolve().parents[2] / "uuliin_tsul" / "out").resolve()
TSUL_PATHS = ("/uuliin-tsul", "/_next/", "/data/", "/logo.svg")

# Нэвтрэлгүйгээр хандаж болох API
PUBLIC_API = {"/api/health", "/api/auth/login", "/api/auth/logout"}


def _migrate():
    """Хуучин өгөгдлийн санд шинэ баганыг нэмнэ (create_all нь байгаа хүснэгтийг өөрчилдөггүй)."""
    cols = {c["name"] for c in inspect(engine).get_columns("dashboard_layouts")}
    for col in ("tree", "backup", "prefs"):
        if col not in cols:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE dashboard_layouts ADD COLUMN {col} JSON"))
    if "section" not in {c["name"] for c in inspect(engine).get_columns("arcgis_dashboards")}:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE arcgis_dashboards ADD COLUMN section VARCHAR(100)"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    _migrate()
    with SessionLocal() as db:
        seed_departments(db)
        apply_sections(db)
        remove_departments(db)
    yield


app = FastAPI(title="Эрдэнэт Үйлдвэр — Нэгдсэн систем", version="0.2.0", lifespan=lifespan)


@app.middleware("http")
async def require_login(request: Request, call_next):
    """/api/* болон цулын шилжилтийн аппын бүх хүсэлтэд нэвтэрсэн сесс шаардана. ArcGIS асуулгад хэрэглэгчийн өөрийн token-ыг хэрэглэнэ."""
    path = request.url.path
    protected = path.startswith("/api/") or path.startswith(TSUL_PATHS)
    if not protected or path in PUBLIC_API or request.method == "OPTIONS":
        return await call_next(request)
    with SessionLocal() as db:
        sess = auth.get_session(db, request.cookies.get(auth.COOKIE))
        if sess:
            db.expunge(sess)
    if not sess:
        return JSONResponse({"detail": "Нэвтрэх шаардлагатай"}, status_code=401)
    request.state.user = sess
    arcgis.set_user(sess.username, sess.arcgis_token, sess.arcgis_referer)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"], allow_credentials=True
)

for r in (auth_router, departments, datasets, dashboards, displacement, analytics):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    return {"ok": True}


if TSUL_OUT.exists():
    app.mount("/_next", StaticFiles(directory=TSUL_OUT / "_next"), name="tsul-next")
    app.mount("/data", StaticFiles(directory=TSUL_OUT / "data"), name="tsul-data")
    app.mount("/uuliin-tsul", StaticFiles(directory=TSUL_OUT, html=True), name="tsul")

    @app.get("/logo.svg", include_in_schema=False)
    def tsul_logo():
        return FileResponse(TSUL_OUT / "logo.svg")


# `npm run build` хийсэн бол frontend-ийг энэ серверээс шууд үйлчилнэ
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        file = (FRONTEND_DIST / path).resolve()
        # dist хавтсаас гадуурх файл руу (../) хандахыг хориглоно
        if path and file.is_file() and file.is_relative_to(FRONTEND_DIST):
            return FileResponse(file)
        # index.html-ийг кэшлэхгүй — шинэ build гарахад хөтөч хуучин хувилбарыг харуулахгүй
        return FileResponse(FRONTEND_DIST / "index.html", headers={"Cache-Control": "no-cache"})
