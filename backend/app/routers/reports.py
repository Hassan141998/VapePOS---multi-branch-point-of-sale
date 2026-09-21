"""Dashboard analytics and the End-of-Day (Z) report."""
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import Date, case, cast, desc, distinct, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_roles, scope_branch
from app.models import Branch, BranchInventory, Product, Sale, SaleItem, User, ZReport
from app.realtime import manager
from app.schemas import (
    BranchTotal, DailySales, DailySeries, DashboardKpis, DashboardOut, LowStockItem,
    SalesReportCategory, SalesReportDay, SalesReportOut, SalesReportProduct, SalesReportTotals,
    TopItem, ZCloseIn, ZReportOut, ZReportView, ZTotals,
)
from app.services.timeutils import day_bounds, day_start_utc, today_local

router = APIRouter(prefix="/reports", tags=["Reports"])

ZERO = Decimal("0")


# --------------------------------------------------------------------------- #
# Z-Report
# --------------------------------------------------------------------------- #
def compute_z_totals(db: Session, branch: Branch, day: date) -> ZTotals:
    start, end = day_bounds(day)
    in_day = (Sale.branch_id == branch.id, Sale.created_at >= start, Sale.created_at < end)
    zero = Decimal("0")
    row = db.execute(
        select(
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.subtotal), 0),
            func.coalesce(func.sum(Sale.tax_amount), 0),
            func.coalesce(func.sum(Sale.total_amount), 0),
            func.coalesce(func.sum(case((Sale.payment_method == "cash", Sale.total_amount), else_=zero)), 0),
            func.coalesce(func.sum(case((Sale.payment_method == "card", Sale.total_amount), else_=zero)), 0),
        ).where(*in_day)
    ).one()
    items = db.scalar(
        select(func.coalesce(func.sum(SaleItem.quantity), 0)).join(Sale, SaleItem.sale_id == Sale.id).where(*in_day)
    )
    return ZTotals(
        branch_id=branch.id, branch_name=branch.name, business_date=day,
        receipts_count=row[0], items_sold=int(items or 0),
        subtotal=row[1], tax_total=row[2], gross_total=row[3], cash_total=row[4], card_total=row[5],
    )


def _z_branch(db: Session, user: User, branch_id: int | None) -> Branch:
    bid = scope_branch(user, branch_id, required=True)
    branch = db.get(Branch, bid)
    if not branch:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")
    return branch


