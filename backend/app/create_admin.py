"""
Create an administrator account (use this on a real system instead of the demo seed).

    python -m app.create_admin

Asks for a username and password. For scripts, set ADMIN_USERNAME and ADMIN_PASSWORD
(and optionally ADMIN_FULL_NAME) as environment variables and nothing is asked.
"""
import getpass
import os
import sys

from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import User
from app.security import hash_password


def main() -> None:
    username = os.environ.get("ADMIN_USERNAME") or input("Admin username: ").strip()
    full_name = os.environ.get("ADMIN_FULL_NAME") or (input("Full name (optional): ").strip() if not os.environ.get("ADMIN_USERNAME") else "")
    password = os.environ.get("ADMIN_PASSWORD")
    if not password:
        password = getpass.getpass("Password (8-72 characters): ")
        if password != getpass.getpass("Repeat password: "):
            sys.exit("The passwords do not match.")
    if len(username) < 3:
        sys.exit("The username needs at least 3 characters.")
    if not 8 <= len(password.encode("utf-8")) <= 72:
        sys.exit("The password must be 8-72 characters long.")

    with SessionLocal() as db:
        if db.scalar(select(User.id).where(func.lower(User.username) == username.lower())):
            sys.exit(f"The username '{username}' already exists.")
        db.add(User(username=username, full_name=full_name, role="admin", password_hash=hash_password(password)))
        db.commit()
    print(f"Admin '{username}' created. You can sign in now.")


if __name__ == "__main__":
    main()
