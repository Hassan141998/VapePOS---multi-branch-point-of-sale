"""
Test setup. Tests run against a REAL PostgreSQL database (row locking and
timezone SQL are PostgreSQL features), by default `vapepos_test` on localhost.
Override with TEST_DATABASE_URL.
"""
import os

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://vapepos:vapepos@localhost:5432/vapepos_test"
)
if "test" not in os.environ["DATABASE_URL"].rsplit("/", 1)[-1].split("?")[0]:
    raise SystemExit("Refusing to run: the tests WIPE their database, so its name must contain 'test'.")
os.environ["BUSINESS_TIMEZONE"] = "UTC"
os.environ["SECRET_KEY"] = "test-secret"

from decimal import Decimal  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app import models  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.security import hash_password  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture(autouse=True)
def _clean():
    with engine.begin() as conn:
        conn.execute(text(
            "TRUNCATE stock_transfer_events, stock_transfer_items, stock_transfers, stock_movements, sale_items, "
            "sales, z_reports, branch_inventory, discounts, categories, app_settings, products, users, branches RESTART IDENTITY CASCADE"
        ))
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class World:
    """Two branches (A, B), one admin, a manager + cashier per branch, two products."""


@pytest.fixture
def world():
    w = World()
    with SessionLocal() as db:
        w.a = models.Branch(name="Branch A", code="AA", tax_rate=Decimal("10"))
        w.b = models.Branch(name="Branch B", code="BB", tax_rate=Decimal("0"))
        db.add_all([w.a, w.b])
        db.flush()
        pw = hash_password("password1")
        db.add_all([
            models.User(username="admin", password_hash=pw, role="admin"),
            models.User(username="mgr_a", password_hash=pw, role="manager", branch_id=w.a.id),
            models.User(username="mgr_b", password_hash=pw, role="manager", branch_id=w.b.id),
            models.User(username="cash_a", password_hash=pw, role="cashier", branch_id=w.a.id),
            models.User(username="cash_b", password_hash=pw, role="cashier", branch_id=w.b.id),
        ])
        w.p1 = models.Product(barcode="111", name="Mango Ice 20mg", category="e-liquid", flavor="Mango Ice",
                              nicotine_type="salt", nicotine_strength="20mg",
                              buying_price=Decimal("4.00"), selling_price=Decimal("10.00"))
        w.p2 = models.Product(barcode="222", name="Pod Kit", category="device",
                              buying_price=Decimal("10.00"), selling_price=Decimal("25.50"))
        db.add_all([w.p1, w.p2])
        db.flush()
        for br in (w.a, w.b):
            for p in (w.p1, w.p2):
                db.add(models.BranchInventory(product_id=p.id, branch_id=br.id, stock_quantity=10, min_threshold=5))
        db.commit()
        for obj in (w.a, w.b, w.p1, w.p2):
            db.refresh(obj)
            db.expunge(obj)
    return w


def login(client, username, password="password1"):
    r = client.post("/api/v1/auth/login", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def stock(client, headers, branch_id, product_id):
    rows = client.get("/api/v1/inventory", params={"branch_id": branch_id}, headers=headers).json()
    return next(r["stock_quantity"] for r in rows if r["product"]["id"] == product_id)