@router.get("/z-report", response_model=ZReportView)
def z_report(
    branch_id: int | None = None,
    business_date: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Live totals for a day (an "X report"), plus the saved closure if the day was closed."""
    branch = _z_branch(db, user, branch_id)
    day = business_date or today_local()
    closure = db.scalar(select(ZReport).where(ZReport.branch_id == branch.id, ZReport.business_date == day))
    return ZReportView(totals=compute_z_totals(db, branch, day), closure=closure)


@router.post("/z-report/close", response_model=ZReportOut, status_code=status.HTTP_201_CREATED)
def close_day(
    body: ZCloseIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Close the business day for a branch: freezes the totals and records the cash count."""
    branch = _z_branch(db, user, body.branch_id)
    day = body.business_date or today_local()
    if day > today_local():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot close a day in the future.")
    if db.scalar(select(ZReport.id).where(ZReport.branch_id == branch.id, ZReport.business_date == day)):
        raise HTTPException(status.HTTP_409_CONFLICT, "This day is already closed for this branch.")

    t = compute_z_totals(db, branch, day)
    variance = None
    if body.counted_cash is not None:
        variance = body.counted_cash - (body.opening_float + t.cash_total)
    report = ZReport(
        branch_id=branch.id, business_date=day, receipts_count=t.receipts_count, items_sold=t.items_sold,
        subtotal=t.subtotal, tax_total=t.tax_total, gross_total=t.gross_total,
        cash_total=t.cash_total, card_total=t.card_total, opening_float=body.opening_float,
        counted_cash=body.counted_cash, cash_variance=variance, notes=body.notes, closed_by=user.id,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    background.add_task(manager.publish, "zreport.closed", [branch.id], {"business_date": day.isoformat()})
    return report


@router.get("/z-reports", response_model=list[ZReportOut])
def z_report_history(
    branch_id: int | None = None,
    limit: int = Query(60, ge=1, le=366),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    scoped = scope_branch(user, branch_id)
    stmt = select(ZReport).order_by(ZReport.business_date.desc(), ZReport.id.desc()).limit(limit)
    if scoped is not None:
        stmt = stmt.where(ZReport.branch_id == scoped)
    return db.scalars(stmt).unique().all()


# --------------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------------- #
@router.get("/dashboard", response_model=DashboardOut)
def dashboard(
    branch_id: int | None = Query(None, description="Omit (admin only) for all locations"),
    days: int = Query(14, ge=1, le=90),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "manager")),
):
    scoped = scope_branch(user, branch_id)

    branches = db.scalars(
        select(Branch).where(Branch.is_active.is_(True), *( [Branch.id == scoped] if scoped else [] )).order_by(Branch.id)
    ).all()
    branch_ids = [b.id for b in branches]

    today = today_local()
    first_day = today - timedelta(days=days - 1)
    p_start, p_end = day_start_utc(first_day), day_start_utc(today + timedelta(days=1))
    t_start, t_end = day_bounds(today)

    def sale_filter(start, end):
        return (Sale.branch_id.in_(branch_ids), Sale.created_at >= start, Sale.created_at < end)

    period = sale_filter(p_start, p_end)

    # Per-branch totals
    by_branch_rows = {
        r.branch_id: r
        for r in db.execute(
            select(Sale.branch_id, func.sum(Sale.total_amount).label("total"), func.count(Sale.id).label("n"))
            .where(*period).group_by(Sale.branch_id)
        )
    }
    by_branch = [
        BranchTotal(
            branch_id=b.id, branch_name=b.name,
            total=by_branch_rows[b.id].total if b.id in by_branch_rows else ZERO,
            receipts=by_branch_rows[b.id].n if b.id in by_branch_rows else 0,
        )
        for b in branches
    ]

    # Daily series per branch (grouped by LOCAL business date)
    local_day = cast(func.timezone(settings.business_timezone, Sale.created_at), Date)
    daily_rows = db.execute(
        select(local_day.label("d"), Sale.branch_id, func.sum(Sale.total_amount).label("total"))
        .where(*period).group_by("d", Sale.branch_id)
    ).all()
    lookup = {(r.d, r.branch_id): r.total for r in daily_rows}
    dates = [first_day + timedelta(days=i) for i in range(days)]
    daily = DailySales(
        dates=dates,
        series=[
            DailySeries(branch_id=b.id, branch_name=b.name, values=[lookup.get((d, b.id), ZERO) for d in dates])
            for b in branches
        ],
    )

    # KPIs
    today_row = db.execute(
        select(func.coalesce(func.sum(Sale.total_amount), 0), func.count(Sale.id)).where(*sale_filter(t_start, t_end))
    ).one()
    profit = db.scalar(
        select(func.coalesce(func.sum((SaleItem.unit_price - SaleItem.unit_cost) * SaleItem.quantity - SaleItem.discount_amount), 0))
        .join(Sale, SaleItem.sale_id == Sale.id).where(*period)
    )
    low_filter = (
        BranchInventory.branch_id.in_(branch_ids),
        BranchInventory.stock_quantity <= BranchInventory.min_threshold,
        Product.is_active.is_(True),
    )
    low_count = db.scalar(
        select(func.count()).select_from(BranchInventory).join(Product, BranchInventory.product_id == Product.id).where(*low_filter)
    )
    kpis = DashboardKpis(
        today_sales=today_row[0], today_receipts=today_row[1],
        period_sales=sum((b.total for b in by_branch), ZERO), period_receipts=sum(b.receipts for b in by_branch),
        period_profit=profit or ZERO, low_stock_count=low_count or 0,
    )

    # Top sellers
    qty = func.sum(SaleItem.quantity)
    revenue = func.sum(SaleItem.quantity * SaleItem.unit_price - SaleItem.discount_amount)
    base = (
        select(qty.label("q"), revenue.label("r"))
        .select_from(SaleItem)
        .join(Sale, SaleItem.sale_id == Sale.id)
        .join(Product, SaleItem.product_id == Product.id)
        .where(*period)
    )
    flavor_rows = db.execute(
        base.add_columns(Product.flavor).where(Product.flavor.is_not(None)).group_by(Product.flavor).order_by(desc("q")).limit(8)
    ).all()
    device_rows = db.execute(
        base.add_columns(Product.name).where(Product.category == "device").group_by(Product.name).order_by(desc("q")).limit(8)
    ).all()

    # Low stock list
    low_rows = db.execute(
        select(BranchInventory.product_id, Product.name, BranchInventory.branch_id, Branch.name,
               BranchInventory.stock_quantity, BranchInventory.min_threshold)
        .join(Product, BranchInventory.product_id == Product.id)
        .join(Branch, BranchInventory.branch_id == Branch.id)
        .where(*low_filter)
        .order_by((BranchInventory.stock_quantity - BranchInventory.min_threshold), Product.name)
        .limit(25)
    ).all()

    return DashboardOut(
        days=days, kpis=kpis, by_branch=by_branch, daily=daily,
        top_flavors=[TopItem(label=r.flavor, quantity=int(r.q), revenue=r.r) for r in flavor_rows],
        top_devices=[TopItem(label=r.name, quantity=int(r.q), revenue=r.r) for r in device_rows],
        low_stock=[LowStockItem(product_id=r[0], product_name=r[1], branch_id=r[2], branch_name=r[3],
                                stock_quantity=r[4], min_threshold=r[5]) for r in low_rows],
    )


# --------------------------------------------------------------------------- #
# Sales report (Reports page)
# --------------------------------------------------------------------------- #
@router.get("/sales-summary", response_model=SalesReportOut)
def sales_summary(
    date_from: date | None = Query(None, description="First local business day (default: 6 days ago)"),
    date_to: date | None = Query(None, description="Last local business day (default: today)"),
    branch_id: int | None = Query(None, description="Omit (admin only) for all locations"),
    product_id: int | None = None,
    category: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "manager")),
):
    """
    Sales between two business days, optionally for one product and/or category.

    Revenue = item prices after discounts and before tax, so it can be split by product and
    category (tax is per receipt). "Transactions" counts receipts that contain a matching item.
    """
    scoped = scope_branch(user, branch_id)
    today = today_local()
    date_to = date_to or today
    date_from = date_from or (date_to - timedelta(days=6))
    if date_to < date_from:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The end date is before the start date.")
    if (date_to - date_from).days > 365:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a range of one year or less.")

    start, end = day_start_utc(date_from), day_start_utc(date_to + timedelta(days=1))
    where = [Sale.created_at >= start, Sale.created_at < end]
    if scoped is not None:
        where.append(Sale.branch_id == scoped)
    if product_id is not None:
        where.append(SaleItem.product_id == product_id)
    if category:
        where.append(Product.category == category)

    net = SaleItem.quantity * SaleItem.unit_price - SaleItem.discount_amount
    base = select().select_from(SaleItem).join(Sale, SaleItem.sale_id == Sale.id).join(Product, SaleItem.product_id == Product.id).where(*where)

    t = db.execute(base.add_columns(
        func.coalesce(func.sum(net), 0), func.count(distinct(Sale.id)),
        func.coalesce(func.sum(SaleItem.quantity), 0), func.coalesce(func.sum(SaleItem.discount_amount), 0),
    )).one()
    revenue, transactions, items, discounts = t[0], int(t[1]), int(t[2]), t[3]
    totals = SalesReportTotals(
        revenue=revenue, transactions=transactions, items_sold=items, discounts=discounts,
        avg_transaction=(Decimal(revenue) / transactions).quantize(Decimal("0.01")) if transactions else ZERO,
    )

    local_day = cast(func.timezone(settings.business_timezone, Sale.created_at), Date)
    day_rows = {
        r.d: r
        for r in db.execute(base.add_columns(local_day.label("d"), func.sum(net).label("rev"), func.count(distinct(Sale.id)).label("n")).group_by("d"))
    }
    days = [date_from + timedelta(days=i) for i in range((date_to - date_from).days + 1)]
    daily = [
        SalesReportDay(date=d, revenue=day_rows[d].rev if d in day_rows else ZERO, transactions=int(day_rows[d].n) if d in day_rows else 0)
        for d in days
    ]

    qty = func.sum(SaleItem.quantity)
    top = db.execute(
        base.add_columns(Product.id, Product.name, Product.category, qty.label("q"), func.sum(net).label("rev"))
        .group_by(Product.id, Product.name, Product.category)
        .order_by(desc("q"), desc("rev"), Product.name).limit(10)
    ).all()
    cat_label = func.coalesce(Product.category, "Uncategorized")
    cats = db.execute(
        base.add_columns(cat_label.label("c"), qty.label("q"), func.sum(net).label("rev")).group_by("c").order_by(desc("rev"))
    ).all()

    return SalesReportOut(
        date_from=date_from, date_to=date_to, totals=totals, daily=daily,
        top_products=[SalesReportProduct(product_id=r[0], name=r[1], category=r[2], quantity=int(r.q), revenue=r.rev) for r in top],
        by_category=[SalesReportCategory(category=r.c, quantity=int(r.q), revenue=r.rev) for r in cats],
    )
