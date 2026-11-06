import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _database_url() -> str:
    """EMC_DATABASE_URL, эс бөгөөс Vercel-ийн Postgres нэмэлтийн хувьсагч, эс бөгөөс локал SQLite."""
    url = os.getenv("EMC_DATABASE_URL") or os.getenv("POSTGRES_URL") or os.getenv("DATABASE_URL")
    if not url:
        return f"sqlite:///{BASE_DIR / 'emc.db'}"
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


class Settings:
    database_url: str = _database_url()
    cors_origins: list[str] = os.getenv(
        "EMC_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")


settings = Settings()
