from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import auth
from ..database import get_db

router = APIRouter(prefix="/api/auth", tags=["Нэвтрэлт"])


class LoginIn(BaseModel):
    username: str
    password: str


def _origin(request: Request) -> str:
    """ArcGIS token-ыг холбох referer — браузерийн хаяг (esri-leaflet мөн энэ хаягаас хандана)."""
    return request.headers.get("origin") or f"{request.url.scheme}://{request.url.netloc}"


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    try:
        sess = await run_in_threadpool(auth.login, db, body.username, body.password, _origin(request))
    except auth.AuthError as e:
        raise HTTPException(e.code, str(e))
    response.set_cookie(
        auth.COOKIE,
        sess.id,
        httponly=True,
        samesite="lax",
        secure=auth.COOKIE_SECURE,
        max_age=auth.SESSION_HOURS * 3600,
        path="/",
    )
    return auth.user_out(sess)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth.logout(db, request.cookies.get(auth.COOKIE))
    response.delete_cookie(auth.COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    # Middleware сессийг шалгаад request.state.user-д тавьсан
    return auth.user_out(request.state.user)
