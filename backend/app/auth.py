"""Нэвтрэлт: ArcGIS Online-ы EMC байгууллагын эрх, эсвэл дотоод хэрэглэгч.

Сесс нь өгөгдлийн санд хадгалагдаж, браузерт зөвхөн санамсаргүй ID (HttpOnly cookie) очно.
"""

import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import User, UserSession
from .services import arcgis

COOKIE = "emc_session"
SESSION_HOURS = 12
COOKIE_SECURE = os.getenv("EMC_COOKIE_SECURE", "1" if os.getenv("VERCEL") else "0") == "1"  # HTTPS дээр 1

# Нэг нэрээр 10 минутад 5-аас олон буруу оролдлого хийвэл түр хаана
MAX_FAILS, FAIL_WINDOW = 5, 600
_fails: dict[str, deque] = defaultdict(deque)


class AuthError(Exception):
    def __init__(self, message: str, code: int = 401):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- нууц үг


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 260_000).hex()
    return f"pbkdf2_sha256$260000${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, digest = stored.split("$")
    except ValueError:
        return False
    test = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds)).hex()
    return hmac.compare_digest(test, digest)


# ---------------------------------------------------------------- оролдлогын хязгаар


def _check_throttle(username: str):
    q = _fails[username.lower()]
    now = time.time()
    while q and now - q[0] > FAIL_WINDOW:
        q.popleft()
    if len(q) >= MAX_FAILS:
        raise AuthError("Олон удаа буруу оролдлоо. 10 минутын дараа дахин оролдоно уу.", 429)


def _record_fail(username: str):
    _fails[username.lower()].append(time.time())


# ---------------------------------------------------------------- нэвтрэх


def login(db: Session, username: str, password: str, referer: str) -> UserSession:
    username = username.strip()
    if not username or not password:
        raise AuthError("Нэвтрэх нэр, нууц үгээ оруулна уу", 400)
    _check_throttle(username)

    local = db.scalar(select(User).where(User.username == username))
    if local:
        if not (local.active and verify_password(password, local.password_hash)):
            _record_fail(username)
            raise AuthError("Нэвтрэх нэр эсвэл нууц үг буруу байна")
        sess = UserSession(
            id=secrets.token_urlsafe(32),
            username=local.username,
            full_name=local.full_name,
            source="local",
            role=local.role,
            expires_at=datetime.now() + timedelta(hours=SESSION_HOURS),
        )
    else:
        try:
            res = arcgis.generate_token(username, password, referer, minutes=SESSION_HOURS * 60)
        except arcgis.ArcGISError as e:
            if e.code == 401:
                _record_fail(username)
            raise AuthError(str(e), e.code or 401)
        me = res["self"]
        # Зөвхөн Эрдэнэт үйлдвэрийн ArcGIS байгууллагын хэрэглэгчийг нэвтрүүлнэ
        if me.get("orgId") != arcgis.EMC_ORG_ID:
            raise AuthError("Энэ эрх Эрдэнэт үйлдвэрийн (EMC) ArcGIS байгууллагад хамаарахгүй байна", 403)
        sess = UserSession(
            id=secrets.token_urlsafe(32),
            username=me.get("username") or username,
            full_name=me.get("fullName"),
            source="arcgis",
            role="admin" if me.get("role") == "org_admin" else "user",
            arcgis_token=res["token"],
            arcgis_referer=referer,
            expires_at=min(datetime.fromtimestamp(res["expires"]), datetime.now() + timedelta(hours=SESSION_HOURS)),
        )

    _fails.pop(username.lower(), None)
    db.execute(delete(UserSession).where(UserSession.expires_at < datetime.now()))
    db.add(sess)
    db.commit()
    return sess


def get_session(db: Session, session_id: str | None) -> UserSession | None:
    if not session_id:
        return None
    sess = db.get(UserSession, session_id)
    if not sess or sess.expires_at < datetime.now():
        return None
    return sess


def logout(db: Session, session_id: str | None):
    if session_id:
        db.execute(delete(UserSession).where(UserSession.id == session_id))
        db.commit()


def user_out(sess: UserSession) -> dict:
    return {
        "username": sess.username,
        "full_name": sess.full_name or sess.username,
        "source": sess.source,
        "role": sess.role,
        "expires_at": sess.expires_at.isoformat(),
    }
