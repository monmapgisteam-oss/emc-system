import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings:
    # PostgreSQL руу шилжихдээ: EMC_DATABASE_URL=postgresql+psycopg://user:pass@host/emc
    database_url: str = os.getenv("EMC_DATABASE_URL", f"sqlite:///{BASE_DIR / 'emc.db'}")
    cors_origins: list[str] = os.getenv(
        "EMC_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")


settings = Settings()
