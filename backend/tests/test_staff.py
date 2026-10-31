from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from conftest import login

from app.db import now


@pytest.fixture
def book(client, setup_shop):
    owner, shop, staff, worker = setup_shop
    base = f"/api/shops/{shop}"
    result = client.post(base + "/hishob/days", headers=owner, json={"opening_cash": "10000"})
    assert result.status_code == 201, result.text
    return owner, shop, staff, worker, base, result.json()


def payment(day, **patch):
    return {
        "day_id": day["id"],
        "revision": day["revision"],
        "request_id": "staff-test-payment",
        "kind": "SALARY",
        "amount": "1250.50",
        "payment_method": "CASH",
        "note": "First half payment",
        **patch,
    }


def send(client, book, **patch):
    owner, _, staff, _, base, day = book
    return client.post(f"{base}/staff/{staff}/payments", headers=owner, json=payment(day, **patch))


def current(client, book):
    owner, _, _, _, base, day = book
    return client.get(f"{base}/hishob/days/{day['id']}", headers=owner).json()


@pytest.mark.parametrize(
    "kind,method,cash,expense,credit",
    [
        ("SALARY", "CASH", "8749.50", "1250.50", "0.00"),
        ("ADVANCE", "CASH", "8749.50", "1250.50", "0.00"),
        ("OTHER_GIVEN", "DIGITAL", "10000.00", "1250.50", "0.00"),
        ("RECEIVED", "CASH", "11250.50", "0.00", "0.00"),
        ("RECEIVED", "DIGITAL", "10000.00", "0.00", "0.00"),
        ("PURCHASE", "CASH", "10000.00", "0.00", "1250.50"),
    ],
)
def test_money_has_one_canonical_entry(client, book, kind, method, cash, expense, credit):
    result = send(client, book, kind=kind, payment_method=method)
    assert result.status_code == 201, result.text
    owner, shop, staff, worker, base, day = book
    saved = current(client, book)
    assert len(saved["transactions"]) == 1
    assert saved["expected_closing_cash"] == cash
    assert saved["expenses_total"] == expense
    assert saved["credit_sales"] == credit
    record = client.get(base + "/staff/me/history", headers=worker).json()["items"][0]
    assert record["amount"] == "1250.50" and record["kind"] == kind
    assert record["day_id"] == day["id"]
    assert "original" not in record and "user_id" not in str(record)
    assert "opening_cash" not in record and "transactions" not in record
    summary = client.get(base + "/hishob/transactions", headers=owner).json()
    assert summary["cash_in"] == ("1250.50" if kind == "RECEIVED" and method == "CASH" else "0.00")
    assert client.get(base + "/staff/me", headers=worker).json()["reference"]["salary"] is None


def test_duplicate_retry_conflicting_payload_and_closed_day(client, book):
    assert send(client, book).status_code == 201
    assert send(client, book).status_code == 201
    assert send(client, book, amount="1400").status_code == 409
    owner, _, _, _, base, day = book
    saved = current(client, book)
    closed = client.post(
        f"{base}/hishob/days/{day['id']}/close",
        headers=owner,
        json={"revision": saved["revision"], "actual_closing_cash": "8749.50"},
    )
    assert closed.status_code == 200, closed.text
    assert send(client, book).status_code == 201
    assert (
        send(client, book, request_id="new-closed-payment", revision=closed.json()["revision"]).status_code
        == 409
    )
    assert len(current(client, book)["transactions"]) == 1


def test_concurrent_writes_never_lose_or_double_count(client, book):
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda i: send(client, book, request_id=f"concurrent-payment-{i}"), range(2)))
    assert sorted(r.status_code for r in results) == [201, 409]
    assert len(current(client, book)["transactions"]) == 1
    failed = next(i for i, r in enumerate(results) if r.status_code == 409)
    assert send(client, book, request_id=f"concurrent-payment-{failed}", revision=2).status_code == 201
    assert current(client, book)["expected_closing_cash"] == "7499.00"


