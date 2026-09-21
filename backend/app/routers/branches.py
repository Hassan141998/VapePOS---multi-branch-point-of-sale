from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Branch, User
from app.realtime import manager
from app.schemas import BranchIn, BranchOut, BranchUpdate
from app.services.inventory import create_rows_for_new_branch

router = APIRouter(prefix="/branches", tags=["Branches"])


@router.get("", response_model=list[BranchOut])
def list_branches(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """All staff can list branches (managers need them as transfer destinations)."""
    stmt = select(Branch).order_by(Branch.id)
    if not (include_inactive and user.role == "admin"):
        stmt = stmt.where(Branch.is_active.is_(True))
    return db.scalars(stmt).all()


@router.get("/{branch_id}", response_model=BranchOut)
def get_branch(branch_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    branch = db.get(Branch, branch_id)
    if not branch:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")
    return branch


def _ensure_unique(db: Session, name: str | None, code: str | None, exclude_id: int | None = None):
    for column, value, label in ((Branch.name, name, "name"), (Branch.code, code, "code")):
        if value is None:
            continue
        stmt = select(Branch.id).where(func.lower(column) == value.lower())
        if exclude_id:
            stmt = stmt.where(Branch.id != exclude_id)
        if db.scalar(stmt):
            raise HTTPException(status.HTTP_409_CONFLICT, f"A branch with this {label} already exists.")


@router.post("", response_model=BranchOut, status_code=status.HTTP_201_CREATED)
def create_branch(
    body: BranchIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin")),
):
    _ensure_unique(db, body.name, body.code)
    branch = Branch(**body.model_dump(), )
    branch.code = branch.code.upper()
    db.add(branch)
    db.flush()
    create_rows_for_new_branch(db, branch)  # zero-stock rows for every product
    db.commit()
    background.add_task(manager.publish, "branch.updated", [], {"branch_id": branch.id})
    return branch


@router.put("/{branch_id}", response_model=BranchOut)
def update_branch(
    branch_id: int,
    body: BranchUpdate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin")),
):
    branch = db.get(Branch, branch_id)
    if not branch:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")
    data = body.model_dump(exclude_unset=True)
    _ensure_unique(db, data.get("name"), data.get("code"), exclude_id=branch_id)
    if "code" in data and data["code"]:
        data["code"] = data["code"].upper()
    for key, value in data.items():
        setattr(branch, key, value)
    db.commit()
    background.add_task(manager.publish, "branch.updated", [], {"branch_id": branch.id})
    return branch


@router.delete("/{branch_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_branch(
    branch_id: int,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin")),
):
    """Branches with history are never hard-deleted; they are deactivated."""
    branch = db.get(Branch, branch_id)
    if not branch:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")
    branch.is_active = False
    db.commit()
    background.add_task(manager.publish, "branch.updated", [], {"branch_id": branch.id})
