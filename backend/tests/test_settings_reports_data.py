import io
import json
import zipfile
from datetime import date, timedelta

from sqlalchemy import text

from app.database import engine
from tests.conftest import login, stock

API = "/api/v1"


def sell(client, headers, items, **extra):
    return client.post(f"{API}/sales", headers=headers, json={"items": [{"product_id": p, "quantity": q} for p, q in items], **extra})


# ------------------------------------------------------------------ settings
def test_settings_defaults_permissions_and_validation(client, world):
    adm, mgr, cash = login(client, "admin"), login(client, "mgr_a"), login(client, "cash_a")
    got = client.get(f"{API}/settings", headers=cash).json()                  # the till needs these to print receipts
    assert got["business"]["currency"] == "PKR" and got["business"]["currency_symbol"] == "Rs" and got["receipt"]["width_px"] == 300 and got["timezone"]

    assert client.put(f"{API}/settings/business", headers=mgr, json={"business_name": "X"}).status_code == 403
    assert client.put(f"{API}/settings/receipt", headers=cash, json={}).status_code == 403
    ok = client.put(f"{API}/settings/business", headers=adm, json={"business_name": "Cloud Nine", "currency": "pkr", "currency_symbol": "Rs"})
    assert ok.status_code == 200 and ok.json()["currency"] == "PKR"
    assert client.put(f"{API}/settings/business", headers=adm, json={"business_name": "X", "currency": "DOLLARS"}).status_code == 422
    assert client.put(f"{API}/settings/receipt", headers=adm, json={"width_px": 50}).status_code == 422
    assert client.put(f"{API}/settings/receipt", headers=adm, json={"logo_data_url": "data:text/html;base64,AAAA"}).status_code == 422
    r = client.put(f"{API}/settings/receipt", headers=adm, json={"width_px": 280, "show_address": True, "footer_text": "Thanks!"})
    assert r.status_code == 200
    again = client.get(f"{API}/settings", headers=cash).json()
    assert again["business"]["business_name"] == "Cloud Nine" and again["receipt"]["footer_text"] == "Thanks!"
    assert again["receipt"]["show_tax_number"] is True                          # untouched fields keep their defaults


# ------------------------------------------------------------------ sales list filters
def test_sales_list_filters(client, world):
    cash = login(client, "cash_a")
    sale = sell(client, cash, [(world.p1.id, 1)]).json()
    today = date.today().isoformat()
    assert len(client.get(f"{API}/sales", headers=cash, params={"date_from": today, "date_to": today}).json()) == 1
    assert client.get(f"{API}/sales", headers=cash, params={"date_to": (date.today() - timedelta(days=5)).isoformat()}).json() == []
    assert len(client.get(f"{API}/sales", headers=cash, params={"search": sale["receipt_number"][3:8].lower()}).json()) == 1
    assert client.get(f"{API}/sales", headers=cash, params={"search": "zzzz"}).json() == []