def test_purchase_collection_and_cancel_protection(client, book):
    owner, _, staff, worker, base, day = book
    assert send(client, book, kind="PURCHASE", amount="500").status_code == 201
    body = {
        "source_day_id": day["id"],
        "entry_id": "staff-test-payment",
        "revision": 2,
        "request_id": "purchase-receipt-1",
        "amount": "200",
        "payment_method": "CASH",
        "note": "Part paid",
    }
    endpoint = f"{base}/staff/{staff}/days/{day['id']}/purchase-payments"
    assert client.post(endpoint, headers=owner, json=body).status_code == 201
    assert client.post(endpoint, headers=owner, json=body).status_code == 201
    history = client.get(base + "/staff/me/history", headers=worker).json()["items"]
    assert history[0]["kind"] == "PURCHASE_PAYMENT"
    assert history[1]["remaining_amount"] == "300.00"
    assert current(client, book)["expected_closing_cash"] == "10200.00"
    assert current(client, book)["credit_sales"] == "300.00"
    assert (
        client.post(
            endpoint,
            headers=owner,
            json={**body, "request_id": "too-much-payment", "revision": 3, "amount": "400"},
        ).status_code
        == 422
    )
    cancel = client.post(
        f"{base}/hishob/days/{day['id']}/transactions/staff-test-payment/delete",
        headers=owner,
        json={"revision": 3, "reason": "Cancel purchase"},
    )
    assert cancel.status_code == 422
    # Existing Customer dues screen also carries staff identity into the receipt.
    result = client.post(
        f"{base}/hishob/days/{day['id']}/due-payments",
        headers=owner,
        json={
            **body,
            "revision": 3,
            "request_id": "purchase-receipt-2",
            "amount": "300",
            "payment_method": "DIGITAL",
        },
    )
    assert result.status_code == 201, result.text
    history = client.get(base + "/staff/me/history", headers=worker).json()["items"]
    assert history[0]["kind"] == "PURCHASE_PAYMENT" and history[-1]["remaining_amount"] == "0.00"
    assert current(client, book)["expected_closing_cash"] == "10200.00"


def test_cancellation_keeps_history_and_reconciles_cash(client, book):
    assert send(client, book).status_code == 201
    owner, _, _, worker, base, day = book
    path = f"{base}/hishob/days/{day['id']}/transactions/staff-test-payment"
    edited = client.patch(
        path,
        headers=owner,
        json={
            "revision": 2,
            "type": "EXPENSE",
            "amount": "12",
            "description": "Changed",
            "reason": "Fix error",
        },
    )
    assert edited.status_code == 422
    assert (
        client.post(
            path + "/delete", headers=owner, json={"revision": 2, "reason": "Duplicate payment"}
        ).status_code
        == 200
    )
    entry = client.get(base + "/staff/me/history", headers=worker).json()["items"][0]
    assert entry["deleted"] and entry["cancellation"]["reason"] == "Duplicate payment"
    assert current(client, book)["expected_closing_cash"] == "10000.00"
    assert send(client, book).status_code == 201  # Never resurrects a cancelled request.
    assert current(client, book)["transactions"][0]["deleted"]


def test_private_history_and_permissions_are_live(client, book):
    owner, shop, staff, worker, base, day = book
    manager = client.post(
        base + "/managers", headers=owner, json={"name": "Manager", "mobile": "+919876543212"}
    ).json()
    manager_auth = login(client, "+919876543212", "MANAGER")
    other = client.post(
        base + "/workers", headers=owner, json={"name": "Other worker", "mobile": "+919876543213"}
    ).json()
    target = base + "/staff/" + staff
    assert client.get(target + "/history", headers=manager_auth).status_code == 403
    assert client.get(base + "/staff/" + other["id"], headers=worker).status_code == 403
    assert client.post(target + "/payments", headers=worker, json=payment(day)).status_code == 403
    client.put(base + "/settings", headers=owner, json={"manager_can_manage_staff_payments": True})
    assert client.get(target + "/history", headers=manager_auth).status_code == 200
    assert client.post(target + "/payments", headers=manager_auth, json=payment(day)).status_code == 403
    client.put(
        base + "/settings",
        headers=owner,
        json={"manager_can_manage_staff_payments": True, "manager_can_access_hishob": True},
    )
    assert client.post(target + "/payments", headers=manager_auth, json=payment(day)).status_code == 201
    assert (
        client.post(
            base + "/staff/" + manager["id"] + "/payments",
            headers=manager_auth,
            json=payment(day, revision=2),
        ).status_code
        == 403
    )
    client.put(base + "/settings", headers=owner, json={})
    assert client.get(target + "/history", headers=manager_auth).status_code == 403
    assert client.get(base + "/staff/me/history", headers=worker).status_code == 200
    assert client.get(base + "/hishob/today", headers=worker).status_code == 403


