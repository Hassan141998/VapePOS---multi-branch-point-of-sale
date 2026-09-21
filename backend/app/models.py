"""
Database models (SQLAlchemy 2.0 declarative style).

Tables:
  branches, users, products, branch_inventory, stock_movements,
  stock_transfers, stock_transfer_items, stock_transfer_events,
  sales, sale_items, z_reports
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

ROLES = ("admin", "manager", "cashier")
TRANSFER_STATUSES = ("pending", "in_transit", "received", "cancelled")
PAYMENT_METHODS = ("cash", "card")


def _now_col() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


# --------------------------------------------------------------------------- #
# Branches & users
# --------------------------------------------------------------------------- #
class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    code: Mapped[str] = mapped_column(String(10), unique=True)  # short label, e.g. "DT"
    address: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(20))
    tax_number: Mapped[str | None] = mapped_column(String(50))
    # Sales tax percentage added on top of shelf prices, e.g. 8.25
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"), server_default="0")
    receipt_header_text: Mapped[str | None] = mapped_column(Text)
    receipt_footer_text: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = _now_col()


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role IN ('admin','manager','cashier')", name="ck_users_role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    full_name: Mapped[str] = mapped_column(String(100), default="", server_default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = _now_col()

    branch: Mapped[Branch | None] = relationship(lazy="joined")

    @property
    def branch_name(self) -> str | None:
        return self.branch.name if self.branch else None


# --------------------------------------------------------------------------- #
# Products & inventory
# --------------------------------------------------------------------------- #
class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("buying_price >= 0 AND selling_price >= 0", name="ck_products_prices"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    barcode: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(150))
    brand: Mapped[str | None] = mapped_column(String(80))
    # device | pod | coil | e-liquid | disposable | accessory
    category: Mapped[str | None] = mapped_column(String(50), index=True)
    flavor: Mapped[str | None] = mapped_column(String(50), index=True)  # "Mango Ice"
    nicotine_type: Mapped[str] = mapped_column(String(20), default="none", server_default="none")  # none|freebase|salt
    nicotine_strength: Mapped[str | None] = mapped_column(String(20))  # "3mg", "20mg", "50mg"
    coil_resistance_ohm: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))  # 0.60
    device_variant: Mapped[str | None] = mapped_column(String(80))  # "Matte Black", "Kit"
    buying_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    selling_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = _now_col()


class BranchInventory(Base):
    """Stock of one product at one branch."""

    __tablename__ = "branch_inventory"
    __table_args__ = (
        UniqueConstraint("product_id", "branch_id", name="uq_inventory_product_branch"),
        CheckConstraint("stock_quantity >= 0", name="ck_inventory_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    stock_quantity: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    min_threshold: Mapped[int] = mapped_column(Integer, default=5, server_default="5")

    product: Mapped[Product] = relationship(lazy="joined")
    branch: Mapped[Branch] = relationship(lazy="joined")


class StockMovement(Base):
    """Append-only ledger of every stock change (sale, transfer, manual adjustment)."""

    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(30))  # sale | transfer_out | transfer_in | adjustment
    ref_type: Mapped[str | None] = mapped_column(String(30))
    ref_id: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _now_col()


# --------------------------------------------------------------------------- #
# Inter-branch transfers
# --------------------------------------------------------------------------- #
class StockTransfer(Base):
    __tablename__ = "stock_transfers"
    __table_args__ = (
        CheckConstraint("status IN ('pending','in_transit','received','cancelled')", name="ck_transfer_status"),
        CheckConstraint("from_branch_id <> to_branch_id", name="ck_transfer_different_branches"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    from_branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id"), index=True)
    to_branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", index=True)
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _now_col()

    from_branch: Mapped[Branch] = relationship(foreign_keys=[from_branch_id], lazy="joined")
    to_branch: Mapped[Branch] = relationship(foreign_keys=[to_branch_id], lazy="joined")
    creator: Mapped[User | None] = relationship(foreign_keys=[created_by], lazy="joined")
    items: Mapped[list[StockTransferItem]] = relationship(
        back_populates="transfer", cascade="all, delete-orphan", lazy="selectin"
    )
    events: Mapped[list[StockTransferEvent]] = relationship(
        back_populates="transfer",
        cascade="all, delete-orphan",
        order_by="StockTransferEvent.id",
        lazy="selectin",
    )

    @property
    def reference(self) -> str:
        return f"TR-{self.id:05d}"

    @property
    def from_branch_name(self) -> str:
        return self.from_branch.name

    @property
    def to_branch_name(self) -> str:
        return self.to_branch.name

    @property
    def created_by_name(self) -> str | None:
        return (self.creator.full_name or self.creator.username) if self.creator else None


class StockTransferItem(Base):
    __tablename__ = "stock_transfer_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_transfer_item_qty"),
        UniqueConstraint("transfer_id", "product_id", name="uq_transfer_item_product"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    transfer_id: Mapped[int] = mapped_column(ForeignKey("stock_transfers.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)

    transfer: Mapped[StockTransfer] = relationship(back_populates="items")
    product: Mapped[Product] = relationship(lazy="joined")

    @property
    def product_name(self) -> str:
        return self.product.name

    @property
    def barcode(self) -> str:
        return self.product.barcode


class StockTransferEvent(Base):
    """Audit log: one row for each status change of a transfer."""

    __tablename__ = "stock_transfer_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    transfer_id: Mapped[int] = mapped_column(ForeignKey("stock_transfers.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _now_col()

    transfer: Mapped[StockTransfer] = relationship(back_populates="events")
    user: Mapped[User | None] = relationship(lazy="joined")

    @property
    def username(self) -> str | None:
        return (self.user.full_name or self.user.username) if self.user else None


# --------------------------------------------------------------------------- #
# Sales
# --------------------------------------------------------------------------- #
class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (
        CheckConstraint("payment_method IN ('cash','card')", name="ck_sales_payment"),
        Index("ix_sales_branch_created", "branch_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    receipt_number: Mapped[str] = mapped_column(String(50), unique=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id"))
    cashier_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))  # snapshot at sale time
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    payment_method: Mapped[str] = mapped_column(String(20), default="cash", server_default="cash")
    amount_tendered: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    change_due: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    created_at: Mapped[datetime] = _now_col()

    branch: Mapped[Branch] = relationship(lazy="joined")
    cashier: Mapped[User | None] = relationship(lazy="joined")
    items: Mapped[list[SaleItem]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def cashier_name(self) -> str | None:
        return (self.cashier.full_name or self.cashier.username) if self.cashier else None


class SaleItem(Base):
    __tablename__ = "sale_items"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_sale_item_qty"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    product_name: Mapped[str] = mapped_column(String(150))  # snapshot
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))  # snapshot
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2))  # snapshot, for profit reports

    sale: Mapped[Sale] = relationship(back_populates="items")
    product: Mapped[Product] = relationship(lazy="joined")

    @property
    def line_total(self) -> Decimal:
        return self.unit_price * self.quantity


# --------------------------------------------------------------------------- #
# End-of-day closure
# --------------------------------------------------------------------------- #
class ZReport(Base):
    """A closed business day for one branch. One row per (branch, date)."""

    __tablename__ = "z_reports"
    __table_args__ = (UniqueConstraint("branch_id", "business_date", name="uq_zreport_branch_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id"), index=True)
    business_date: Mapped[date] = mapped_column(Date)
    receipts_count: Mapped[int] = mapped_column(Integer, default=0)
    items_sold: Mapped[int] = mapped_column(Integer, default=0)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    tax_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    gross_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    cash_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    card_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    opening_float: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    counted_cash: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    cash_variance: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))  # counted - (float + cash sales)
    notes: Mapped[str | None] = mapped_column(Text)
    closed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    closed_at: Mapped[datetime] = _now_col()

    branch: Mapped[Branch] = relationship(lazy="joined")
    closer: Mapped[User | None] = relationship(lazy="joined")

    @property
    def closed_by_name(self) -> str | None:
        return (self.closer.full_name or self.closer.username) if self.closer else None
