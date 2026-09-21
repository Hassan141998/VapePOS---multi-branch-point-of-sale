from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import TokenOut, UserOut
from app.security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/login", response_model=TokenOut)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Sign in with username + password. Returns a JWT and the user profile."""
    user = db.scalar(select(User).where(func.lower(User.username) == form.username.lower()))
    if not user or not user.is_active or not verify_password(form.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password.")
    if user.role != "admin":
        # Cashier / manager locking: they must belong to an active branch.
        if user.branch is None or not user.branch.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your branch is inactive or not assigned. Contact an admin.")
    return TokenOut(access_token=create_access_token(user.id, user.role), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
