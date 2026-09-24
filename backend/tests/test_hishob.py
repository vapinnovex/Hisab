from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from conftest import login

from app.routers import hishob


def root(setup_shop):
    return f"/api/shops/{setup_shop[1]}/hishob"


def create(client, setup_shop, amount="0.00"):
    response = client.post(root(setup_shop) + "/days", headers=setup_shop[0], json={"opening_cash": amount})
    assert response.status_code == 201, response.text
    return response.json()


def add(client, base, auth, day, kind, amount, key=None):
    result = client.post(
        base + f"/days/{day['id']}/transactions",
        headers=auth,
        json={
            "revision": day["revision"],
            "type": kind,
            "amount": amount,
            "category": "General",
            "description": kind,
            "request_id": key or f"entry-{day['revision']:05d}",
        },
    )
    assert result.status_code == 201, result.text
    return result.json()


def test_calculation_close_snapshot_and_next_day_carry(client, setup_shop, monkeypatch):
    owner = setup_shop[0]
    base = root(setup_shop)
    assert client.get(base + "/today", headers=owner).json()["suggested_opening_cash"] is None
    assert client.post(base + "/days", headers=owner, json={}).status_code == 422
    day = create(client, setup_shop, "1000.10")
    for kind, amount in [
        ("CASH_SALE", "15000.20"),
        ("OTHER_CASH_IN", "99.70"),
        ("EXPENSE", "500"),
        ("SUPPLIER_PAYMENT", "100"),
        ("BANK_DEPOSIT", "2000"),
        ("WITHDRAWAL", "100"),
    ]:
        day = add(client, base, owner, day, kind, amount)
    assert day["expected_closing_cash"] == "13400.00"
    url = base + f"/days/{day['id']}"
    body = {"revision": day["revision"], "actual_closing_cash": "13200.00"}
    assert client.post(url + "/close", headers=owner, json=body).status_code == 422
    closed = client.post(
        url + "/close", headers=owner, json={**body, "difference_note": "Cash shortage"}
    ).json()
    assert closed["difference"] == "-200.00"
    assert closed["closed_by"]["user_id"] == client.get("/api/auth/me", headers=owner).json()["user"]["id"]
    assert closed["closed_at"].endswith(("Z", "+00:00"))
    assert len(closed["closing_snapshots"][0]["transactions"]) == 6
    assert client.post(url + "/close", headers=owner, json=body).status_code == 409
    assert (
        client.get(
            base + "/days", headers=owner, params={"from_date": day["date"], "to_date": day["date"]}
        ).json()[0]["difference"]
        == "-200.00"
    )
    tomorrow = datetime.fromisoformat(day["date"] + "T12:00:00+00:00") + timedelta(days=1)
    monkeypatch.setattr(hishob, "now", lambda: tomorrow)
    assert client.get(base + "/today", headers=owner).json()["suggested_opening_cash"] == "13200.00"
    next_day = client.post(base + "/days", headers=owner, json={}).json()
    assert next_day["opening_cash"] == "13200.00"
    assert next_day["opening_source"]["day_id"] == day["id"]
    reopened = client.post(
        url + "/reopen", headers=owner, json={"revision": closed["revision"], "reason": "Missing receipt"}
    ).json()
    assert reopened["closing_snapshots"] == closed["closing_snapshots"]
    assert client.get(base + f"/days/{next_day['id']}", headers=owner).json()["opening_cash"] == "13200.00"


