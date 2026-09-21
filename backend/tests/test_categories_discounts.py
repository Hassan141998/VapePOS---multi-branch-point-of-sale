from datetime import date, timedelta

from tests.conftest import login, stock

API = "/api/v1"
YESTERDAY, TOMORROW = (date.today() - timedelta(days=1)).isoformat(), (date.today() + timedelta(days=1)).isoformat()


def make_discount(client, headers, **over):
    body = {"name": "Ten off", "code": "TEN", "type": "percent", "value": 10, "applies_to": "all", **over}
    return client.post(f"{API}/discounts", headers=headers, json=body)


def sell(client, headers, items, **extra):
    return client.post(f"{API}/sales", headers=headers, json={"items": [{"product_id": p, "quantity": q} for p, q in items], **extra})


# ------------------------------------------------------------------ categories
def test_categories_list_counts_and_syncs_from_products(client, world):
    cashier = login(client, "cash_a")                       # everyone may read the list
    rows = {c["name"]: c for c in client.get(f"{API}/categories", headers=cashier).json()}
    assert rows["e-liquid"]["product_count"] == 1 and rows["device"]["product_count"] == 1


def test_only_admin_manages_categories_and_names_are_unique(client, world):
    adm, mgr = login(client, "admin"), login(client, "mgr_a")
    assert client.post(f"{API}/categories", headers=mgr, json={"name": "Nope"}).status_code == 403
    made = client.post(f"{API}/categories", headers=adm, json={"name": "Merch", "description": "T-shirts"})
    assert made.status_code == 201 and made.json()["product_count"] == 0
    assert client.post(f"{API}/categories", headers=adm, json={"name": "merch"}).status_code == 409  # case-insensitive
    assert client.post(f"{API}/categories", headers=adm, json={"name": "   "}).status_code in (400, 422)


def test_renaming_a_category_moves_its_products_and_blocks_delete_while_in_use(client, world):
    adm = login(client, "admin")
    cat = next(c for c in client.get(f"{API}/categories", headers=adm).json() if c["name"] == "device")
    r = client.put(f"{API}/categories/{cat['id']}", headers=adm, json={"name": "hardware"})
    assert r.status_code == 200 and r.json()["product_count"] == 1
    assert client.get(f"{API}/products", headers=adm, params={"category": "hardware"}).json()[0]["name"] == "Pod Kit"
    assert client.delete(f"{API}/categories/{cat['id']}", headers=adm).status_code == 409
    empty = client.post(f"{API}/categories", headers=adm, json={"name": "Temp"}).json()
    assert client.delete(f"{API}/categories/{empty['id']}", headers=adm).status_code == 204


def test_new_product_with_a_new_category_registers_it(client, world):
    adm = login(client, "admin")
    r = client.post(f"{API}/products", headers=adm, json={
        "barcode": "333", "name": "Sticker", "category": "merch", "buying_price": 1, "selling_price": 2})
    assert r.status_code == 201
    assert "merch" in [c["name"] for c in client.get(f"{API}/categories", headers=adm).json()]


# ------------------------------------------------------------------ discount management
def test_discount_validation_and_permissions(client, world):
    adm, mgr, cash = login(client, "admin"), login(client, "mgr_a"), login(client, "cash_a")
    assert make_discount(client, mgr).status_code == 403
    assert make_discount(client, adm, value=150).status_code == 422                         # > 100 %
    assert make_discount(client, adm, applies_to="category").status_code == 422             # needs a category
    assert make_discount(client, adm, applies_to="product").status_code == 422              # needs a product
    assert make_discount(client, adm, applies_to="product", product_id=9999).status_code == 400
    assert make_discount(client, adm, starts_on=TOMORROW, ends_on=YESTERDAY).status_code == 422
    ok = make_discount(client, adm, code="ten")
    assert ok.status_code == 201 and ok.json()["code"] == "TEN" and ok.json()["status"] == "active"
    assert make_discount(client, adm, name="Again", code="TEN").status_code == 409          # codes are unique
    assert client.delete(f"{API}/discounts/{ok.json()['id']}", headers=cash).status_code == 403


