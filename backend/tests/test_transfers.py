from tests.conftest import login, stock

API = "/api/v1"


def make(client, h, world, qty=4):
    r = client.post(f"{API}/transfers", headers=h, json={
        "from_branch_id": world.a.id, "to_branch_id": world.b.id, "note": "restock",
        "items": [{"product_id": world.p1.id, "quantity": qty}, {"product_id": world.p2.id, "quantity": 1}]})
    assert r.status_code == 201, r.text
    return r.json()


def test_full_lifecycle_moves_stock_only_on_receive(client, world):
    mgr_a, mgr_b, adm = login(client, "mgr_a"), login(client, "mgr_b"), login(client, "admin")
    t = make(client, mgr_a, world)
    tid = t["id"]
    assert t["status"] == "pending" and t["reference"] == f"TR-{tid:05d}"
    assert stock(client, adm, world.a.id, world.p1.id) == 10  # nothing moved yet

    # only the source can dispatch
    assert client.post(f"{API}/transfers/{tid}/dispatch", headers=mgr_b).status_code == 403
    r = client.post(f"{API}/transfers/{tid}/dispatch", headers=mgr_a)
    assert r.status_code == 200 and r.json()["status"] == "in_transit"
    assert stock(client, adm, world.a.id, world.p1.id) == 10

    # only the destination can receive
    assert client.post(f"{API}/transfers/{tid}/receive", headers=mgr_a).status_code == 403
    r = client.post(f"{API}/transfers/{tid}/receive", headers=mgr_b)
    assert r.status_code == 200 and r.json()["status"] == "received"
    assert stock(client, adm, world.a.id, world.p1.id) == 6
    assert stock(client, adm, world.b.id, world.p1.id) == 14
    assert stock(client, adm, world.a.id, world.p2.id) == 9
    assert stock(client, adm, world.b.id, world.p2.id) == 11

    # audit log has one event per step, with who did it
    events = client.get(f"{API}/transfers/{tid}", headers=adm).json()["events"]
    assert [e["status"] for e in events] == ["pending", "in_transit", "received"]
    # cannot receive twice
    assert client.post(f"{API}/transfers/{tid}/receive", headers=mgr_b).status_code == 409
    assert stock(client, adm, world.b.id, world.p1.id) == 14


def test_receive_requires_in_transit(client, world):
    mgr_a, mgr_b = login(client, "mgr_a"), login(client, "mgr_b")
    tid = make(client, mgr_a, world)["id"]
    assert client.post(f"{API}/transfers/{tid}/receive", headers=mgr_b).status_code == 409  # still pending


def test_cancel(client, world):
    mgr_a, mgr_b, adm = login(client, "mgr_a"), login(client, "mgr_b"), login(client, "admin")
    tid = make(client, mgr_a, world)["id"]
    r = client.post(f"{API}/transfers/{tid}/cancel", headers=mgr_b)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert client.post(f"{API}/transfers/{tid}/dispatch", headers=mgr_a).status_code == 409
    assert stock(client, adm, world.a.id, world.p1.id) == 10


def test_receive_fails_atomically_if_source_ran_out(client, world):
    mgr_a, mgr_b, adm = login(client, "mgr_a"), login(client, "mgr_b"), login(client, "admin")
    tid = make(client, mgr_a, world, qty=8)["id"]
    client.post(f"{API}/transfers/{tid}/dispatch", headers=mgr_a)
    # Meanwhile branch A sells stock, leaving only 5 of product 1
    client.post(f"{API}/inventory/adjust", headers=adm, json={"branch_id": world.a.id, "product_id": world.p1.id, "set_to": 5})
    r = client.post(f"{API}/transfers/{tid}/receive", headers=mgr_b)
    assert r.status_code == 409
    # nothing moved, not even the product that WAS available
    assert stock(client, adm, world.a.id, world.p2.id) == 10 and stock(client, adm, world.b.id, world.p2.id) == 10
    assert stock(client, adm, world.b.id, world.p1.id) == 10
    assert client.get(f"{API}/transfers/{tid}", headers=adm).json()["status"] == "in_transit"


def test_validation_and_visibility(client, world):
    mgr_a, mgr_b = login(client, "mgr_a"), login(client, "mgr_b")
    adm = login(client, "admin")
    # cannot request more than the source holds
    r = client.post(f"{API}/transfers", headers=mgr_a, json={
        "from_branch_id": world.a.id, "to_branch_id": world.b.id, "items": [{"product_id": world.p1.id, "quantity": 99}]})
    assert r.status_code == 409
    # same branch is invalid
    r = client.post(f"{API}/transfers", headers=adm, json={
        "from_branch_id": world.a.id, "to_branch_id": world.a.id, "items": [{"product_id": world.p1.id, "quantity": 1}]})
    assert r.status_code == 422
    # both managers see it; a third branch's manager would not
    make(client, mgr_a, world)
    assert len(client.get(f"{API}/transfers", headers=mgr_b).json()) == 1
    assert len(client.get(f"{API}/transfers", headers=adm).json()) == 1
