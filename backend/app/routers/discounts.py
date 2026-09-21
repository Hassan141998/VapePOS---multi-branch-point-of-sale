"""Discounts and promotions. Cashiers see (and apply) only the ones that are active today."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Category, Discount, Product, User
from app.realtime import manager
from app.routers.categories import sync_categories
from app.schemas import DiscountIn, DiscountOut
from app.services.timeutils import today_local

router = APIRouter(prefix="/discounts", tags=["Discounts"])


def _out(d: Discount) -> DiscountOut:
    return DiscountOut(
        id=d.id, name=d.name, code=d.code, type=d.type, value=d.value, applies_to=d.applies_to,
        category=d.category, product_id=d.product_id, product_name=d.product_name, min_purchase=d.min_purchase,
        starts_on=d.starts_on, ends_on=d.ends_on, is_active=d.is_active, status=d.status_on(today_local()),
    )


def _check(db: Session, body: DiscountIn, *, ignore_id: int | None = None) -> dict:
    data = body.model_dump()
    data["code"] = body.code.strip().upper()
    clash = db.scalar(select(Discount.id).where(Discount.code == data["code"], Discount.id != (ignore_id or 0)))
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT, "Another discount already uses this code.")
    if data["applies_to"] == "category":
        sync_categories(db)
        if not db.scalar(select(Category.id).where(Category.name == data["category"])):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That category does not exist.")
        data["product_id"] = None
    elif data["applies_to"] == "product":
        if not db.get(Product, data["product_id"]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That product does not exist.")
        data["category"] = None
    else:
        data["category"] = None
        data["product_id"] = None
    return data


@router.get("", response_model=list[DiscountOut])
def list_discounts(
    active_only: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = db.scalars(select(Discount).order_by(func.lower(Discount.name), Discount.id)).unique().all()
    out = [_out(d) for d in rows]
    if active_only or user.role == "cashier":
        out = [d for d in out if d.status == "active"]
    return out


@router.post("", response_model=DiscountOut, status_code=status.HTTP_201_CREATED)
def create_discount(
    body: DiscountIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    d = Discount(**_check(db, body))
    db.add(d)
    db.commit()
    db.refresh(d)
    background.add_task(manager.publish, "discount.updated", [], {})
    return _out(d)


@router.put("/{discount_id}", response_model=DiscountOut)
def update_discount(
    discount_id: int,
    body: DiscountIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    d = db.get(Discount, discount_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Discount not found")
    for key, value in _check(db, body, ignore_id=d.id).items():
        setattr(d, key, value)
    db.commit()
    db.refresh(d)
    background.add_task(manager.publish, "discount.updated", [], {})
    return _out(d)


@router.delete("/{discount_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_discount(
    discount_id: int,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    """Past receipts keep their own copy of the discount code and name, so deleting is safe."""
    d = db.get(Discount, discount_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Discount not found")
    db.delete(d)
    db.commit()
    background.add_task(manager.publish, "discount.updated", [], {})