def test_edits_soft_deletion_opening_audit_and_closed_lock(client, setup_shop):
    owner = setup_shop[0]
    base = root(setup_shop)
    day = add(client, base, owner, create(client, setup_shop, "10"), "EXPENSE", "0.10")
    url = base + f"/days/{day['id']}"
    tx = day["transactions"][0]
    body = {
        "revision": day["revision"],
        "type": "EXPENSE",
        "amount": "0.20",
        "description": "Tea",
        "reason": "Receipt corrected",
    }
    day = client.patch(url + "/transactions/" + tx["id"], headers=owner, json=body).json()
    assert day["expenses_total"] == "0.20"
    assert day["audit"][-1]["previous"]["amount"] == "0.10"
    assert day["audit"][-1]["new"]["amount"] == "0.20"
    day = client.post(
        url + "/transactions/" + tx["id"] + "/delete",
        headers=owner,
        json={"revision": day["revision"], "reason": "Duplicate receipt"},
    ).json()
    assert day["transactions"][0]["deleted"] is True
    assert day["expenses_total"] == "0.00"
    day = client.patch(
        url + "/opening",
        headers=owner,
        json={"revision": day["revision"], "opening_cash": "20.25", "reason": "Cash counted again"},
    ).json()
    assert day["audit"][-1]["previous"]["opening_cash"] == "10.00"
    day = client.post(
        url + "/close", headers=owner, json={"revision": day["revision"], "actual_closing_cash": "20.25"}
    ).json()
    assert day["difference"] == "0.00"
    assert (
        client.patch(
            url + "/opening",
            headers=owner,
            json={"revision": day["revision"], "opening_cash": "25", "reason": "Cannot edit"},
        ).status_code
        == 409
    )
    assert (
        client.patch(
            url + "/transactions/" + tx["id"], headers=owner, json={**body, "revision": day["revision"]}
        ).status_code
        == 409
    )
    reopened = client.post(
        url + "/reopen", headers=owner, json={"revision": day["revision"], "reason": "Owner correction"}
    ).json()
    reclosed = client.post(
        url + "/close", headers=owner, json={"revision": reopened["revision"], "actual_closing_cash": "20.25"}
    ).json()
    assert len(reclosed["closing_snapshots"]) == 2
    assert reclosed["closing_snapshots"][0] == day["closing_snapshots"][0]