def test_notes_without_hishob_and_cancellation(client, setup_shop):
    owner, shop, staff, worker = setup_shop
    base = f"/api/shops/{shop}"
    path = f"{base}/staff/{staff}/notes"
    note = {
        "date": "2026-01-01",
        "note": "Discussed leave for a family visit",
        "request_id": "staff-note-unique",
    }
    assert client.post(path, headers=owner, json=note).status_code == 201
    assert client.post(path, headers=owner, json=note).status_code == 201
    assert client.post(path, headers=owner, json={**note, "note": "Different"}).status_code == 409
    assert client.app.state.db.hishob_days.count_documents({"shop_id": shop}) == 0
    rows = client.get(base + "/staff/me/history", headers=worker).json()["items"]
    assert len(rows) == 1 and rows[0]["kind"] == "NOTE"
    assert client.get(base + "/staff/me/receipts/staff-note-unique", headers=worker).json()["saved"]
    assert (
        client.post(
            path + "/" + rows[0]["id"] + "/cancel",
            headers=owner,
            json={"revision": 1, "reason": "Wrong date"},
        ).status_code
        == 200
    )
    assert client.get(base + "/staff/me/history", headers=worker).json()["items"][0]["deleted"]
    assert client.post(path, headers=worker, json=note).status_code == 403
    assert client.post(path, headers=owner, json={**note, "date": "2100-01-01"}).status_code == 422


def test_manager_can_note_without_finance_access(client, setup_shop):
    owner, shop, staff, worker = setup_shop
    base = f"/api/shops/{shop}"
    client.post(base + "/managers", headers=owner, json={"name": "Manager", "mobile": "+919876543212"})
    manager = login(client, "+919876543212", "MANAGER")
    client.put(base + "/settings", headers=owner, json={"manager_can_edit_workers": True})
    note = {"date": "2026-01-01", "note": "Worker requested leave", "request_id": "manager-note-1"}
    assert client.post(f"{base}/staff/{staff}/notes", headers=manager, json=note).status_code == 201
    assert client.get(f"{base}/staff/{staff}/history", headers=manager).json()["items"][0]["kind"] == "NOTE"
    assert not client.get(f"{base}/staff/{staff}", headers=manager).json()["can_view_payments"]


def test_reference_salary_optional_private_and_no_payroll(client, setup_shop):
    owner, shop, staff, worker = setup_shop
    base = f"/api/shops/{shop}"
    person = client.post(
        base + "/workers",
        headers=owner,
        json={
            "name": "With salary",
            "mobile": "+919876543213",
            "salary": {"amount": "15000.75", "basis": "MONTHLY"},
        },
    )
    assert person.status_code == 201, person.text
    assert "salary" not in person.json() and "pay_reference" not in person.json()
    target = f"{base}/staff/{person.json()['id']}"
    record = client.get(target, headers=owner).json()
    assert record["reference"]["salary"]["amount"] == "15000.75"
    update = {
        "revision": 1,
        "request_id": "reference-change-1",
        "salary": {"amount": "16000", "basis": "MONTHLY"},
        "reason": "Agreed raise",
    }
    assert client.put(target + "/reference", headers=owner, json=update).status_code == 200
    assert client.put(target + "/reference", headers=owner, json=update).status_code == 200
    assert (
        client.put(target + "/reference", headers=owner, json={**update, "amount": "100"}).status_code == 422
    )
    assert (
        client.put(
            target + "/reference", headers=owner, json={**update, "request_id": "stale-change-1"}
        ).status_code
        == 409
    )
    assert (
        client.put(
            target + "/reference",
            headers=owner,
            json={**update, "revision": 2, "request_id": "remove-reference", "salary": None},
        ).status_code
        == 200
    )
    assert client.get(target, headers=owner).json()["reference"]["salary"] is None
    assert client.get(f"{base}/salary/{staff}", headers=owner).status_code == 404
    assert "pay_reference" not in str(client.get("/api/auth/me", headers=worker).json())
    assert client.app.state.db.hishob_days.count_documents({"shop_id": shop}) == 0


