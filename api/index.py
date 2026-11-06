"""Vercel-ийн Python функц: FastAPI апп. Статик frontend-ийг Vercel шууд үйлчилнэ (vercel.json)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app  # noqa: E402, F401
