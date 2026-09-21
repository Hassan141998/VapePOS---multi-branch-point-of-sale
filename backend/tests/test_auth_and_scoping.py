from tests.conftest import login

API = "/api/v1"


def test_login_success_and_failure(client, world):
    r = client.post(f"{API}/auth/login", data={"username": "cash_a", "password": "password1"})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "cashier" and body["user"]["branch_id"] == world.a.id
    assert client.post(f"{API}/auth/login", data={"username": "cash_a", "password": "nope"}).status_code == 401
    assert client.get(f"{API}/auth/me").status_code == 401


def test_cashier_is_locked_to_own_branch(client, world):
    h = login(client, "cash_a")
    # No branch asked -> silently their own branch
    rows = client.get(f"{API}/inventory", headers=h).json()
    assert {r["branch_id"] for r in rows} == {world.a.id}
    # Explicitly asking for another branch is refused
    assert client.get(f"{API}/inventory", params={"branch_id": world.b.id}, headers=h).status_code == 403
    # Trying to sell "as" another branch is refused
    r = client.post(f"{API}/sales", headers=h, json={"branch_id": world.b.id, "items": [{"product_id": world.p1.id, "quantity": 1}]})
    assert r.status_code == 403


def test_admin_sees_all_branches_and_can_filter(client, world):
    h = login(client, "admin")
    assert {r["branch_id"] for r in client.get(f"{API}/inventory", headers=h).json()} == {world.a.id, world.b.id}
    only_b = client.get(f"{API}/inventory", params={"branch_id": world.b.id}, headers=h).json()
    assert {r["branch_id"] for r in only_b} == {world.b.id}


def test_role_permissions(client, world):
    cash = login(client, "cash_a")
    mgr = login(client, "mgr_a")
    assert client.post(f"{API}/branches", headers=mgr, json={"name": "X Store", "code": "XX"}).status_code == 403
    assert client.get(f"{API}/users", headers=mgr).status_code == 403
    assert client.get(f"{API}/transfers", headers=cash).status_code == 403
    assert client.get(f"{API}/reports/dashboard", headers=cash).status_code == 403
    # cost price is hidden from cashiers, visible to managers
    assert client.get(f"{API}/products", headers=cash).json()[0]["buying_price"] is None
    assert client.get(f"{API}/products", headers=mgr).json()[0]["buying_price"] is not None


def test_admin_creates_branch_and_product_gets_inventory_rows(client, world):
    h = login(client, "admin")
    r = client.post(f"{API}/branches", headers=h, json={"name": "Store C", "code": "cc", "tax_rate": 5})
    assert r.status_code == 201 and r.json()["code"] == "CC"
    cid = r.json()["id"]
    # new branch immediately has a (zero stock) row for existing products
    rows = client.get(f"{API}/inventory", params={"branch_id": cid}, headers=h).json()
    assert len(rows) == 2 and all(x["stock_quantity"] == 0 for x in rows)
    # a new product appears at every branch
    r = client.post(f"{API}/products", headers=h, json={
        "barcode": "333", "name": "Coil 0.6", "category": "coil", "coil_resistance_ohm": 0.6,
        "buying_price": 2, "selling_price": 5})
    assert r.status_code == 201
    assert len(client.get(f"{API}/inventory", headers=h).json()) == 3 * 3
    # duplicate barcode
    assert client.post(f"{API}/products", headers=h, json={
        "barcode": "333", "name": "Dup", "buying_price": 1, "selling_price": 2}).status_code == 409


def test_staff_users_need_a_branch(client, world):
    h = login(client, "admin")
    r = client.post(f"{API}/users", headers=h, json={"username": "newcash", "password": "password1", "role": "cashier"})
    assert r.status_code == 422
    r = client.post(f"{API}/users", headers=h, json={"username": "newcash", "password": "password1", "role": "cashier", "branch_id": world.a.id})
    assert r.status_code == 201