# ------------------------------------------------------------------ sales report
def test_sales_summary_totals_filters_and_scoping(client, world):
    adm, mgr_a, cash_a, cash_b = login(client, "admin"), login(client, "mgr_a"), login(client, "cash_a"), login(client, "cash_b")
    client.post(f"{API}/discounts", headers=adm, json={"name": "Half", "code": "HALF", "type": "percent", "value": 50, "applies_to": "all"})
    sell(client, cash_a, [(world.p1.id, 2), (world.p2.id, 1)])                  # 20.00 + 25.50 = 45.50 at branch A
    sell(client, cash_b, [(world.p1.id, 1)], discount_code="HALF")              # 10.00 - 5.00 = 5.00 at branch B

    r = client.get(f"{API}/reports/sales-summary", headers=adm).json()
    t = r["totals"]
    assert t["revenue"] == 50.5 and t["transactions"] == 2 and t["items_sold"] == 4 and t["discounts"] == 5.0
    assert t["avg_transaction"] == 25.25
    assert len(r["daily"]) == 7 and r["daily"][-1]["revenue"] == 50.5 and r["daily"][-1]["transactions"] == 2
    assert r["daily"][0]["revenue"] == 0
    assert r["top_products"][0]["name"] == "Mango Ice 20mg" and r["top_products"][0]["quantity"] == 3
    assert {c["category"]: c["revenue"] for c in r["by_category"]} == {"e-liquid": 25.0, "device": 25.5}

    only_dev = client.get(f"{API}/reports/sales-summary", headers=adm, params={"category": "device"}).json()["totals"]
    assert only_dev["revenue"] == 25.5 and only_dev["transactions"] == 1
    only_p1 = client.get(f"{API}/reports/sales-summary", headers=adm, params={"product_id": world.p1.id, "branch_id": world.b.id}).json()["totals"]
    assert only_p1["revenue"] == 5.0 and only_p1["transactions"] == 1

    mine = client.get(f"{API}/reports/sales-summary", headers=mgr_a).json()["totals"]        # manager: own branch only
    assert mine["revenue"] == 45.5 and mine["transactions"] == 1
    assert client.get(f"{API}/reports/sales-summary", headers=mgr_a, params={"branch_id": world.b.id}).status_code == 403
    assert client.get(f"{API}/reports/sales-summary", headers=cash_a).status_code == 403


def test_sales_summary_date_rules(client, world):
    adm = login(client, "admin")
    empty = client.get(f"{API}/reports/sales-summary", headers=adm).json()
    assert empty["totals"]["transactions"] == 0 and empty["totals"]["avg_transaction"] == 0 and empty["top_products"] == []
    bad = {"date_from": "2026-05-10", "date_to": "2026-05-01"}
    assert client.get(f"{API}/reports/sales-summary", headers=adm, params=bad).status_code == 400
    wide = {"date_from": "2024-01-01", "date_to": "2026-05-01"}
    assert client.get(f"{API}/reports/sales-summary", headers=adm, params=wide).status_code == 400


# ------------------------------------------------------------------ export
def test_export_zip_and_json_contents(client, world):
    adm, cash = login(client, "admin"), login(client, "cash_a")
    client.post(f"{API}/discounts", headers=adm, json={"name": "Ten", "code": "TEN", "type": "percent", "value": 10, "applies_to": "product", "product_id": world.p1.id})
    sell(client, cash, [(world.p1.id, 1)], discount_code="TEN")

    r = client.get(f"{API}/data/export", headers=adm)
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert {"data.json", "README.txt", "products.csv", "sales.csv", "sale_items.csv", "inventory.csv", "discounts.csv", "users.csv"} <= set(z.namelist())
    data = json.loads(z.read("data.json"))
    assert data["app"] == "VapePOS" and len(data["products"]) == 2 and len(data["sales"]) == 1
    assert data["sales"][0]["discount_code"] == "TEN" and data["discounts"][0]["product_barcode"] == world.p1.barcode
    assert "password" not in z.read("data.json").decode().lower()                   # never exported
    assert "password" not in z.read("users.csv").decode().lower()
    assert z.read("products.csv").decode("utf-8-sig").splitlines()[0].startswith("barcode,name")

    lean = client.get(f"{API}/data/export", headers=adm, params={"include_sales": False, "format": "json"})
    assert lean.headers["content-type"] == "application/json" and "sales" not in lean.json()
    assert client.get(f"{API}/data/export", headers=login(client, "mgr_a")).status_code == 403


def test_export_neutralises_spreadsheet_formulas(client, world):
    adm = login(client, "admin")
    client.post(f"{API}/products", headers=adm, json={"barcode": "555", "name": "=HYPERLINK(\"http://evil\")", "buying_price": 1, "selling_price": 2})
    z = zipfile.ZipFile(io.BytesIO(client.get(f"{API}/data/export", headers=adm).content))
    assert "'=HYPERLINK" in z.read("products.csv").decode("utf-8-sig")


# ------------------------------------------------------------------ import
def upload(client, headers, content: bytes, name="data.json"):
    return client.post(f"{API}/data/import", headers=headers, files={"file": (name, content)})