def test_permissions_isolation_and_live_revocation(client, setup_shop):
    owner, shop, _, worker = setup_shop
    base = root(setup_shop)
    client.post(
        f"/api/shops/{shop}/managers", headers=owner, json={"name": "Ravi", "mobile": "+919876543212"}
    )
    manager = login(client, "+919876543212", "MANAGER")
    day = create(client, setup_shop)
    url = base + f"/days/{day['id']}"
    for actor in [worker, manager]:
        for suffix in ["/today", "/transactions", f"/days/{day['id']}"]:
            assert client.get(base + suffix, headers=actor).status_code == 403
    settings_url = f"/api/shops/{shop}/settings"
    settings = client.get(settings_url, headers=owner).json()
    settings["manager_can_access_hishob"] = True
    client.put(settings_url, headers=owner, json=settings)
    day = add(client, base, manager, day, "CASH_SALE", "100")
    assert day["transactions"][0]["created_by"]["name"] == "Ravi"
    found = client.get(base + "/transactions", headers=manager, params={"q": "ravi"})
    assert found.status_code == 200 and found.json()["total"] == 1
    assert (
        client.post(
            url + "/close", headers=manager, json={"revision": day["revision"], "actual_closing_cash": "100"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            url + "/transactions/" + day["transactions"][0]["id"] + "/delete",
            headers=manager,
            json={"revision": day["revision"], "reason": "Denied"},
        ).status_code
        == 403
    )
    settings["manager_can_close_hishob"] = True
    client.put(settings_url, headers=owner, json=settings)
    day = client.post(
        url + "/close", headers=manager, json={"revision": day["revision"], "actual_closing_cash": "100"}
    ).json()
    assert day["status"] == "CLOSED"
    assert (
        client.post(
            url + "/reopen", headers=manager, json={"revision": day["revision"], "reason": "Denied"}
        ).status_code
        == 403
    )
    second = client.post("/api/shops", headers=owner, json={"name": "Second"}).json()["id"]
    assert client.get(f"/api/shops/{second}/hishob/days/{day['id']}", headers=owner).status_code == 404
    assert client.get(f"/api/shops/{second}/hishob/today", headers=manager).status_code == 403
    assert client.get(f"/api/shops/{second}/hishob/transactions", headers=owner).json()["total"] == 0
    assert client.get(f"/api/shops/{second}/hishob/transactions", headers=manager).status_code == 403
    stranger = login(client, "+919876543219")
    assert client.get(base + "/transactions", headers=stranger).status_code == 403
    settings["manager_can_access_hishob"] = False
    client.put(settings_url, headers=owner, json=settings)
    assert client.get(url, headers=manager).status_code == 403
    assert client.get(base + "/transactions", headers=manager).status_code == 403
    assert (
        client.get(
            base + "/days", headers=worker, params={"from_date": day["date"], "to_date": day["date"]}
        ).status_code
        == 403
    )


@pytest.mark.parametrize("amount", ["-1", "1.001", "NaN", "1e2", 0.1, "1000000000", ""])
def test_invalid_money_rejected(client, setup_shop, amount):
    assert (
        client.post(
            root(setup_shop) + "/days", headers=setup_shop[0], json={"opening_cash": amount}
        ).status_code
        == 422
    )


def test_idempotency_stale_edits_and_concurrent_close(client, setup_shop):
    owner = setup_shop[0]
    base = root(setup_shop)
    day = create(client, setup_shop, "100")
    assert client.post(base + "/days", headers=owner, json={"opening_cash": "100"}).status_code == 409
    original = day
    day = add(client, base, owner, day, "CASH_SALE", "0.10", "retry-same-entry")
    retried = add(client, base, owner, original, "CASH_SALE", "0.10", "retry-same-entry")
    assert retried["revision"] == day["revision"]
    assert len(retried["transactions"]) == 1
    url = base + f"/days/{day['id']}"
    assert (
        client.patch(
            url + "/opening",
            headers=owner,
            json={"revision": 1, "opening_cash": "200", "reason": "Stale screen"},
        ).status_code
        == 409
    )
    body = {"revision": day["revision"], "actual_closing_cash": "100.10"}
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(
            pool.map(lambda _: client.post(url + "/close", headers=owner, json=body).status_code, range(2))
        )
    assert sorted(statuses) == [200, 409]
    assert len(client.get(url, headers=owner).json()["closing_snapshots"]) == 1


def test_shop_timezone_and_carry_override_reason(client, setup_shop, monkeypatch):
    owner, shop, _, _ = setup_shop
    base = root(setup_shop)
    timestamp = datetime(2027, 1, 1, 20, 0, tzinfo=timezone.utc)
    client.app.state.db.shops.update_one(
        {"_id": shop}, {"$set": {"created_at": timestamp - timedelta(days=1)}}
    )
    monkeypatch.setattr(hishob, "now", lambda: timestamp)
    day = create(client, setup_shop, "50")
    assert day["date"] == "2027-01-02"
    assert (
        client.post(
            base + "/days", headers=owner, json={"date": "2027-01-03", "opening_cash": "0"}
        ).status_code
        == 422
    )
    client.post(
        base + f"/days/{day['id']}/close", headers=owner, json={"revision": 1, "actual_closing_cash": "50"}
    )
    monkeypatch.setattr(hishob, "now", lambda: timestamp + timedelta(days=1))
    assert client.post(base + "/days", headers=owner, json={"opening_cash": "60"}).status_code == 422
    override = client.post(
        base + "/days", headers=owner, json={"opening_cash": "60", "reason": "Extra float"}
    ).json()
    assert override["opening_cash"] == "60.00"
    assert override["audit"][0]["reason"] == "Extra float"
    assert override["opening_source"]["actual_closing_cash"] == "50.00"
    assert client.app.state.db.hishob_days.count_documents({"shop_id": shop}) == 2


def test_add_racing_close_cannot_silently_change_snapshot(client, setup_shop):
    owner = setup_shop[0]
    base = root(setup_shop)
    day = create(client, setup_shop, "100")
    url = base + f"/days/{day['id']}"

    def add_once():
        return client.post(
            url + "/transactions",
            headers=owner,
            json={
                "revision": 1,
                "type": "CASH_SALE",
                "amount": "10",
                "description": "Concurrent sale",
                "request_id": "racing-sale-1",
            },
        ).status_code

    def close_once():
        return client.post(
            url + "/close", headers=owner, json={"revision": 1, "actual_closing_cash": "100"}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(add_once), pool.submit(close_once)]
        results = [future.result() for future in futures]
    assert results in [[201, 409], [409, 200]]
    saved = client.get(url, headers=owner).json()
    if saved["status"] == "CLOSED":
        assert saved["closing_snapshots"][0]["transactions"] == []
        assert saved["expected_closing_cash"] == "100.00"
    else:
        assert saved["expected_closing_cash"] == "110.00"
        assert saved["closing_snapshots"] == []


def test_negative_expected_allowed_but_zero_or_forged_transaction_totals_rejected(client, setup_shop):
    base = root(setup_shop)
    owner = setup_shop[0]
    day = create(client, setup_shop)
    url = base + f"/days/{day['id']}"
    body = {
        "revision": 1,
        "type": "EXPENSE",
        "amount": "0",
        "description": "Invalid",
        "request_id": "invalid-zero",
    }
    assert client.post(url + "/transactions", headers=owner, json=body).status_code == 422
    assert (
        client.post(
            url + "/transactions",
            headers=owner,
            json={**body, "amount": "10", "expected_closing_cash": "999"},
        ).status_code
        == 422
    )
    day = add(client, base, owner, day, "EXPENSE", "0.30")
    assert day["expected_closing_cash"] == "-0.30"
    result = client.post(
        url + "/close",
        headers=owner,
        json={
            "revision": day["revision"],
            "actual_closing_cash": "0",
            "difference_note": "Missing opening float",
        },
    ).json()
    assert result["difference"] == "0.30"


def test_transaction_search_filters_pagination_totals_and_literal_text(client, setup_shop, monkeypatch):
    owner = setup_shop[0]
    base = root(setup_shop)
    day = add(client, base, owner, create(client, setup_shop), "EXPENSE", "1.10")
    first_id = day["transactions"][0]["id"]
    day = client.patch(
        base + f"/days/{day['id']}/transactions/{first_id}",
        headers=owner,
        json={
            "revision": day["revision"],
            "type": "EXPENSE",
            "amount": "1.10",
            "description": "Tea [urgent]",
            "category": "Staff refreshments",
            "reason": "Description",
        },
    ).json()
    day = add(client, base, owner, day, "CASH_SALE", "10.00")
    day = add(client, base, owner, day, "EXPENSE", "2.20")
    deleted_id = day["transactions"][-1]["id"]
    day = client.post(
        base + f"/days/{day['id']}/transactions/{deleted_id}/delete",
        headers=owner,
        json={"revision": day["revision"], "reason": "Duplicate"},
    ).json()
    closed = client.post(
        base + f"/days/{day['id']}/close",
        headers=owner,
        json={"revision": day["revision"], "actual_closing_cash": "8.90"},
    )
    assert closed.status_code == 200
    tomorrow = datetime.fromisoformat(day["date"] + "T12:00:00+00:00") + timedelta(days=1)
    monkeypatch.setattr(hishob, "now", lambda: tomorrow)
    next_day = client.post(base + "/days", headers=owner, json={}).json()
    next_day = add(client, base, owner, next_day, "EXPENSE", "3.40")
    add(client, base, owner, next_day, "BANK_DEPOSIT", "5.00")

    def search(**params):
        response = client.get(base + "/transactions", headers=owner, params=params)
        assert response.status_code == 200, response.text
        return response.json()

    first = search(page_size=2)
    assert first["total"] == 4 and first["has_more"] is True
    assert first["cash_in"] == "10.00" and first["cash_out"] == "9.50"
    assert all(item["date"] == next_day["date"] for item in first["items"])
    second = search(page_size=2, page=2)
    assert second["has_more"] is False
    assert len({(item["day_id"], item["entry"]["id"]) for item in first["items"] + second["items"]}) == 4
    assert all(item["day_status"] == "CLOSED" for item in second["items"])
    assert search(page=99)["items"] == []
    assert search(type="EXPENSE")["total"] == 2
    assert search(type="EXPENSE")["cash_out"] == "4.50"
    assert search(q="  TEA  ")["items"][0]["entry"]["id"] == first_id
    assert search(q="refreshments")["total"] == 1
    assert search(q="[urgent]")["total"] == 1
    assert search(q=".*")["total"] == 0
    assert search(from_date=day["date"], to_date=day["date"])["total"] == 2
    assert search(entry_status="ALL")["total"] == 5
    assert search(entry_status="ALL")["cash_out"] == "9.50"
    deleted = search(entry_status="DELETED")
    assert deleted["items"][0]["entry"]["id"] == deleted_id
    assert deleted["cash_out"] == "0.00"
    assert all("audit" not in item and "transactions" not in item for item in first["items"])


@pytest.mark.parametrize(
    "params",
    [
        {"page": 0},
        {"page_size": 101},
        {"q": "x" * 101},
        {"type": "INVALID"},
        {"entry_status": "INVALID"},
        {"from_date": "2026-01-01"},
        {"from_date": "2026-02-01", "to_date": "2026-01-01"},
        {"from_date": "2024-01-01", "to_date": "2026-01-01"},
    ],
)
def test_transaction_search_validates_filters(client, setup_shop, params):
    response = client.get(root(setup_shop) + "/transactions", headers=setup_shop[0], params=params)
    assert response.status_code == 422