def test_status_and_cashier_only_sees_active_discounts(client, world):
    adm, cash, mgr = login(client, "admin"), login(client, "cash_a"), login(client, "mgr_a")
    make_discount(client, adm, code="NOW")
    make_discount(client, adm, name="Soon", code="SOON", starts_on=TOMORROW)
    make_discount(client, adm, name="Old", code="OLD", ends_on=YESTERDAY)
    make_discount(client, adm, name="Off", code="OFF", is_active=False)
    by_code = {d["code"]: d["status"] for d in client.get(f"{API}/discounts", headers=mgr).json()}
    assert by_code == {"NOW": "active", "SOON": "scheduled", "OLD": "expired", "OFF": "disabled"}
    assert [d["code"] for d in client.get(f"{API}/discounts", headers=cash).json()] == ["NOW"]


def test_update_and_delete_discount(client, world):
    adm = login(client, "admin")
    d = make_discount(client, adm).json()
    body = {"name": "Twenty off", "code": "TEN", "type": "percent", "value": 20, "applies_to": "all"}
    assert client.put(f"{API}/discounts/{d['id']}", headers=adm, json=body).json()["value"] == 20
    assert client.delete(f"{API}/discounts/{d['id']}", headers=adm).status_code == 204
    assert client.get(f"{API}/discounts", headers=adm).json() == []


# ------------------------------------------------------------------ discounts at the till
def test_percent_discount_on_a_sale(client, world):
    adm, cash = login(client, "admin"), login(client, "cash_a")           # branch A: 10 % tax
    make_discount(client, adm, value=10)
    r = sell(client, cash, [(world.p1.id, 2), (world.p2.id, 1)], discount_code="ten")   # 20.00 + 25.50
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["discount_amount"] == 4.55 and s["discount_code"] == "TEN" and s["discount_name"] == "Ten off"
    assert s["subtotal"] == 40.95 and s["tax_amount"] == 4.10 and s["total_amount"] == 45.05   # net + tax
    assert round(s["subtotal"] + s["tax_amount"], 2) == s["total_amount"]
    assert [round(i["discount_amount"], 2) for i in s["items"]] == [2.0, 2.55]
    assert stock(client, adm, world.a.id, world.p1.id) == 8
    again = client.get(f"{API}/sales/{s['id']}", headers=cash).json()
    assert again["discount_amount"] == 4.55


def test_category_product_and_fixed_discounts(client, world):
    adm, cash = login(client, "admin"), login(client, "cash_b")           # branch B: no tax
    make_discount(client, adm, code="DEV", name="Devices", applies_to="category", category="device", value=20)
    make_discount(client, adm, code="MANGO", name="Mango", applies_to="product", product_id=world.p1.id, type="fixed", value=3)
    dev = sell(client, cash, [(world.p1.id, 1), (world.p2.id, 1)], discount_code="DEV").json()
    assert dev["discount_amount"] == 5.10 and dev["total_amount"] == 35.5 - 5.10
    fixed = sell(client, cash, [(world.p1.id, 1), (world.p2.id, 1)], discount_code="MANGO").json()
    assert fixed["discount_amount"] == 3.0 and fixed["total_amount"] == 32.5


def test_discount_rejections(client, world):
    adm, cash = login(client, "admin"), login(client, "cash_a")
    make_discount(client, adm, code="OLD", ends_on=YESTERDAY)
    make_discount(client, adm, code="OFF", is_active=False)
    make_discount(client, adm, code="BIG", min_purchase=100)
    make_discount(client, adm, code="DEV", applies_to="category", category="device")
    for code in ("NOPE", "OLD", "OFF"):
        r = sell(client, cash, [(world.p1.id, 1)], discount_code=code)
        assert r.status_code == 400 and "not valid" in r.json()["detail"], code
    assert "at least" in sell(client, cash, [(world.p1.id, 1)], discount_code="BIG").json()["detail"]
    assert "does not apply" in sell(client, cash, [(world.p1.id, 1)], discount_code="DEV").json()["detail"]
    assert stock(client, adm, world.a.id, world.p1.id) == 10                 # nothing was sold


def test_discount_shows_in_end_of_day_totals_and_lowers_profit(client, world):
    adm, cash = login(client, "admin"), login(client, "cash_b")             # no tax keeps the numbers simple
    make_discount(client, adm, value=50)
    sell(client, cash, [(world.p1.id, 2)], discount_code="TEN")             # 20.00 sale, 10.00 off, cost 8.00
    z = client.get(f"{API}/reports/z-report", headers=cash).json()["totals"]
    assert z["subtotal"] == 10.0 and z["tax_total"] == 0 and z["gross_total"] == 10.0
    kpis = client.get(f"{API}/reports/dashboard", headers=adm, params={"branch_id": world.b.id}).json()["kpis"]
    assert kpis["period_profit"] == 2.0                                     # 10.00 net - 8.00 cost