def test_import_round_trip_restores_the_catalogue(client, world):
    adm = login(client, "admin")
    client.put(f"{API}/settings/business", headers=adm, json={"business_name": "Cloud Nine", "currency": "GBP"})
    client.post(f"{API}/discounts", headers=adm, json={"name": "Ten", "code": "TEN", "type": "percent", "value": 10})
    client.post(f"{API}/inventory/adjust", headers=adm, json={"branch_id": world.a.id, "product_id": world.p1.id, "set_to": 42})
    blob = client.get(f"{API}/data/export", headers=adm).content

    # wipe the catalogue side, keep users so we can stay logged in
    with engine.begin() as c:
        c.execute(text("TRUNCATE sale_items, sales, stock_movements, branch_inventory, discounts, categories, app_settings, products RESTART IDENTITY CASCADE"))
    assert client.get(f"{API}/products", headers=adm).json() == []

    r = upload(client, adm, blob, "export.zip")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["created"]["products"] == 2 and out["created"]["discounts"] == 1 and out["skipped"] == []
    names = {p["name"]: p for p in client.get(f"{API}/products", headers=adm).json()}
    assert set(names) == {"Mango Ice 20mg", "Pod Kit"} and names["Pod Kit"]["buying_price"] == 10.0
    assert stock(client, adm, world.a.id, world.p1.id) == 42
    assert [d["code"] for d in client.get(f"{API}/discounts", headers=adm).json()] == ["TEN"]
    assert client.get(f"{API}/settings", headers=adm).json()["business"]["currency"] == "GBP"
    assert {c["name"] for c in client.get(f"{API}/categories", headers=adm).json()} >= {"e-liquid", "device"}


def test_import_merges_updates_and_reports_bad_rows(client, world):
    adm = login(client, "admin")
    payload = {"app": "VapePOS", "format": 1,
               "products": [
                   {"barcode": world.p1.barcode, "name": "Mango Ice 20mg", "category": "e-liquid", "buying_price": 4, "selling_price": 12.5},
                   {"barcode": "NEW1", "name": "Fresh item", "category": "merch", "buying_price": 1, "selling_price": 3},
                   {"barcode": "BAD", "name": "Negative", "buying_price": -1, "selling_price": 3}],
               "inventory": [{"branch_code": world.a.code, "barcode": "NEW1", "stock_quantity": 7},
                             {"branch_code": "ZZ", "barcode": "NEW1", "stock_quantity": 1}],
               "discounts": [{"code": "P", "name": "Bad product", "type": "fixed", "value": 1, "applies_to": "product", "product_barcode": "nope"}]}
    r = upload(client, adm, json.dumps(payload).encode())
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["created"]["products"] == 1 and out["updated"]["products"] == 1
    assert any("BAD" in s for s in out["skipped"]) and any("ZZ" in s for s in out["skipped"]) and any("nope" in s or "P:" in s for s in out["skipped"])
    prods = {p["barcode"]: p for p in client.get(f"{API}/products", headers=adm).json()}
    assert prods[world.p1.barcode]["selling_price"] == 12.5 and "BAD" not in prods
    new_id = prods["NEW1"]["id"]
    assert stock(client, adm, world.a.id, new_id) == 7 and stock(client, adm, world.b.id, new_id) == 0
    assert stock(client, adm, world.a.id, world.p1.id) == 10                          # untouched


def test_import_rejects_bad_files_and_non_admins(client, world):
    adm = login(client, "admin")
    assert upload(client, adm, b"not json").status_code == 400
    assert upload(client, adm, b'{"hello": 1}').status_code == 400                   # not made by VapePOS
    bad_zip = io.BytesIO()
    with zipfile.ZipFile(bad_zip, "w") as z:
        z.writestr("other.txt", "x")
    assert upload(client, adm, bad_zip.getvalue()).status_code == 400
    assert upload(client, adm, b"x" * (4 * 1024 * 1024 + 10)).status_code == 413
    assert upload(client, login(client, "mgr_a"), b"{}").status_code == 403
