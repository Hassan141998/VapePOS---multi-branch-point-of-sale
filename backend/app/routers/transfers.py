"""
Inter-branch stock transfers.

Lifecycle:  pending -> in_transit -> received        (or cancelled before receiving)

Stock only moves when the destination confirms delivery ("received"). At that
moment source stock is decremented and destination stock incremented inside ONE
database transaction, with the affected inventory rows locked.
"""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles
from app.models import Branch, Product, StockTransfer, StockTransferEvent, StockTransferItem, User
from app.realtime import manager
from app.schemas import TransferAction, TransferCreate, TransferOut
from app.services.inventory import lock_inventory_rows, record_movement

router = APIRouter(prefix="/transfers", tags=["Transfers"], dependencies=[Depends(require_roles("admin", "manager"))])

Staff = Depends(require_roles("admin", "manager"))


def _touches(user: User, t: StockTransfer) -> bool:
    return user.role == "admin" or user.branch_id in (t.from_branch_id, t.to_branch_id)


def _get_visible(db: Session, transfer_id: int, user: User) -> StockTransfer:
    t = db.get(StockTransfer, transfer_id)
    if not t or not _touches(user, t):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transfer not found")
    return t


def _lock_transfer(db: Session, transfer_id: int, user: User) -> StockTransfer:
    """Load the transfer header with a row lock so it cannot be double-processed."""
    t = db.scalar(
        select(StockTransfer)
        .where(StockTransfer.id == transfer_id)
        .with_for_update(of=StockTransfer)
        .execution_options(populate_existing=True)
    )
    if not t or not _touches(user, t):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transfer not found")
    return t


def _require_side(user: User, branch_id: int, verb: str):
    if user.role != "admin" and user.branch_id != branch_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Only the {verb} branch (or an admin) can do this.")


def _log(t: StockTransfer, status_: str, user: User, note: str | None = None):
    t.events.append(StockTransferEvent(status=status_, user_id=user.id, note=note))


def _notify(background: BackgroundTasks, t: StockTransfer, inventory_changed: bool = False):
    branches = [t.from_branch_id, t.to_branch_id]
    background.add_task(manager.publish, "transfer.updated", branches, {"transfer_id": t.id, "status": t.status})
    if inventory_changed:
        background.add_task(manager.publish, "inventory.changed", branches, {})


@router.get("", response_model=list[TransferOut])
def list_transfers(
    status_filter: str | None = Query(None, alias="status"),
    branch_id: int | None = None,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Staff,
):
    stmt = select(StockTransfer).order_by(StockTransfer.id.desc()).limit(limit)
    scoped = user.branch_id if user.role != "admin" else branch_id
    if scoped is not None:
        stmt = stmt.where(or_(StockTransfer.from_branch_id == scoped, StockTransfer.to_branch_id == scoped))
    if status_filter:
        stmt = stmt.where(StockTransfer.status == status_filter)
    return db.scalars(stmt).unique().all()


@router.get("/{transfer_id}", response_model=TransferOut)
def get_transfer(transfer_id: int, db: Session = Depends(get_db), user: User = Staff):
    return _get_visible(db, transfer_id, user)


@router.post("", response_model=TransferOut, status_code=status.HTTP_201_CREATED)
def create_transfer(
    body: TransferCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Staff,
):
    """Step 1 - request a transfer. Status starts as 'pending'."""
    if user.role != "admin" and user.branch_id not in (body.from_branch_id, body.to_branch_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only create transfers for your own branch.")
    for bid in (body.from_branch_id, body.to_branch_id):
        branch = db.get(Branch, bid)
        if not branch or not branch.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Branch not found or inactive")

    wanted: dict[int, int] = {}
    for item in body.items:
        wanted[item.product_id] = wanted.get(item.product_id, 0) + item.quantity

    products = {p.id: p for p in db.scalars(select(Product).where(Product.id.in_(wanted))).all()}
    for pid in wanted:
        if pid not in products or not products[pid].is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Product {pid} not found or inactive")

    # Early sanity check against source stock (re-checked, with locks, on receive).
    stock = lock_inventory_rows(db, [(pid, body.from_branch_id) for pid in wanted])
    for pid, qty in wanted.items():
        have = stock[(pid, body.from_branch_id)].stock_quantity
        if qty > have:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Source branch only has {have} of '{products[pid].name}' (requested {qty}).",
            )

    t = StockTransfer(
        from_branch_id=body.from_branch_id,
        to_branch_id=body.to_branch_id,
        note=body.note,
        created_by=user.id,
        status="pending",
    )
    t.items = [StockTransferItem(product_id=pid, quantity=qty) for pid, qty in wanted.items()]
    _log(t, "pending", user, "Transfer requested")
    db.add(t)
    db.commit()
    db.refresh(t)
    _notify(background, t)
    return t


