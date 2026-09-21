"""Shared FastAPI dependencies: current user, role checks, branch scoping."""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    user_id = decode_access_token(token)
    user = db.get(User, user_id) if user_id else None
    if user is None or not user.is_active:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid or expired session. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_roles(*roles: str):
    """Dependency factory: `Depends(require_roles("admin", "manager"))`."""

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to do this.")
        return user

    return checker


def scope_branch(user: User, requested: int | None, *, required: bool = False) -> int | None:
    """
    Decide which branch a request may touch.

    * Admins may pass any branch_id, or None meaning "all locations".
    * Managers and cashiers are LOCKED to their own branch. Asking for another
      branch is an error; leaving it empty silently means "my branch".
    """
    if user.role == "admin":
        if required and requested is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "branch_id is required")
        return requested
    if user.branch_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account is not assigned to a branch.")
    if requested is not None and requested != user.branch_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only access your own branch.")
    return user.branch_id
