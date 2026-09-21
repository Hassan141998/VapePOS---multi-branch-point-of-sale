from datetime import datetime, timezone

import pytest

from tests.conftest import login

API = "/api/v1"


def sell(client, h, pid, qty=1, method="cash", tendered=None):
    body = {"items": [{"product_id": pid, "quantity": qty}], "payment_method": method}
    if tendered is not None:
        body["amount_tendered"] = tendered
    r = client.post(f"{API}/sales", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_z_report_totals_and_close(client, world):
    cash_a = login(client, "cash_a")
    sell(client, cash_a, world.p1.id, 1, "cash", 20)      # 10 + 10% = 11.00 cash
    sell(client, cash_a, world.p2.id, 1, "card")          # 25.50 + 10% = 28.05 card
    sell(client, login(client, "cash_b"), world.p1.id)    # branch B: must not appear in A's report

    view = client.get(f"{API}/reports/z-report", headers=cash_a).json()
    t = view["totals"]
    assert t["receipts_count"] == 2 and t["items_sold"] == 2
    assert t["cash_total"] == 11.0 and t["card_total"] == 28.05 and t["gross_total"] == 39.05
    assert t["tax_total"] == 3.55 and view["closure"] is None

    r = client.post(f"{API}/reports/z-report/close", headers=cash_a, json={"opening_float": 100, "counted_cash": 110.5, "notes": "ok"})
    assert r.status_code == 201, r.text
    z = r.json()
    assert z["cash_variance"] == -0.5  # counted 110.50 vs expected 100 float + 11.00 cash sales
    assert z["gross_total"] == 39.05 and z["closed_by_name"] == "cash_a"
    # closing twice is refused; history lists it
    assert client.post(f"{API}/reports/z-report/close", headers=cash_a, json={}).status_code == 409
    assert len(client.get(f"{API}/reports/z-reports", headers=cash_a).json()) == 1
    assert client.get(f"{API}/reports/z-report", headers=cash_a).json()["closure"]["id"] == z["id"]
    # cashier of A cannot look at B's report; admin must name a branch
    assert client.get(f"{API}/reports/z-report", headers=cash_a, params={"branch_id": world.b.id}).status_code == 403
    adm = login(client, "admin")
    assert client.get(f"{API}/reports/z-report", headers=adm).status_code == 400
    assert client.get(f"{API}/reports/z-report", headers=adm, params={"branch_id": world.b.id}).json()["totals"]["receipts_count"] == 1
    # future days cannot be closed
    assert client.post(f"{API}/reports/z-report/close", headers=adm, json={"branch_id": world.b.id, "business_date": "2999-01-01"}).status_code == 400


def test_dashboard(client, world):
    sell(client, login(client, "cash_a"), world.p1.id, 2, "card")
    sell(client, login(client, "cash_a"), world.p2.id, 1, "card")
    sell(client, login(client, "cash_b"), world.p1.id, 1, "card")

    d = client.get(f"{API}/reports/dashboard", headers=login(client, "admin"), params={"days": 7}).json()
    assert len(d["by_branch"]) == 2 and len(d["daily"]["dates"]) == 7
    by = {b["branch_name"]: b for b in d["by_branch"]}
    assert by["Branch A"]["total"] == 50.05 and by["Branch B"]["total"] == 10.0
    today_idx = d["daily"]["dates"].index(datetime.now(timezone.utc).date().isoformat())
    series = {s["branch_name"]: s["values"] for s in d["daily"]["series"]}
    assert series["Branch A"][today_idx] == 50.05
    assert d["kpis"]["today_receipts"] == 3 and d["kpis"]["period_profit"] > 0
    assert d["top_flavors"][0]["label"] == "Mango Ice" and d["top_flavors"][0]["quantity"] == 3
    assert d["top_devices"][0]["label"] == "Pod Kit"

    # a manager only sees their own branch
    m = client.get(f"{API}/reports/dashboard", headers=login(client, "mgr_b")).json()
    assert [b["branch_name"] for b in m["by_branch"]] == ["Branch B"]


def test_websocket_pushes_events_to_admin_and_own_branch(client, world):
    admin_token = client.post(f"{API}/auth/login", data={"username": "admin", "password": "password1"}).json()["access_token"]
    b_token = client.post(f"{API}/auth/login", data={"username": "mgr_b", "password": "password1"}).json()["access_token"]
    a_token = client.post(f"{API}/auth/login", data={"username": "mgr_a", "password": "password1"}).json()["access_token"]
    with client.websocket_connect(f"{API}/ws?token={admin_token}") as ws_admin, \
         client.websocket_connect(f"{API}/ws?token={a_token}") as ws_a, \
         client.websocket_connect(f"{API}/ws?token={b_token}") as ws_b:
        sell(client, login(client, "cash_a"), world.p1.id)
        first = ws_admin.receive_json()
        assert first["type"] == "sale.created" and first["branch_ids"] == [world.a.id]
        assert ws_a.receive_json()["type"] == "sale.created"
        # Branch B's manager got nothing about branch A: the next thing they see is B's own sale.
        sell(client, login(client, "cash_b"), world.p1.id)
        assert ws_b.receive_json()["branch_ids"] == [world.b.id]


def test_websocket_ping_and_bad_token(client, world):
    from starlette.websockets import WebSocketDisconnect

    token = client.post(f"{API}/auth/login", data={"username": "admin", "password": "password1"}).json()["access_token"]
    with client.websocket_connect(f"{API}/ws?token={token}") as ws:
        ws.send_text("ping")
        assert ws.receive_text() == "pong"
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"{API}/ws?token=garbage"):
            pass
