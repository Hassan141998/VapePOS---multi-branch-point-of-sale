"""
Data portability: back up or move a shop's data.

EXPORT (admin) -> a ZIP with `data.json` plus one CSV per table (open the CSVs in Excel), or just the JSON.
IMPORT (admin) -> MERGES catalogue data into the current database. Nothing is deleted, and rows are
matched by natural keys (branch code, product barcode, category name, discount code), never by id.

Imported: branches, categories, products, stock levels, discounts, settings.
Export only (kept for your records, not re-imported): staff accounts and sales history.
Passwords are never exported.
"""
from __future__ import annotations

import csv
import io
import json
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles
from app.models import AppSetting, Branch, BranchInventory, Category, Discount, Product, Sale, User
from app.realtime import manager
from app.routers.categories import ensure_category
from app.routers.settings import load_setting
from app.schemas import BranchIn, BusinessSettings, DiscountBase, ProductIn, ReceiptDesign
from app.services.inventory import (
    create_rows_for_new_branch, create_rows_for_new_product, lock_inventory_rows, record_movement,
)

router = APIRouter(prefix="/data", tags=["Data export & import"], dependencies=[Depends(require_roles("admin"))])

FORMAT_VERSION = 1
MAX_UPLOAD = 4 * 1024 * 1024  # Vercel rejects request bodies above ~4.5 MB anyway
MAX_UNZIPPED = 25 * 1024 * 1024


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #
def _num(v: Any) -> Any:
    return float(v) if isinstance(v, Decimal) else v


def _iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, (date, datetime)) else v


