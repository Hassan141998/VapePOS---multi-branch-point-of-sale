"""
Pydantic schemas: what the API accepts (…In / …Update) and returns (…Out).

Money is stored as Decimal in Python/PostgreSQL (no floating point drift)
and sent to the browser as a plain JSON number.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, model_validator

Money = Annotated[Decimal, PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]

Role = Literal["admin", "manager", "cashier"]
Category = Literal["device", "pod", "coil", "e-liquid", "disposable", "accessory"]
NicotineType = Literal["none", "freebase", "salt"]
PaymentMethod = Literal["cash", "card"]
TransferStatus = Literal["pending", "in_transit", "received", "cancelled"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- #
# Branches
# --------------------------------------------------------------------------- #
class BranchIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    code: str = Field(min_length=2, max_length=10, pattern=r"^[A-Za-z0-9]+$")
    address: str | None = None
    phone: str | None = Field(default=None, max_length=20)
    tax_number: str | None = Field(default=None, max_length=50)
    tax_rate: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    receipt_header_text: str | None = None
    receipt_footer_text: str | None = None
    is_active: bool = True


class BranchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    code: str | None = Field(default=None, min_length=2, max_length=10, pattern=r"^[A-Za-z0-9]+$")
    address: str | None = None
    phone: str | None = Field(default=None, max_length=20)
    tax_number: str | None = Field(default=None, max_length=50)
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100)
    receipt_header_text: str | None = None
    receipt_footer_text: str | None = None
    is_active: bool | None = None


class BranchOut(ORM):
    id: int
    name: str
    code: str
    address: str | None
    phone: str | None
    tax_number: str | None
    tax_rate: Money
    receipt_header_text: str | None
    receipt_footer_text: str | None
    is_active: bool


# --------------------------------------------------------------------------- #
# Users & auth
# --------------------------------------------------------------------------- #
class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$")
    full_name: str = Field(default="", max_length=100)
    password: str = Field(min_length=8, max_length=72)
    role: Role
    branch_id: int | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def branch_required_for_staff(self):
        if self.role != "admin" and self.branch_id is None:
            raise ValueError("Managers and cashiers must be assigned to a branch")
        return self


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=100)
    password: str | None = Field(default=None, min_length=8, max_length=72)
    role: Role | None = None
    branch_id: int | None = None
    is_active: bool | None = None


class UserOut(ORM):
    id: int
    username: str
    full_name: str
    role: Role
    branch_id: int | None
    branch_name: str | None
    is_active: bool


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# --------------------------------------------------------------------------- #
# Products
# --------------------------------------------------------------------------- #
class ProductBase(BaseModel):
    barcode: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=150)
    brand: str | None = Field(default=None, max_length=80)
    category: Category | None = None
    flavor: str | None = Field(default=None, max_length=50)
    nicotine_type: NicotineType = "none"
    nicotine_strength: str | None = Field(default=None, max_length=20)
    coil_resistance_ohm: Decimal | None = Field(default=None, gt=0, le=10)
    device_variant: str | None = Field(default=None, max_length=80)
    buying_price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    selling_price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    is_active: bool = True


class ProductIn(ProductBase):
    pass


class ProductUpdate(BaseModel):
    barcode: str | None = Field(default=None, min_length=1, max_length=100)
    name: str | None = Field(default=None, min_length=1, max_length=150)
    brand: str | None = None
    category: Category | None = None
    flavor: str | None = None
    nicotine_type: NicotineType | None = None
    nicotine_strength: str | None = None
    coil_resistance_ohm: Decimal | None = Field(default=None, gt=0, le=10)
    device_variant: str | None = None
    buying_price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    selling_price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    is_active: bool | None = None


class ProductPublic(ORM):
    """Product fields safe to show to every role (no cost price)."""

    id: int
    barcode: str
    name: str
    brand: str | None
    category: str | None
    flavor: str | None
    nicotine_type: str
    nicotine_strength: str | None
    coil_resistance_ohm: Money | None
    device_variant: str | None
    selling_price: Money
    is_active: bool


class ProductOut(ProductPublic):
    """Cost price is filled in for admins/managers and left null for cashiers."""

    buying_price: Money | None = None


# --------------------------------------------------------------------------- #
# Inventory
# --------------------------------------------------------------------------- #
class InventoryRowOut(BaseModel):
    product: ProductPublic
    branch_id: int
    branch_name: str
    stock_quantity: int
    min_threshold: int
    is_low: bool


class ThresholdUpdate(BaseModel):
    min_threshold: int = Field(ge=0, le=100000)


class StockAdjust(BaseModel):
    branch_id: int | None = None
    product_id: int
    delta: int | None = Field(default=None, description="Add (+) or remove (-) this many units")
    set_to: int | None = Field(default=None, ge=0, description="Set stock to exactly this count")
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def exactly_one(self):
        if (self.delta is None) == (self.set_to is None):
            raise ValueError("Provide exactly one of 'delta' or 'set_to'")
        return self


# --------------------------------------------------------------------------- #
# Transfers
# --------------------------------------------------------------------------- #
class TransferItemIn(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, le=100000)


class TransferCreate(BaseModel):
    from_branch_id: int
    to_branch_id: int
    note: str | None = Field(default=None, max_length=500)
    items: list[TransferItemIn] = Field(min_length=1)

    @model_validator(mode="after")
    def different_branches(self):
        if self.from_branch_id == self.to_branch_id:
            raise ValueError("Source and destination branch must be different")
        return self


class TransferAction(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class TransferItemOut(ORM):
    product_id: int
    product_name: str
    barcode: str
    quantity: int


class TransferEventOut(ORM):
    id: int
    status: TransferStatus
    username: str | None
    note: str | None
    created_at: datetime


class TransferOut(ORM):
    id: int
    reference: str
    from_branch_id: int
    from_branch_name: str
    to_branch_id: int
    to_branch_name: str
    status: TransferStatus
    note: str | None
    created_by_name: str | None
    created_at: datetime
    items: list[TransferItemOut]
    events: list[TransferEventOut]


# --------------------------------------------------------------------------- #
# Sales
# --------------------------------------------------------------------------- #
class SaleItemIn(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, le=999)


class SaleCreate(BaseModel):
    branch_id: int | None = Field(default=None, description="Admins only. Staff are locked to their own branch.")
    items: list[SaleItemIn] = Field(min_length=1)
    payment_method: PaymentMethod = "cash"
    amount_tendered: Decimal | None = Field(default=None, ge=0)


class SaleItemOut(ORM):
    product_id: int
    product_name: str
    quantity: int
    unit_price: Money
    line_total: Money


class SaleOut(ORM):
    id: int
    receipt_number: str
    branch: BranchOut
    cashier_name: str | None
    subtotal: Money
    tax_rate: Money
    tax_amount: Money
    total_amount: Money
    payment_method: PaymentMethod
    amount_tendered: Money | None
    change_due: Money | None
    created_at: datetime
    items: list[SaleItemOut]


class SaleSummaryOut(ORM):
    id: int
    receipt_number: str
    branch_id: int
    cashier_name: str | None
    total_amount: Money
    payment_method: PaymentMethod
    created_at: datetime


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #
class ZTotals(BaseModel):
    branch_id: int
    branch_name: str
    business_date: date
    receipts_count: int
    items_sold: int
    subtotal: Money
    tax_total: Money
    gross_total: Money
    cash_total: Money
    card_total: Money


class ZReportOut(ORM):
    id: int
    branch_id: int
    branch: BranchOut
    business_date: date
    receipts_count: int
    items_sold: int
    subtotal: Money
    tax_total: Money
    gross_total: Money
    cash_total: Money
    card_total: Money
    opening_float: Money
    counted_cash: Money | None
    cash_variance: Money | None
    notes: str | None
    closed_by_name: str | None
    closed_at: datetime


class ZReportView(BaseModel):
    """Live totals for a day, plus the saved closure if the day was already closed."""

    totals: ZTotals
    closure: ZReportOut | None


class ZCloseIn(BaseModel):
    branch_id: int | None = None
    business_date: date | None = None
    opening_float: Decimal = Field(default=Decimal("0"), ge=0)
    counted_cash: Decimal | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=1000)


class DashboardKpis(BaseModel):
    today_sales: Money
    today_receipts: int
    period_sales: Money
    period_receipts: int
    period_profit: Money | None  # hidden from cashiers (they cannot open the dashboard anyway)
    low_stock_count: int


class BranchTotal(BaseModel):
    branch_id: int
    branch_name: str
    total: Money
    receipts: int


class DailySeries(BaseModel):
    branch_id: int
    branch_name: str
    values: list[Money]


class DailySales(BaseModel):
    dates: list[date]
    series: list[DailySeries]


class TopItem(BaseModel):
    label: str
    quantity: int
    revenue: Money


class LowStockItem(BaseModel):
    product_id: int
    product_name: str
    branch_id: int
    branch_name: str
    stock_quantity: int
    min_threshold: int


class DashboardOut(BaseModel):
    days: int
    kpis: DashboardKpis
    by_branch: list[BranchTotal]
    daily: DailySales
    top_flavors: list[TopItem]
    top_devices: list[TopItem]
    low_stock: list[LowStockItem]