@router.post("/{transfer_id}/dispatch", response_model=TransferOut)
def dispatch_transfer(
    transfer_id: int,
    background: BackgroundTasks,
    body: TransferAction | None = None,
    db: Session = Depends(get_db),
    user: User = Staff,
):
    """Step 2 - the SOURCE branch hands the goods to the courier. pending -> in_transit."""
    t = _lock_transfer(db, transfer_id, user)
    _require_side(user, t.from_branch_id, "source")
    if t.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Only pending transfers can be dispatched (this one is {t.status}).")
    t.status = "in_transit"
    _log(t, "in_transit", user, body.note if body else None)
    db.commit()
    db.refresh(t)
    _notify(background, t)
    return t


@router.post("/{transfer_id}/receive", response_model=TransferOut)
def receive_transfer(
    transfer_id: int,
    background: BackgroundTasks,
    body: TransferAction | None = None,
    db: Session = Depends(get_db),
    user: User = Staff,
):
    """Step 3 - the DESTINATION branch confirms delivery. in_transit -> received (moves the stock)."""
    t = _lock_transfer(db, transfer_id, user)
    _require_side(user, t.to_branch_id, "destination")
    if t.status != "in_transit":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Only in-transit transfers can be received (this one is {t.status}).")

    pairs = [(i.product_id, b) for i in t.items for b in (t.from_branch_id, t.to_branch_id)]
    rows = lock_inventory_rows(db, pairs)

    for item in t.items:  # verify everything first so the operation is all-or-nothing
        have = rows[(item.product_id, t.from_branch_id)].stock_quantity
        if have < item.quantity:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Source branch no longer has enough '{item.product_name}' ({have} left, {item.quantity} needed). "
                "Ask the source branch to correct its stock first.",
            )

    for item in t.items:
        rows[(item.product_id, t.from_branch_id)].stock_quantity -= item.quantity
        rows[(item.product_id, t.to_branch_id)].stock_quantity += item.quantity
        record_movement(db, product_id=item.product_id, branch_id=t.from_branch_id, delta=-item.quantity,
                        reason="transfer_out", ref_type="transfer", ref_id=t.id, user_id=user.id)
        record_movement(db, product_id=item.product_id, branch_id=t.to_branch_id, delta=item.quantity,
                        reason="transfer_in", ref_type="transfer", ref_id=t.id, user_id=user.id)

    t.status = "received"
    _log(t, "received", user, body.note if body else None)
    db.commit()
    db.refresh(t)
    _notify(background, t, inventory_changed=True)
    return t


@router.post("/{transfer_id}/cancel", response_model=TransferOut)
def cancel_transfer(
    transfer_id: int,
    background: BackgroundTasks,
    body: TransferAction | None = None,
    db: Session = Depends(get_db),
    user: User = Staff,
):
    """Either branch (or an admin) can cancel until the goods are received. No stock changes."""
    t = _lock_transfer(db, transfer_id, user)
    if t.status not in ("pending", "in_transit"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A {t.status} transfer cannot be cancelled.")
    t.status = "cancelled"
    _log(t, "cancelled", user, body.note if body else None)
    db.commit()
    db.refresh(t)
    _notify(background, t)
    return t
