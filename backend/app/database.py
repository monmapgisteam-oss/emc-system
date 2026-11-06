import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings

if settings.database_url.startswith("sqlite"):
    connect_args: dict = {"check_same_thread": False}
else:
    # Холболтын pooler-ийн ард prepared statement ажиллахгүй
    connect_args = {"prepare_threshold": None}
# Serverless функц бүр өөрийн pool барьвал холболт дуусна
pool = {"poolclass": NullPool} if os.getenv("VERCEL") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, **pool)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
