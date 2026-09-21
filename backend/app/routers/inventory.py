from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session, contains_eager

from app.database import get_db
from app.deps import get_current_user, require_roles, scope_branch
from app.models import Branch, BranchInventory, Product, StockMovement, User
from app.realtime import manager
from app.schemas import InventoryRowOut, ProductPublic, StockAdjust, ThresholdUpdate
from app.services.inventory import lock_inventory_rows, record_movement

router = APIRouter(prefix="/inventory", tags=["Inventory"])


def to_row(inv: BranchInventory) -> InventoryRowOut:
    return InventoryRowOut(
        product=ProductPublic.model_validate(inv.product),
        branch_id=inv.branch_id,
        branch_name=inv.branch.name,
        stock_quantity=inv.stock_quantity,
        min_threshold=inv.min_threshold,
        is_low=inv.stock_quantity <= inv.min_threshold,
    )


@router.get("", response_model=list[InventoryRowOut])
def list_inventory(
    branch_id: int | None = Query(None, description="Omit (admin only) for all branches"),
    search: str | None = None,
    category: str | None = None,
    low_stock_only: bool = False,
    limit: int = Query(2000, ge=1, le=5000),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    scoped = scope_branch(user, branch_id)
    stmt = (
        select(BranchInventory)
        .join(Product, BranchInventory.product_id == Product.id)
        .join(Branch, BranchInventory.branch_id == Branch.id)
        .options(contains_eager(BranchInventory.product), contains_eager(BranchInventory.branch))
        .where(Product.is_active.is_(True), Branch.is_active.is_(True))
        .order_by(Product.name, Branch.id)
    )
    if scoped is not None:
        stmt = stmt.where(BranchInventory.branch_id == scoped)
    if category:
        stmt = stmt.where(Product.category == category)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            Product.name.ilike(like) | Product.barcode.ilike(like) | Product.flavor.ilike(like) | Product.brand.ilike(like)
        )
    if low_stock_only:
        stmt = stmt.where(BranchInventory.stock_quantity <= BranchInventory.min_threshold)
    return [to_row(r) for r in db.scalars(stmt.limit(limit)).unique().all()]


@router.put("/{branch_id}/{product_id}/threshold", response_model=InventoryRowOut)
def set_threshold(
    branch_id: int,
    product_id: int,
    body: ThresholdUpdate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "manager")),
):
    scope_branch(user, branch_id, required=True)
    rows = lock_inventory_rows(db, [(product_id, branch_id)])
    inv = rows[(product_id, branch_id)]
    inv.min_threshold = body.min_threshold
    db.commit()
    background.add_task(manager.publish, "inventory.changed", [branch_id], {"product_ids": [product_id]})
    return to_row(inv)


@router.post("/adjust", response_model=InventoryRowOut)
def adjust_stock(
    body: StockAdjust,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "manager")),
):
    """Manual stock correction (stock take, damaged goods, supplier delivery)."""
    branch_id = scope_branch(user, body.branch_id, required=True)
    if db.get(Product, body.product_id) is None or db.get(Branch, branch_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product or branch not found")
    inv = lock_inventory_rows(db, [(body.product_id, branch_id)])[(body.product_id, branch_id)]
    delta = body.delta if body.delta is not None else body.set_to - inv.stock_quantity
    if inv.stock_quantity + delta < 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Stock cannot go below zero (currently {inv.stock_quantity}).")
    if delta != 0:
        inv.stock_quantity += delta
        record_movement(
            db, product_id=body.product_id, branch_id=branch_id, delta=delta,
            reason="adjustment", user_id=user.id, note=body.note,
        )
    db.commit()
    background.add_task(manager.publish, "inventory.changed", [branch_id], {"product_ids": [body.product_id]})
    return to_row(inv)


class MovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    branch_id: int
    delta: int
    reason: str
    ref_type: str | None
    ref_id: int | None
    note: str | None
    created_at: datetime


@router.get("/movements", response_model=list[MovementOut])
def list_movements(
    branch_id: int | None = None,
    product_id: int | None = None,
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "manager")),
):
    """Stock ledger: every sale, transfer and adjustment, newest first."""
    scoped = scope_branch(user, branch_id)
    stmt = select(StockMovement).order_by(StockMovement.id.desc()).limit(limit)
    if scoped is not None:
        stmt = stmt.where(StockMovement.branch_id == scoped)
    if product_id:
        stmt = stmt.where(StockMovement.product_id == product_id)
    return db.scalars(stmt).all()
