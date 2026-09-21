from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles
from app.models import Branch, User
from app.schemas import UserCreate, UserOut, UserUpdate
from app.security import hash_password

router = APIRouter(prefix="/users", tags=["Users"], dependencies=[Depends(require_roles("admin"))])


def _check_branch(db: Session, role: str, branch_id: int | None):
    if branch_id is not None and db.get(Branch, branch_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Branch does not exist")
    if role != "admin" and branch_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Managers and cashiers must be assigned to a branch")


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.role, User.username)).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    if db.scalar(select(User.id).where(func.lower(User.username) == body.username.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")
    _check_branch(db, body.role, body.branch_id)
    user = User(
        username=body.username,
        full_name=body.full_name,
        password_hash=hash_password(body.password),
        role=body.role,
        branch_id=body.branch_id,
        is_active=body.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_roles("admin"))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    data = body.model_dump(exclude_unset=True)
    new_role = data.get("role", user.role)
    new_branch = data["branch_id"] if "branch_id" in data else user.branch_id
    _check_branch(db, new_role, new_branch)
    if user.id == admin.id and (data.get("is_active") is False or new_role != "admin"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate or demote your own account.")
    if "password" in data:
        user.password_hash = hash_password(data.pop("password"))
    for key, value in data.items():
        setattr(user, key, value)
    user.role, user.branch_id = new_role, new_branch
    db.commit()
    db.refresh(user)
    return user
