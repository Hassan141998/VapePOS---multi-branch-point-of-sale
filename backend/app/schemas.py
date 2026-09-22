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
    created_at: datetime | None = None


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
    category: str | None = Field(default=None, max_length=50)
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
    category: str | None = Field(default=None, max_length=50)
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
    discount_code: str | None = Field(default=None, max_length=40, description="Code of an active discount to apply")


class SaleItemOut(ORM):
    product_id: int
    product_name: str
    barcode: str | None = None
    quantity: int
    unit_price: Money
    discount_amount: Money = Decimal("0")
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
    discount_amount: Money = Decimal("0")
    discount_code: str | None = None
    discount_name: str | None = None
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


# --------------------------------------------------------------------------- #
# Categories
# --------------------------------------------------------------------------- #
class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    description: str | None = Field(default=None, max_length=500)


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = Field(default=None, max_length=500)


class CategoryOut(BaseModel):
    id: int
    name: str
    description: str | None
    product_count: int


# --------------------------------------------------------------------------- #
# Discounts
# --------------------------------------------------------------------------- #
DiscountType = Literal["percent", "fixed"]
DiscountScope = Literal["all", "category", "product"]
DiscountStatus = Literal["active", "scheduled", "expired", "disabled"]


class DiscountBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=2, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    type: DiscountType
    value: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    applies_to: DiscountScope = "all"
    category: str | None = Field(default=None, max_length=50)
    product_id: int | None = None
    min_purchase: Decimal = Field(default=Decimal("0"), ge=0, max_digits=10, decimal_places=2)
    starts_on: date | None = None
    ends_on: date | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def coherent(self):
        if self.type == "percent" and self.value > 100:
            raise ValueError("A percentage discount cannot be more than 100%")
        if self.applies_to == "category" and not self.category:
            raise ValueError("Choose the category this discount applies to")
        if self.applies_to == "product" and self.product_id is None:
            raise ValueError("Choose the product this discount applies to")
        if self.starts_on and self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("The end date cannot be before the start date")
        return self


class DiscountIn(DiscountBase):
    pass


class DiscountOut(BaseModel):
    id: int
    name: str
    code: str
    type: DiscountType
    value: Money
    applies_to: DiscountScope
    category: str | None
    product_id: int | None
    product_name: str | None
    min_purchase: Money
    starts_on: date | None
    ends_on: date | None
    is_active: bool
    status: DiscountStatus


# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #
FontFamily = Literal["Arial", "Courier New", "Georgia", "Tahoma", "Times New Roman", "Verdana"]


class BusinessSettings(BaseModel):
    """Shop-wide profile and currency (System Settings page)."""

    model_config = ConfigDict(extra="ignore")

    business_name: str = Field(default="VapePOS", min_length=1, max_length=100)
    email: str | None = Field(default=None, max_length=120)
    website: str | None = Field(default=None, max_length=200)
    currency: str = Field(default="PKR", pattern=r"^[A-Za-z]{3}$")
    currency_symbol: str | None = Field(default="Rs", max_length=5, description="Optional; overrides the symbol")


class ReceiptDesign(BaseModel):
    """How printed receipts look (Receipt Designer page). Defaults reproduce the built-in receipt."""

    model_config = ConfigDict(extra="ignore")

    width_px: int = Field(default=300, ge=200, le=420)
    font_size: int = Field(default=12, ge=8, le=18)
    font_family: FontFamily = "Arial"
    print_after_sale: bool = False
    # header
    show_logo: bool = False
    logo_data_url: str | None = Field(default=None, max_length=250_000)
    show_business_name: bool = False
    show_address: bool = False
    fallback_address: str = Field(default="", max_length=200, description="Used only when a branch has no address of its own")
    show_phone: bool = False
    fallback_phone: str = Field(default="", max_length=40, description="Used only when a branch has no phone of its own")
    show_email: bool = False
    show_website: bool = False
    show_tax_number: bool = True
    header_extra: str = Field(default="", max_length=300)
    # content
    show_receipt_number: bool = True
    show_datetime: bool = True
    show_cashier: bool = True
    show_item_barcode: bool = False
    show_unit_price: bool = True
    show_tax_line: bool = True
    show_payment: bool = True
    # footer
    show_branch_footer: bool = True
    footer_text: str = Field(default="", max_length=300)
    return_policy: str = Field(default="", max_length=500)
    show_receipt_barcode: bool = False

    @model_validator(mode="after")
    def logo_is_an_image(self):
        if self.logo_data_url and not self.logo_data_url.startswith(("data:image/png", "data:image/jpeg", "data:image/svg+xml", "data:image/webp")):
            raise ValueError("The logo must be a PNG, JPEG, WebP or SVG image")
        return self


class SettingsOut(BaseModel):
    business: BusinessSettings
    receipt: ReceiptDesign
    timezone: str


# --------------------------------------------------------------------------- #
# Sales report (Reports page)
# --------------------------------------------------------------------------- #
class SalesReportTotals(BaseModel):
    revenue: Money  # net of discounts, before tax
    transactions: int
    avg_transaction: Money
    items_sold: int
    discounts: Money


class SalesReportDay(BaseModel):
    date: date
    revenue: Money
    transactions: int


class SalesReportProduct(BaseModel):
    product_id: int
    name: str
    category: str | None
    quantity: int
    revenue: Money


class SalesReportCategory(BaseModel):
    category: str
    quantity: int
    revenue: Money


class SalesReportOut(BaseModel):
    date_from: date
    date_to: date
    totals: SalesReportTotals
    daily: list[SalesReportDay]
    top_products: list[SalesReportProduct]
    by_category: list[SalesReportCategory]
