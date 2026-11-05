"""Дотоод хэрэглэгч удирдах (ArcGIS Online ажиллахгүй үед нэвтрэх нөөц эрх).

    python -m app.users add admin --name "Систем админ" --admin
    python -m app.users list
    python -m app.users passwd admin
    python -m app.users remove admin

Үндсэн хэрэглэгчид ArcGIS Online-ы EMC эрхээрээ нэвтэрдэг тул энд бүртгэх шаардлагагүй.
"""

import argparse
import getpass
import sys

from sqlalchemy import select

from .auth import hash_password
from .database import Base, SessionLocal, engine
from .models import User


def _ask_password() -> str:
    pwd = getpass.getpass("Нууц үг: ")
    if len(pwd) < 8:
        sys.exit("Нууц үг дор хаяж 8 тэмдэгт байна")
    if pwd != getpass.getpass("Дахин оруулна уу: "):
        sys.exit("Нууц үг таарсангүй")
    return pwd


def main():
    ap = argparse.ArgumentParser(prog="python -m app.users")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add")
    a.add_argument("username")
    a.add_argument("--name")
    a.add_argument("--admin", action="store_true")
    sub.add_parser("list")
    p = sub.add_parser("passwd")
    p.add_argument("username")
    r = sub.add_parser("remove")
    r.add_argument("username")
    args = ap.parse_args()

    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if args.cmd == "list":
            for u in db.scalars(select(User).order_by(User.username)):
                print(f"{u.username:20} {u.role:6} {'идэвхтэй' if u.active else 'хаалттай':9} {u.full_name or ''}")
            return
        user = db.scalar(select(User).where(User.username == args.username))
        if args.cmd == "add":
            if user:
                sys.exit("Ийм нэртэй хэрэглэгч бүртгэлтэй байна")
            db.add(User(username=args.username, full_name=args.name, role="admin" if args.admin else "user", password_hash=hash_password(_ask_password())))
        elif not user:
            sys.exit("Хэрэглэгч олдсонгүй")
        elif args.cmd == "passwd":
            user.password_hash = hash_password(_ask_password())
        elif args.cmd == "remove":
            db.delete(user)
        db.commit()
        print("Хадгаллаа")


if __name__ == "__main__":
    main()
