"""
Demo data: 4 branches, staff accounts, ~40 products, per-branch stock,
3 weeks of sales history and two example transfers.

    python -m app.seed            # only seeds an EMPTY database
    python -m app.seed --reset    # wipes all data first (asks you to type RESET; add --yes to skip)

Demo logins (change them before going live):
    admin      / admin1234
    manager1-4 / manager1234       (each locked to one branch)
    cashier1-4 / cashier1234       (each locked to one branch)
"""
from __future__ import annotations

import random
import sys
from datetime import datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select, text

from app.database import SessionLocal
from app.models import (
    Branch, BranchInventory, Product, Sale, SaleItem, StockTransfer, StockTransferEvent,
    StockTransferItem, User,
)
from app.security import hash_password
from app.services.timeutils import today_local, tz

random.seed(42)

FOOTER = "Must be 21+ with valid ID. Opened e-liquids cannot be returned. Thank you!"

BRANCHES = [
    ("Downtown Flagship", "DT", "120 Market Street", "555-0101", "TX-1001", "8.25", 1.4),
    ("Riverside", "RS", "48 Riverfront Drive", "555-0102", "TX-1002", "8.25", 1.0),
    ("Airport Road", "AR", "9 Airport Road", "555-0103", "TX-1003", "7.00", 0.7),
    ("University Avenue", "UN", "310 University Avenue", "555-0104", "TX-1004", "8.25", 0.9),
]

# (name, brand, category, flavor, nic_type, nic_strength, coil_ohm, variant, cost, price)
PRODUCTS: list[tuple] = []


def _add(*row):
    PRODUCTS.append(row)


for variant in ("Matte Black", "Silver", "Teal"):
    _add(f"Voltrix Pod Kit - {variant}", "Voltrix", "device", None, "none", None, None, variant, 14.0, 29.99)
for variant in ("Black", "Gunmetal"):
    _add(f"Nimbus Mod 80W - {variant}", "Nimbus", "device", None, "none", None, None, variant, 26.0, 54.99)
_add("Ember Starter Vape Pen", "Ember & Oak", "device", None, "none", None, None, "Kit", 9.0, 19.99)

_add("Voltrix Replacement Pod (2 pack)", "Voltrix", "pod", None, "none", None, None, None, 4.5, 9.99)
for ohm, price in ((0.4, 11.99), (0.6, 11.99), (0.8, 10.99)):
    _add(f"Nimbus Mesh Coil {ohm}ohm (5 pack)", "Nimbus", "coil", None, "none", None, ohm, None, 5.5, price)
_add("Voltrix Coil 1.0ohm (3 pack)", "Voltrix", "coil", None, "none", None, 1.0, None, 3.5, 7.99)

LIQUID_FLAVORS = ["Mango Ice", "Mint", "Blue Razz", "Strawberry Kiwi", "Vanilla Custard", "Watermelon Chill"]
for flavor in LIQUID_FLAVORS:
    _add(f"Cloudline E-Liquid 60ml - {flavor}", "Cloudline", "e-liquid", flavor, "freebase", "3mg", None, None, 6.0, 17.99)
    _add(f"Cloudline Salt Nic 30ml - {flavor}", "Cloudline", "e-liquid", flavor, "salt", "20mg", None, None, 5.5, 15.99)
for flavor in ("Mango Ice", "Mint", "Tobacco Classic"):
    _add(f"Cloudline Salt Nic 30ml (50mg) - {flavor}", "Cloudline", "e-liquid", flavor, "salt", "50mg", None, None, 5.5, 16.99)

for flavor in ("Mango Ice", "Peach Tea", "Blue Razz", "Mint", "Strawberry Kiwi", "Watermelon Chill"):
    _add(f"Ember Disposable 5000 - {flavor}", "Ember & Oak", "disposable", flavor, "salt", "50mg", None, None, 8.0, 19.99)

_add("USB-C Charging Cable", "Voltrix", "accessory", None, "none", None, None, None, 1.2, 6.99)
_add("18650 Battery (2 pack)", "Nimbus", "accessory", None, "none", None, None, None, 7.0, 16.99)
_add("Carry Case", "Nimbus", "accessory", None, "none", None, None, "Black", 3.0, 9.99)

CENT = Decimal("0.01")


def money(x) -> Decimal:
    return Decimal(str(x)).quantize(CENT, rounding=ROUND_HALF_UP)


def reset(db) -> None:
    tables = (
        "stock_transfer_events, stock_transfer_items, stock_transfers, stock_movements, sale_items, sales, "
        "z_reports, branch_inventory, products, users, branches"
    )
    db.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    db.commit()


