"""Stock helpers shared by sales, transfers and manual adjustments."""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Branch, BranchInventory, Product, StockMovement


def lock_inventory_rows(
    db: Session, pairs: Iterable[tuple[int, int]]
) -> dict[tuple[int, int], BranchInventory]:
    """
    Make sure a (product_id, branch_id) inventory row exists for every pair, then
    lock them (SELECT ... FOR UPDATE) so two cashiers cannot sell the last unit at
    the same moment. Rows are always locked in sorted order to avoid deadlocks.
    """
    ordered = sorted(set(pairs))
    if not ordered:
        return {}
    db.execute(
        pg_insert(BranchInventory)
        .values([{"product_id": p, "branch_id": b, "stock_quantity": 0, "min_threshold": 5} for p, b in ordered])
        .on_conflict_do_nothing(index_elements=["product_id", "branch_id"])
    )
    rows = db.scalars(
        select(BranchInventory)
        .where(tuple_(BranchInventory.product_id, BranchInventory.branch_id).in_(ordered))
        .order_by(BranchInventory.product_id, BranchInventory.branch_id)
        .with_for_update(of=BranchInventory)
        .execution_options(populate_existing=True)
    ).all()
    return {(r.product_id, r.branch_id): r for r in rows}


def record_movement(
    db: Session,
    *,
    product_id: int,
    branch_id: int,
    delta: int,
    reason: str,
    user_id: int | None,
    ref_type: str | None = None,
    ref_id: int | None = None,
    note: str | None = None,
) -> None:
    db.add(
        StockMovement(
            product_id=product_id,
            branch_id=branch_id,
            delta=delta,
            reason=reason,
            ref_type=ref_type,
            ref_id=ref_id,
            note=note,
            user_id=user_id,
        )
    )


def create_rows_for_new_product(db: Session, product: Product) -> None:
    branch_ids = db.scalars(select(Branch.id)).all()
    if branch_ids:
        db.execute(
            pg_insert(BranchInventory)
            .values([{"product_id": product.id, "branch_id": b, "stock_quantity": 0, "min_threshold": 5} for b in branch_ids])
            .on_conflict_do_nothing(index_elements=["product_id", "branch_id"])
        )


def create_rows_for_new_branch(db: Session, branch: Branch) -> None:
    product_ids = db.scalars(select(Product.id)).all()
    if product_ids:
        db.execute(
            pg_insert(BranchInventory)
            .values([{"product_id": p, "branch_id": branch.id, "stock_quantity": 0, "min_threshold": 5} for p in product_ids])
            .on_conflict_do_nothing(index_elements=["product_id", "branch_id"])
        )