def test_legacy_history_preserved_without_cash_reposting(client, setup_shop):
    owner, shop, staff, worker = setup_shop
    db = client.app.state.db
    db.memberships.update_one(
        {"_id": staff},
        {
            "$set": {
                "salary": {
                    "terms": [{"amount": "12000", "basis": "MONTHLY"}],
                    "entries": [
                        {
                            "id": "old-payment",
                            "date": "2026-01-01",
                            "kind": "PAYMENT",
                            "amount": 50000,
                            "note": "Previously paid",
                            "payment_method": "CASH",
                            "actor_name": "Owner",
                            "void": None,
                        }
                    ],
                }
            }
        },
    )
    path = f"/api/shops/{shop}/staff/me"
    assert client.get(path, headers=worker).json()["reference"]["salary"]["amount"] == "12000"
    assert client.get(path + "/history", headers=worker).json()["legacy"][0]["amount"] == "500.00"
    assert db.hishob_days.count_documents({"shop_id": shop}) == 0


def test_backdated_day_and_cross_shop_protection(client, book):
    owner, shop, staff, worker, base, day = book
    db = client.app.state.db
    db.shops.update_one({"_id": shop}, {"$set": {"created_at": now() - timedelta(days=5)}})
    past = (now() - timedelta(days=2)).date().isoformat()
    previous = client.post(
        base + "/hishob/days",
        headers=owner,
        json={"date": past, "opening_cash": "5000", "reason": "Enter missed day"},
    ).json()
    assert send(client, book, day_id=previous["id"], revision=1).status_code == 201
    assert send(client, book).status_code == 409  # Same request cannot move to another date.
    other_shop = client.post("/api/shops", headers=owner, json={"name": "Second shop"}).json()["id"]
    other_day = client.post(
        f"/api/shops/{other_shop}/hishob/days", headers=owner, json={"opening_cash": "0"}
    ).json()
    assert send(client, book, day_id=other_day["id"], request_id="cross-shop-1").status_code == 404
    assert client.get(f"/api/shops/{other_shop}/staff/{staff}", headers=owner).status_code == 404


@pytest.mark.parametrize("mode", ["COUNTED", "BILLING"])
def test_staff_money_in_all_closing_modes(client, setup_shop, mode):
    owner, shop, staff, worker = setup_shop
    base = f"/api/shops/{shop}"
    client.put(base + "/settings", headers=owner, json={"hishob_mode": mode})
    day = client.post(base + "/hishob/days", headers=owner, json={"opening_cash": "10000"}).json()
    book = owner, shop, staff, worker, base, day
    assert send(client, book, amount="1000").status_code == 201
    assert (
        send(
            client,
            book,
            kind="RECEIVED",
            payment_method="DIGITAL",
            amount="500",
            revision=2,
            request_id="digital-receipt",
        ).status_code
        == 201
    )
    body = {"revision": 3, "actual_closing_cash": "11000", "digital_sales": "0", "credit_sales": "0"}
    if mode == "BILLING":
        body["cash_sales"] = "2000"
    result = client.post(f"{base}/hishob/days/{day['id']}/close", headers=owner, json=body)
    assert result.status_code == 200, result.text
    assert result.json()["cash_sales"] == "2000.00"
    assert result.json()["digital_sales"] == "0.00"
    assert result.json()["digital_other_in"] == "500.00"


def test_history_paginates_notes_and_payments_without_leaks(client, book):
    owner, shop, staff, worker, base, day = book
    assert send(client, book).status_code == 201
    for i in range(32):
        result = client.post(
            f"{base}/staff/{staff}/notes",
            headers=owner,
            json={"date": day["date"], "note": f"Note number {i}", "request_id": f"pagination-note-{i}"},
        )
        assert result.status_code == 201
    one = client.get(base + "/staff/me/history", headers=worker).json()
    two = client.get(base + "/staff/me/history?page=2", headers=worker).json()
    assert len(one["items"]) == 30 and one["has_more"]
    assert len(two["items"]) == 3 and not two["has_more"]
    assert len({e["id"] for e in one["items"] + two["items"]}) == 33
