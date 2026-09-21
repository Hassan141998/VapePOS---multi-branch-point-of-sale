import secrets
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, scope_branch
from app.models import Branch, Product, Sale, SaleItem, User
from app.realtime import manager
from app.schemas import SaleCreate, SaleOut, SaleSummaryOut
from app.services.inventory import lock_inventory_rows, record_movement
from app.services.timeutils import day_bounds

router = APIRouter(prefix="/sales", tags=["Sales"])

CENT = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


@router.post("", response_model=SaleOut, status_code=status.HTTP_201_CREATED)
def create_sale(
    body: SaleCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Check out a cart. Cashiers/managers always sell from THEIR branch; the
    branch is taken from the login, never from the request.
    """
    branch_id = scope_branch(user, body.branch_id, required=True)
    branch = db.get(Branch, branch_id)
    if not branch or not branch.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Branch not found or inactive")

    wanted: dict[int, int] = {}
    for item in body.items:
        wanted[item.product_id] = wanted.get(item.product_id, 0) + item.quantity

    products = {p.id: p for p in db.scalars(select(Product).where(Product.id.in_(wanted))).all()}
    for pid in wanted:
        if pid not in products or not products[pid].is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Product {pid} not found or no longer sold")

    # Lock this branch's stock rows so concurrent checkouts cannot oversell.
    rows = lock_inventory_rows(db, [(pid, branch_id) for pid in wanted])
    for pid, qty in wanted.items():
        have = rows[(pid, branch_id)].stock_quantity
        if have < qty:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Not enough stock for '{products[pid].name}': {have} left, {qty} in cart.",
            )

    subtotal = money(sum((products[pid].selling_price * qty for pid, qty in wanted.items()), Decimal("0")))
    tax_amount = money(subtotal * branch.tax_rate / Decimal(100))
    total = subtotal + tax_amount

    if body.payment_method == "cash":
        tendered = money(body.amount_tendered) if body.amount_tendered is not None else total
        if tendered < total:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cash received ({tendered}) is less than the total ({total}).")
        change = tendered - total
    else:
        tendered, change = total, Decimal("0.00")

    now = datetime.now(timezone.utc)
    sale = Sale(
        receipt_number=f"{branch.code}-{now:%y%m%d}-{secrets.token_hex(3).upper()}",
        branch_id=branch_id,
        cashier_id=user.id,
        subtotal=subtotal,
        tax_rate=branch.tax_rate,
        tax_amount=tax_amount,
        total_amount=total,
        payment_method=body.payment_method,
        amount_tendered=tendered,
        change_due=change,
    )
    sale.items = [
        SaleItem(
            product_id=pid,
            product_name=products[pid].name,
            quantity=qty,
            unit_price=products[pid].selling_price,
            unit_cost=products[pid].buying_price,
        )
        for pid, qty in wanted.items()
    ]
    db.add(sale)
    db.flush()  # gives the sale an id for the stock ledger

    for pid, qty in wanted.items():
        rows[(pid, branch_id)].stock_quantity -= qty
        record_movement(db, product_id=pid, branch_id=branch_id, delta=-qty, reason="sale",
                        ref_type="sale", ref_id=sale.id, user_id=user.id)
    db.commit()
    db.refresh(sale)

    background.add_task(manager.publish, "sale.created", [branch_id], {"receipt_number": sale.receipt_number})
    background.add_task(manager.publish, "inventory.changed", [branch_id], {"product_ids": list(wanted)})
    return sale


@router.get("", response_model=list[SaleSummaryOut])
def list_sales(
    branch_id: int | None = None,
    business_date: date | None = Query(None, description="Only sales on this local business day"),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    scoped = scope_branch(user, branch_id)
    stmt = select(Sale).order_by(Sale.id.desc()).limit(limit)
    if scoped is not None:
        stmt = stmt.where(Sale.branch_id == scoped)
    if business_date:
        start, end = day_bounds(business_date)
        stmt = stmt.where(Sale.created_at >= start, Sale.created_at < end)
    return db.scalars(stmt).unique().all()


@router.get("/{sale_id}", response_model=SaleOut)
def get_sale(sale_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    sale = db.get(Sale, sale_id)
    if not sale:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt not found")
    scope_branch(user, sale.branch_id)  # 403 if it belongs to another branch
    return sale