def seed(db) -> None:
    # ---- branches ----------------------------------------------------------
    branches: list[Branch] = []
    weights: dict[int, float] = {}
    for name, code, addr, phone, tax_no, tax_rate, weight in BRANCHES:
        b = Branch(
            name=name, code=code, address=addr, phone=phone, tax_number=tax_no, tax_rate=Decimal(tax_rate),
            receipt_header_text=f"HAZE & CO.\n{name}\n{addr}\nTel {phone}", receipt_footer_text=FOOTER,
        )
        db.add(b)
        branches.append(b)
    db.flush()
    for b, row in zip(branches, BRANCHES):
        weights[b.id] = row[-1]

    # ---- users -------------------------------------------------------------
    db.add(User(username="admin", full_name="Head Office Admin", password_hash=hash_password("admin1234"), role="admin"))
    for i, b in enumerate(branches, start=1):
        db.add(User(username=f"manager{i}", full_name=f"{b.name} Manager", role="manager", branch_id=b.id,
                    password_hash=hash_password("manager1234")))
        db.add(User(username=f"cashier{i}", full_name=f"{b.name} Cashier", role="cashier", branch_id=b.id,
                    password_hash=hash_password("cashier1234")))
    db.flush()

    # ---- products ----------------------------------------------------------
    products: list[Product] = []
    for n, (name, brand, cat, flavor, nic_type, nic, ohm, variant, cost, price) in enumerate(PRODUCTS, start=1):
        p = Product(
            barcode=f"880100{n:06d}", name=name, brand=brand, category=cat, flavor=flavor, nicotine_type=nic_type,
            nicotine_strength=nic, coil_resistance_ohm=Decimal(str(ohm)) if ohm else None, device_variant=variant,
            buying_price=money(cost), selling_price=money(price),
        )
        db.add(p)
        products.append(p)
    db.flush()

    # ---- per-branch inventory ---------------------------------------------
    inventory: dict[tuple[int, int], BranchInventory] = {}
    for b in branches:
        for p in products:
            low = random.random() < 0.12  # ~12% of items are running low, so alerts have something to show
            qty = random.randint(0, 5) if low else random.randint(8, 45)
            inv = BranchInventory(product_id=p.id, branch_id=b.id, stock_quantity=qty,
                                  min_threshold=3 if p.category == "device" else 5)
            db.add(inv)
            inventory[(p.id, b.id)] = inv
    db.flush()

    # ---- sales history (written directly; does not touch stock) -----------
    popularity = {p.id: random.uniform(0.3, 1.0) * (1.8 if p.category in ("e-liquid", "disposable") else 1.0) for p in products}
    pids = [p.id for p in products]
    by_id = {p.id: p for p in products}
    zone = tz()
    cashier_of = {
        u.branch_id: u.id for u in db.scalars(select(User).where(User.role == "cashier")).all()
    }
    now = datetime.now(timezone.utc)
    today = today_local()
    counter = 0
    for offset in range(20, -1, -1):
        day = today - timedelta(days=offset)
        weekend = day.weekday() >= 4
        for b in branches:
            receipts = int(random.uniform(14, 22) * weights[b.id] * (1.35 if weekend else 1.0))
            for _ in range(receipts):
                hour, minute = random.randint(10, 21), random.randint(0, 59)
                ts = datetime.combine(day, time(hour, minute, random.randint(0, 59)), tzinfo=zone).astimezone(timezone.utc)
                if ts > now:
                    continue
                cart = {}
                for pid in random.choices(pids, weights=[popularity[i] for i in pids], k=random.randint(1, 3)):
                    cart[pid] = cart.get(pid, 0) + random.choice((1, 1, 1, 2))
                subtotal = money(sum(by_id[pid].selling_price * q for pid, q in cart.items()))
                tax = money(subtotal * b.tax_rate / 100)
                total = subtotal + tax
                method = random.choices(("card", "cash"), weights=(6, 4))[0]
                counter += 1
                sale = Sale(
                    receipt_number=f"{b.code}-{ts:%y%m%d}-H{counter:05d}", branch_id=b.id, cashier_id=cashier_of[b.id],
                    subtotal=subtotal, tax_rate=b.tax_rate, tax_amount=tax, total_amount=total,
                    payment_method=method, amount_tendered=total, change_due=Decimal("0.00"), created_at=ts,
                )
                sale.items = [
                    SaleItem(product_id=pid, product_name=by_id[pid].name, quantity=q,
                             unit_price=by_id[pid].selling_price, unit_cost=by_id[pid].buying_price)
                    for pid, q in cart.items()
                ]
                db.add(sale)
    db.flush()

    # ---- two example transfers --------------------------------------------
    admin = db.scalar(select(User).where(User.username == "admin"))
    dt, rs, ar, un = branches

    def transfer(src: Branch, dst: Branch, status: str, picks: list[tuple[Product, int]], events: list[str]) -> None:
        t = StockTransfer(from_branch_id=src.id, to_branch_id=dst.id, status=status, created_by=admin.id,
                          note="Demo transfer")
        t.items = [StockTransferItem(product_id=p.id, quantity=q) for p, q in picks]
        t.events = [StockTransferEvent(status=s, user_id=admin.id) for s in events]
        db.add(t)

    transfer(dt, rs, "pending", [(products[9], 6), (products[10], 4)], ["pending"])
    transfer(ar, un, "in_transit", [(products[0], 2)], ["pending", "in_transit"])
    # make sure the demo transfers are actually possible
    for pid, src in ((products[9].id, dt.id), (products[10].id, dt.id), (products[0].id, ar.id)):
        inventory[(pid, src)].stock_quantity = max(inventory[(pid, src)].stock_quantity, 20)
    db.commit()


def main() -> None:
    with SessionLocal() as db:
        if "--reset" in sys.argv:
            if "--yes" not in sys.argv:
                host = db.get_bind().url.render_as_string(hide_password=True)
                answer = input(f"This ERASES ALL DATA in {host}\nType RESET to continue: ")
                if answer.strip() != "RESET":
                    print("Cancelled.")
                    return
            reset(db)
        if db.scalar(select(Branch.id).limit(1)):
            print("Database already has data. Use --reset to wipe it first.")
            return
        seed(db)
        print("Seeded 4 branches, users, products, inventory, sales history and 2 transfers.")
        print("Logins: admin/admin1234, manager1-4/manager1234, cashier1-4/cashier1234")


if __name__ == "__main__":
    main()