def _safe_cell(v: Any) -> Any:
    """Stop spreadsheets from running text such as '=HYPERLINK(...)' that came from user input."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def _csv(rows: list[dict], columns: list[str]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(columns)
    for r in rows:
        w.writerow([_safe_cell(_iso(_num(r.get(c)))) if r.get(c) is not None else "" for c in columns])
    return "\ufeff" + buf.getvalue()  # BOM so Excel opens UTF-8 correctly


def build_export(db: Session, include_sales: bool = True) -> dict[str, list[dict]]:
    branches = db.scalars(select(Branch).order_by(Branch.id)).all()
    code_of = {b.id: b.code for b in branches}
    products = db.scalars(select(Product).order_by(Product.id)).all()
    barcode_of = {p.id: p.barcode for p in products}

    tables: dict[str, list[dict]] = {
        "branches": [
            {"code": b.code, "name": b.name, "address": b.address, "phone": b.phone, "tax_number": b.tax_number,
             "tax_rate": _num(b.tax_rate), "receipt_header_text": b.receipt_header_text,
             "receipt_footer_text": b.receipt_footer_text, "is_active": b.is_active}
            for b in branches
        ],
        "categories": [
            {"name": c.name, "description": c.description}
            for c in db.scalars(select(Category).order_by(Category.name)).all()
        ],
        "products": [
            {"barcode": p.barcode, "name": p.name, "brand": p.brand, "category": p.category, "flavor": p.flavor,
             "nicotine_type": p.nicotine_type, "nicotine_strength": p.nicotine_strength,
             "coil_resistance_ohm": _num(p.coil_resistance_ohm), "device_variant": p.device_variant,
             "buying_price": _num(p.buying_price), "selling_price": _num(p.selling_price), "is_active": p.is_active}
            for p in products
        ],
        "inventory": [
            {"branch_code": code_of.get(i.branch_id), "barcode": barcode_of.get(i.product_id),
             "stock_quantity": i.stock_quantity, "min_threshold": i.min_threshold}
            for i in db.scalars(select(BranchInventory).order_by(BranchInventory.branch_id, BranchInventory.product_id)).unique().all()
        ],
        "discounts": [
            {"code": d.code, "name": d.name, "type": d.type, "value": _num(d.value), "applies_to": d.applies_to,
             "category": d.category, "product_barcode": barcode_of.get(d.product_id) if d.product_id else None,
             "min_purchase": _num(d.min_purchase), "starts_on": _iso(d.starts_on), "ends_on": _iso(d.ends_on),
             "is_active": d.is_active}
            for d in db.scalars(select(Discount).order_by(Discount.id)).unique().all()
        ],
        "users": [
            {"username": u.username, "full_name": u.full_name, "role": u.role,
             "branch_code": code_of.get(u.branch_id) if u.branch_id else None, "is_active": u.is_active}
            for u in db.scalars(select(User).order_by(User.id)).unique().all()
        ],
    }
    if include_sales:
        sales, sale_items = [], []
        for s in db.scalars(select(Sale).order_by(Sale.id)).unique().all():
            sales.append({
                "receipt_number": s.receipt_number, "branch_code": code_of.get(s.branch_id), "cashier": s.cashier_name,
                "created_at": _iso(s.created_at), "subtotal": _num(s.subtotal), "discount_amount": _num(s.discount_amount),
                "discount_code": s.discount_code, "tax_rate": _num(s.tax_rate), "tax_amount": _num(s.tax_amount),
                "total_amount": _num(s.total_amount), "payment_method": s.payment_method,
                "amount_tendered": _num(s.amount_tendered), "change_due": _num(s.change_due),
            })
            for it in s.items:
                sale_items.append({
                    "receipt_number": s.receipt_number, "barcode": barcode_of.get(it.product_id),
                    "product_name": it.product_name, "quantity": it.quantity, "unit_price": _num(it.unit_price),
                    "unit_cost": _num(it.unit_cost), "discount_amount": _num(it.discount_amount),
                })
        tables["sales"], tables["sale_items"] = sales, sale_items
    return tables


@router.get("/export")
def export_data(
    format: str = Query("zip", pattern="^(zip|json)$"),
    include_sales: bool = True,
    db: Session = Depends(get_db),
):
    tables = build_export(db, include_sales)
    payload = {
        "app": "VapePOS", "format": FORMAT_VERSION, "exported_at": datetime.now(timezone.utc).isoformat(),
        "settings": {
            "business": load_setting(db, "business", BusinessSettings).model_dump(mode="json"),
            "receipt": load_setting(db, "receipt", ReceiptDesign).model_dump(mode="json"),
        },
        **tables,
    }
    raw = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if format == "json":
        return Response(raw, media_type="application/json", headers={"Content-Disposition": f'attachment; filename="vapepos-export-{stamp}.json"'})

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("data.json", raw)
        z.writestr("README.txt", (
            "VapePOS export\n\n"
            "data.json  - everything, in one file. This is what 'Import' reads.\n"
            "*.csv      - the same tables for Excel / Google Sheets.\n\n"
            "Import restores branches, categories, products, stock levels, discounts and settings.\n"
            "Staff accounts and sales history are exported for your records but are not imported.\n"
            "Passwords are never exported.\n"
        ))
        for name, rows in tables.items():
            columns = list(rows[0].keys()) if rows else []
            if columns:
                z.writestr(f"{name}.csv", _csv(rows, columns))
    return Response(buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="vapepos-export-{stamp}.zip"'})


# --------------------------------------------------------------------------- #
# Import
# --------------------------------------------------------------------------- #
class InventoryRow(BaseModel):
    branch_code: str
    barcode: str
    stock_quantity: int = Field(ge=0, le=10_000_000)
    min_threshold: int = Field(default=5, ge=0, le=100_000)


class DiscountRow(BaseModel):
    code: str
    name: str
    type: str
    value: Decimal
    applies_to: str = "all"
    category: str | None = None
    product_barcode: str | None = None
    min_purchase: Decimal = Decimal("0")
    starts_on: date | None = None
    ends_on: date | None = None
    is_active: bool = True


def _read_payload(raw: bytes) -> dict:
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The file is larger than 4 MB. Export without sales history and try again.")
    try:
        if raw[:2] == b"PK":  # a ZIP
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                try:
                    info = z.getinfo("data.json")
                except KeyError:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, "This ZIP has no data.json. Use a file made by 'Export data'.") from None
                if info.file_size > MAX_UNZIPPED:
                    raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The data inside the ZIP is too large.")
                raw = z.read("data.json")
        data = json.loads(raw.decode("utf-8-sig"))
    except HTTPException:
        raise
    except (zipfile.BadZipFile, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This file is not a valid VapePOS export (ZIP or JSON).") from exc
    if not isinstance(data, dict) or data.get("app") != "VapePOS":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This file was not made by VapePOS 'Export data'.")
    return data


def _rows(data: dict, key: str) -> list[dict]:
    v = data.get(key) or []
    return [r for r in v if isinstance(r, dict)] if isinstance(v, list) else []


@router.post("/import")
def import_data(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles("admin")),
):
    data = _read_payload(file.file.read(MAX_UPLOAD + 1))
    created: dict[str, int] = {}
    updated: dict[str, int] = {}
    skipped: list[str] = []

    def bump(d: dict[str, int], key: str) -> None:
        d[key] = d.get(key, 0) + 1

    def skip(kind: str, label: str, exc: Exception | str) -> None:
        msg = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()) if isinstance(exc, ValidationError) else str(exc)
        if len(skipped) < 50:
            skipped.append(f"{kind} {label}: {msg}")

    try:
        # ---- branches (matched by code)
        for r in _rows(data, "branches"):
            try:
                row = BranchIn.model_validate(r)
            except ValidationError as exc:
                skip("branch", str(r.get("code")), exc)
                continue
            existing = db.scalar(select(Branch).where(func.lower(Branch.code) == row.code.lower()))
            clash = db.scalar(select(Branch.id).where(func.lower(Branch.name) == row.name.lower(), Branch.id != (existing.id if existing else 0)))
            if clash:
                skip("branch", row.code, "another branch already has this name")
                continue
            if existing:
                for k, v in row.model_dump().items():
                    setattr(existing, k, v)
                bump(updated, "branches")
            else:
                b = Branch(**row.model_dump())
                db.add(b)
                db.flush()
                create_rows_for_new_branch(db, b)
                bump(created, "branches")
        db.flush()

        # ---- categories (by name)
        for r in _rows(data, "categories"):
            name = str(r.get("name") or "").strip()[:50]
            if not name:
                continue
            cat = db.scalar(select(Category).where(Category.name == name))
            if cat:
                if r.get("description") is not None:
                    cat.description = str(r["description"])[:500] or None
                bump(updated, "categories")
            else:
                db.add(Category(name=name, description=(str(r["description"])[:500] if r.get("description") else None)))
                bump(created, "categories")
        db.flush()

        # ---- products (by barcode)
        for r in _rows(data, "products"):
            try:
                row = ProductIn.model_validate(r)
            except ValidationError as exc:
                skip("product", str(r.get("barcode")), exc)
                continue
            existing = db.scalar(select(Product).where(Product.barcode == row.barcode))
            if existing:
                for k, v in row.model_dump().items():
                    setattr(existing, k, v)
                bump(updated, "products")
            else:
                p = Product(**row.model_dump())
                db.add(p)
                db.flush()
                create_rows_for_new_product(db, p)
                bump(created, "products")
            ensure_category(db, row.category)
        db.flush()

        # ---- stock levels (by branch code + barcode)
        branch_by_code = {b.code.lower(): b for b in db.scalars(select(Branch)).all()}
        product_by_barcode = {p.barcode: p for p in db.scalars(select(Product)).all()}
        stock_rows: list[tuple[Branch, Product, InventoryRow]] = []
        for r in _rows(data, "inventory"):
            try:
                row = InventoryRow.model_validate(r)
            except ValidationError as exc:
                skip("stock", f"{r.get('branch_code')}/{r.get('barcode')}", exc)
                continue
            b, p = branch_by_code.get(row.branch_code.lower()), product_by_barcode.get(row.barcode)
            if not b or not p:
                skip("stock", f"{row.branch_code}/{row.barcode}", "unknown branch or product")
                continue
            stock_rows.append((b, p, row))
        locked = lock_inventory_rows(db, [(p.id, b.id) for b, p, _ in stock_rows])
        for b, p, row in stock_rows:
            inv = locked[(p.id, b.id)]
            delta = row.stock_quantity - inv.stock_quantity
            inv.min_threshold = row.min_threshold
            if delta:
                inv.stock_quantity = row.stock_quantity
                record_movement(db, product_id=p.id, branch_id=b.id, delta=delta, reason="adjustment",
                                ref_type="import", user_id=admin.id, note="Data import")
            bump(updated, "stock levels")

        # ---- discounts (by code)
        for r in _rows(data, "discounts"):
            try:
                raw_row = DiscountRow.model_validate(r)
                product_id = None
                if raw_row.applies_to == "product":
                    prod = product_by_barcode.get(raw_row.product_barcode or "")
                    if not prod:
                        raise ValueError("unknown product barcode")
                    product_id = prod.id
                row = DiscountBase.model_validate({**raw_row.model_dump(), "product_id": product_id})
            except (ValidationError, ValueError) as exc:
                skip("discount", str(r.get("code")), exc)
                continue
            values = row.model_dump()
            values["code"] = row.code.upper()
            if row.applies_to == "category":
                ensure_category(db, row.category)
            existing = db.scalar(select(Discount).where(Discount.code == values["code"]))
            if existing:
                for k, v in values.items():
                    setattr(existing, k, v)
                bump(updated, "discounts")
            else:
                db.add(Discount(**values))
                bump(created, "discounts")

        # ---- settings
        st = data.get("settings")
        if isinstance(st, dict):
            for key, model in (("business", BusinessSettings), ("receipt", ReceiptDesign)):
                if isinstance(st.get(key), dict):
                    try:
                        _put_setting(db, key, model.model_validate(st[key]))
                        bump(updated, "settings")
                    except ValidationError as exc:
                        skip("settings", key, exc)
        db.commit()
    except Exception:
        db.rollback()
        raise

    for evt in ("branch.updated", "product.updated", "category.updated", "discount.updated", "settings.updated"):
        background.add_task(manager.publish, evt, [], {})
    background.add_task(manager.publish, "inventory.changed", [], {})
    return {"created": created, "updated": updated, "skipped": skipped}



def _put_setting(db: Session, key: str, value: BaseModel) -> None:
    """Upsert a settings row without committing (the import commits once at the end)."""
    payload = value.model_dump(mode="json")
    row = db.get(AppSetting, key)
    if row:
        row.value = payload
    else:
        db.add(AppSetting(key=key, value=payload))
