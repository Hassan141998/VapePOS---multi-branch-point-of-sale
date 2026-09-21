from concurrent.futures import ThreadPoolExecutor

from tests.conftest import login, stock

API = "/api/v1"


def sell(client, headers, product_id, qty=1, **extra):
    return client.post(f"{API}/sales", headers=headers, json={"items": [{"product_id": product_id, "quantity": qty}], **extra})


def test_sale_math_and_stock_decrement(client, world):
    h = login(client, "cash_a")  # branch A has 10% tax
    r = client.post(f"{API}/sales", headers=h, json={
        "items": [{"product_id": world.p1.id, "quantity": 2}, {"product_id": world.p2.id, "quantity": 1}],
        "payment_method": "cash", "amount_tendered": 60,
    })
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["subtotal"] == 45.5 and s["tax_amount"] == 4.55 and s["total_amount"] == 50.05
    assert s["change_due"] == 9.95
    assert s["branch"]["id"] == world.a.id and s["receipt_number"].startswith("AA-")
    adm = login(client, "admin")
    assert stock(client, adm, world.a.id, world.p1.id) == 8
    assert stock(client, adm, world.a.id, world.p2.id) == 9
    assert stock(client, adm, world.b.id, world.p1.id) == 10  # other branch untouched
    # ledger entry exists
    mv = client.get(f"{API}/inventory/movements", headers=adm, params={"product_id": world.p1.id}).json()
    assert mv[0]["reason"] == "sale" and mv[0]["delta"] == -2


def test_sale_rejections(client, world):
    h = login(client, "cash_a")
    assert sell(client, h, world.p1.id, 11).status_code == 409           # not enough stock
    assert sell(client, h, world.p1.id, 1, payment_method="cash", amount_tendered=1).status_code == 400  # short cash
    assert sell(client, h, 9999).status_code == 400                        # unknown product
    assert client.post(f"{API}/sales", headers=h, json={"items": []}).status_code == 422


def test_last_unit_cannot_be_sold_twice(client, world):
    """Two cashiers race for the final item: exactly one may win."""
    adm = login(client, "admin")
    client.post(f"{API}/inventory/adjust", headers=adm, json={"branch_id": world.a.id, "product_id": world.p1.id, "set_to": 1})
    h1, h2 = login(client, "cash_a"), login(client, "mgr_a")
    with ThreadPoolExecutor(2) as pool:
        codes = sorted(f.result().status_code for f in [
            pool.submit(sell, client, h1, world.p1.id), pool.submit(sell, client, h2, world.p1.id)])
    assert codes == [201, 409]
    assert stock(client, adm, world.a.id, world.p1.id) == 0


def test_receipt_visible_only_to_own_branch(client, world):
    sale_id = sell(client, login(client, "cash_a"), world.p1.id).json()["id"]
    assert client.get(f"{API}/sales/{sale_id}", headers=login(client, "cash_a")).status_code == 200
    assert client.get(f"{API}/sales/{sale_id}", headers=login(client, "cash_b")).status_code == 403


def test_low_stock_flag_and_threshold(client, world):
    mgr = login(client, "mgr_a")
    client.post(f"{API}/inventory/adjust", headers=mgr, json={"product_id": world.p1.id, "set_to": 5})
    low = client.get(f"{API}/inventory", headers=mgr, params={"low_stock_only": True}).json()
    assert [r["product"]["id"] for r in low] == [world.p1.id] and low[0]["is_low"]
    r = client.put(f"{API}/inventory/{world.a.id}/{world.p1.id}/threshold", headers=mgr, json={"min_threshold": 2})
    assert r.status_code == 200 and not r.json()["is_low"]
    # a cashier cannot change thresholds or adjust stock
    cash = login(client, "cash_a")
    assert client.put(f"{API}/inventory/{world.a.id}/{world.p1.id}/threshold", headers=cash, json={"min_threshold": 1}).status_code == 403
    assert client.post(f"{API}/inventory/adjust", headers=cash, json={"product_id": world.p1.id, "delta": 5}).status_code == 403
