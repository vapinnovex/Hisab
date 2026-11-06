from datetime import datetime, timezone

import pytest

from app.config import Settings
from app.radiosoft_real_schemas import RealScope


def configure(client, setup_shop):
    owner, shop, worker, worker_auth = setup_shop
    db = client.app.state.db
    owner_id = db.shops.find_one({"_id": shop})["created_by"]
    s = RealScope(
        shop_id=shop,
        owner_id=owner_id,
        source_id="pc-installation",
        generation="db-generation",
        database="RsDB",
        firm_codes=[0],
        invoice_types=[0, 1],
        tracking_from="2026-11-03",
        capture_from="2026-01-01",
        capture_until="2027-01-01",
    )
    client.app.state.settings.radiosoft_real_enabled = True
    client.app.state.settings.radiosoft_real_pilots = [s]
    path = f"/api/shops/{shop}/radiosoft-real"
    r = client.post(
        path + "/setup",
        headers=owner,
        json={"scope": s.model_dump(mode="json"), "confirm_source_and_scope": True},
    )
    assert r.status_code == 200, r.text
    code = client.post(path + "/pairing", headers=owner).json()["code"]
    proof = "A" * 43
    r = client.post("/api/radiosoft/real-connector/pair", json={"code": code, "credential": proof})
    assert r.status_code == 200, r.text
    return path, {"Authorization": "Bearer " + proof}, s


def envelope(sequence=1, net="-61.00", number="1", business_date="2026-11-03", source_time_raw=""):
    return {
        "version": 2,
        "synthetic": False,
        "mapping_version": "real-display-v1",
        "source_id": "pc-installation",
        "generation": "db-generation",
        "sequence": sequence,
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "kind": "BILL",
        "bill": {
            "key": {"invoice_no": number, "fyear": "2026 - 2027 ", "invoice_type": 0, "firm_code": 0},
            "business_date": business_date,
            "source_time_raw": source_time_raw,
            "net_amt": net,
            "raw_header": {"NetAmt": net, "ExchangeAmt": "1800.00", "DiscAmt": "0", "RoundAmt": "0"},
            "lines": [
                {
                    "raw": {"NetAmt": "869.50", "SLNo": 0},
                    "salesperson_ref": "0",
                    "salesperson_name": "Zero person",
                    "attribution_status": "RESOLVED_LOOKUP",
                }
            ]
            * 2,
        },
        "people": [],
    }


def send(client, auth, body):
    return client.post("/api/radiosoft/real-connector/observations", headers=auth, json=body)


def test_signed_review_retry_and_history(client, setup_shop):
    path, auth, _ = configure(client, setup_shop)
    owner, shop, _, _ = setup_shop
    first = envelope()
    r = send(client, auth, first)
    assert r.status_code == 200, r.text
    assert send(client, auth, first).json()["replayed"]
    assert send(client, auth, envelope(net="-62")).status_code == 409
    bill_id = r.json()["bill_id"]
    db = client.app.state.db
    events = [{"action": "RECEIVE", "amount": "10"}, {"action": "CREDIT"}, {"action": "NOTE"}]
    settlements = [{"action": "REFUND_NOW", "amount": "1", "actor_id": "test-history"}]
    db.radiosoft_real_bills.update_one(
        {"_id": bill_id}, {"$set": {"events": events, "settlements": settlements}}
    )
    assert send(client, auth, envelope(2, "-70")).status_code == 200
    assert send(client, auth, envelope(3, "0", "2")).status_code == 200
    assert send(client, auth, envelope(4, "1199", "3")).status_code == 200
    bills = client.get(path + "/bills", headers=owner).json()["bills"]
    negative = next(b for b in bills if b["key"]["invoice_no"] == "1")
    assert negative["signed_source_payable"] == "-70" and negative["owed_to_customer"] == "70"
    assert negative["settlement_status"] == "UNSETTLED" and negative["settlement_discrepancy"]
    assert negative["events"] == events and negative["settlements"] == settlements
    assert all(b["review_required"] and not b["financial_actions_enabled"] for b in bills)
    assert client.post(
        f"/api/shops/{shop}/radiosoft/bills/{bill_id}/collections", headers=owner, json={}
    ).status_code in (403, 422)
    assert db.receipts.count_documents({}) == 0


def test_real_bills_are_latest_first_and_day_total_includes_signed_source_amounts(client, setup_shop):
    path, auth, _ = configure(client, setup_shop)
    owner, _, _, _ = setup_shop
    bills = [
        envelope(1, "100.00", "1001", source_time_raw="10:30:00"),
        envelope(2, "250.00", "1002", source_time_raw="14:30:00"),
        envelope(3, "10.00", "1003", source_time_raw="14:30:00"),
        envelope(4, "-5.00", "1004", source_time_raw="15:00:00"),
        envelope(5, "900.00", "9999", business_date="2026-11-02", source_time_raw="23:59:00"),
    ]
    for bill in bills:
        assert send(client, auth, bill).status_code == 200

    daily = client.get(path + "/bills?business_date=2026-11-03", headers=owner).json()
    assert [bill["key"]["invoice_no"] for bill in daily["bills"]] == ["1004", "1003", "1002", "1001"]
    assert daily["summary"]["bill_count"] == 4
    assert daily["summary"]["source_total"] == "355.00"

    all_dates = client.get(path + "/bills", headers=owner).json()["bills"]
    assert all_dates[0]["business_date"] == "2026-11-03"


def test_real_dev_collections_are_separate_idempotent_and_source_read_only(client, setup_shop):
    path, auth, _ = configure(client, setup_shop)
    owner, shop, _, worker_auth = setup_shop
    body = envelope(net="1000.00")
    assert send(client, auth, body).status_code == 200
    bill = client.get(path + "/bills?business_date=2026-11-03", headers=owner).json()["bills"][0]
    bill_id = bill["id"]
    assert bill["collection_eligible"]
    assert bill["collection_status"] == "AWAITING_COLLECTION"
    assert bill["collection_outstanding_paise"] == 100000

    url = path + f"/bills/{bill_id}/collections"
    partial = {
        "request_id": "real-partial-001",
        "revision": 1,
        "action": "RECEIVE",
        "allocations": [{"method": "CASH", "amount_paise": 40000}],
    }
    recorded = client.post(url, headers=owner, json=partial)
    assert recorded.status_code == 200, recorded.text
    assert recorded.json()["collection_status"] == "PARTIAL"
    assert recorded.json()["collection_outstanding_paise"] == 60000
    assert client.post(url, headers=owner, json=partial).json()["collection_collected_paise"] == 40000

    paid = {
        "request_id": "real-mark-paid-001",
        "revision": 2,
        "action": "MARK_PAID",
        "allocations": [],
    }
    result = client.post(url, headers=owner, json=paid)
    assert result.status_code == 200, result.text
    assert result.json()["collection_status"] == "PAID"
    assert result.json()["collection_collected_paise"] == 100000
    assert result.json()["collection_events"][-1]["allocations"] == [
        {"method": "UNSPECIFIED", "amount_paise": 60000}
    ]

    db = client.app.state.db
    source = db.radiosoft_real_bills.find_one({"_id": bill_id})
    assert source["snapshot"]["net_amt"] == "1000.00"
    assert source["events"] == [] and source["settlements"] == []
    assert db.radiosoft_real_collections.count_documents({"shop_id": shop}) == 1
    assert db.hishob_days.count_documents({"shop_id": shop}) == 0
    assert client.post(url, headers=worker_auth, json=partial).status_code == 403
    reverse = {
        "request_id": "real-reverse-001",
        "revision": 3,
        "action": "REVERSE",
        "allocations": [],
        "collection_id": "real-mark-paid-001",
        "reason": "Payment was assigned to the wrong bill",
    }
    reversed_result = client.post(url, headers=owner, json=reverse)
    assert reversed_result.status_code == 200, reversed_result.text
    assert reversed_result.json()["collection_status"] == "PARTIAL"
    assert reversed_result.json()["collection_outstanding_paise"] == 60000


def test_source_edit_keeps_real_collection_history_and_blocks_new_entries(client, setup_shop):
    path, auth, _ = configure(client, setup_shop)
    owner, _, _, _ = setup_shop
    assert send(client, auth, envelope(net="1000.00")).status_code == 200
    bill = client.get(path + "/bills?business_date=2026-11-03", headers=owner).json()["bills"][0]
    url = path + f"/bills/{bill['id']}/collections"
    receipt = {
        "request_id": "source-edit-receipt",
        "revision": 1,
        "action": "RECEIVE",
        "allocations": [{"method": "CASH", "amount_paise": 40000}],
    }
    assert client.post(url, headers=owner, json=receipt).status_code == 200
    assert send(client, auth, envelope(2, "900.00")).status_code == 200
    changed = client.get(path + "/bills?business_date=2026-11-03", headers=owner).json()["bills"][0]
    assert changed["collection_status"] == "SOURCE_REVIEW"
    assert changed["collection_collected_paise"] == 40000
    assert not changed["collection_eligible"]
    blocked = {
        "request_id": "source-edit-receipt-2",
        "revision": 2,
        "action": "RECEIVE",
        "allocations": [{"method": "CASH", "amount_paise": 10000}],
    }
    assert client.post(url, headers=owner, json=blocked).status_code == 409


def test_real_collection_manager_grant_is_separate_from_view_and_corrections(client, setup_shop):
    from conftest import login

    path, auth, s = configure(client, setup_shop)
    owner, shop, _, _ = setup_shop
    created = client.post(
        f"/api/shops/{shop}/managers",
        headers=owner,
        json={"name": "Counter manager", "mobile": "+919876543219"},
    )
    assert created.status_code == 201, created.text
    manager = login(client, "+919876543219", "MANAGER")
    response = client.post(
        path + "/setup",
        headers=owner,
        json={
            "scope": s.model_dump(mode="json"),
            "confirm_source_and_scope": True,
            "manager_view": True,
            "manager_collect": True,
            "manager_correct": False,
        },
    )
    assert response.status_code == 200, response.text
    assert client.get(path + "/status", headers=manager).json()["can_collect"]
    assert send(client, auth, envelope(net="1000.00")).status_code == 200
    bill = client.get(path + "/bills?business_date=2026-11-03", headers=owner).json()["bills"][0]
    url = path + f"/bills/{bill['id']}/collections"
    payload = {
        "request_id": "manager-collection-001",
        "revision": 1,
        "action": "RECEIVE",
        "allocations": [{"method": "UPI", "amount_paise": 50000}],
    }
    assert client.post(url, headers=manager, json=payload).status_code == 200
    reversal = {
        "request_id": "manager-reversal-001",
        "revision": 2,
        "action": "REVERSE",
        "allocations": [],
        "collection_id": "manager-collection-001",
        "reason": "Entered on wrong bill",
    }
    assert client.post(url, headers=manager, json=reversal).status_code == 403


def test_mapping_zero_directory_worker_isolation_and_frozen_history(client, setup_shop):
    path, auth, _ = configure(client, setup_shop)
    owner, _, worker, worker_auth = setup_shop
    directory = {
        **envelope(),
        "kind": "DIRECTORY",
        "bill": None,
        "people": [{"ref": "0", "name": "Zero"}, {"ref": "42", "name": "No bills"}],
    }
    assert send(client, auth, directory).status_code == 200
    directory = client.get(path + "/salespeople", headers=owner).json()
    assert directory["workers"] == [{"id": worker, "name": "Asha"}]
    people = directory["people"]
    assert len(people) == 2
    p = next(p for p in people if p["ref"] == "0")
    assert (
        client.put(
            path + f"/salespeople/{p['id']}/mapping",
            headers=worker_auth,
            json={"revision": 0, "worker_id": worker, "reason": "test"},
        ).status_code
        == 403
    )
    assert (
        client.put(
            path + f"/salespeople/{p['id']}/mapping",
            headers=owner,
            json={"revision": 0, "worker_id": worker, "reason": "Owner confirmed"},
        ).status_code
        == 200
    )
    bill = envelope(2)
    bill["bill"]["lines"].append(
        {
            "raw": {"NetAmt": "5", "SLNo": None},
            "salesperson_ref": None,
            "salesperson_name": "",
            "attribution_status": "ABSENT_REFERENCE",
        }
    )
    assert send(client, auth, bill).status_code == 200
    report = client.get(path + "/worker-sales?start=2026-11-01&end=2026-11-05", headers=worker_auth).json()
    assert len(report["rows"]) == 2 and report["bill_adjustments"] == []
    assert not report["exact_net_sales_available"]
    assert client.get(path + "/bills", headers=worker_auth).status_code == 403
    assert (
        client.put(
            path + f"/salespeople/{p['id']}/mapping",
            headers=owner,
            json={"revision": 1, "worker_id": None, "reason": "Future only"},
        ).status_code
        == 200
    )
    bill["sequence"] = 3
    bill["bill"]["net_amt"] = "-80"
    bill["bill"]["raw_header"]["NetAmt"] = "-80"
    assert send(client, auth, bill).status_code == 200
    assert (
        len(
            client.get(path + "/worker-sales?start=2026-11-01&end=2026-11-05", headers=worker_auth).json()[
                "rows"
            ]
        )
        == 2
    )
    assert send(client, auth, envelope(4, number="2")).status_code == 200
    assert (
        len(
            client.get(path + "/worker-sales?start=2026-11-01&end=2026-11-05", headers=worker_auth).json()[
                "rows"
            ]
        )
        == 2
    )
    report = client.get(path + "/worker-sales?start=2026-11-01&end=2026-11-05", headers=owner).json()
    assert len(report["bill_adjustments"]) == 2 and len(report["rows"]) == 5


def test_binding_revocation_and_continuity(client, setup_shop):
    path, auth, s = configure(client, setup_shop)
    owner, shop, _, _ = setup_shop
    assert send(client, auth, envelope(2)).status_code == 409
    for field, value in [("source_id", "other"), ("generation", "other")]:
        body = envelope()
        body[field] = value
        assert send(client, auth, body).status_code == 403
    body = envelope()
    body["bill"]["key"]["firm_code"] = 1
    assert send(client, auth, body).status_code == 403
    assert (
        client.post(
            "/api/radiosoft/real-connector/observations?shop_id=other", headers=auth, json=envelope()
        ).status_code
        == 400
    )
    assert client.post(
        "/api/radiosoft/connector/observations", headers=auth, json=envelope()
    ).status_code in (401, 422)
    assert send(client, auth, envelope()).status_code == 200
    client.post(path + "/revoke", headers=owner)
    assert send(client, auth, envelope(2)).status_code == 401
    client.app.state.settings.radiosoft_real_pilots = [s.model_copy(update={"owner_id": "wrong"})]
    assert client.get(path + "/status", headers=owner).status_code == 403


def test_production_guard():
    with pytest.raises(ValueError, match="cannot run in production"):
        Settings(_env_file=None, app_env="production", jwt_secret="x" * 32, radiosoft_real_enabled=True)


def test_crash_fence_recovery_and_historical_review(client, setup_shop):
    from app.radiosoft import digest
    from app.radiosoft_real_schemas import RealObservation

    path, auth, s = configure(client, setup_shop)
    db = client.app.state.db
    body = envelope()
    body["bill"]["business_date"] = "2026-02-01"
    normalized = RealObservation(**body).model_dump(mode="json")
    fingerprint = digest(normalized)
    receipt_id = digest([s.shop_id, s.source_id, s.generation, 1])
    pending = {"sequence": 1, "digest": fingerprint}
    # Crash after durable stream claim and inbox write, before materialization.
    db.radiosoft_real_integrations.update_one({"_id": s.shop_id}, {"$set": {"pending": pending}})
    db.radiosoft_real_inbox.insert_one({"_id": receipt_id, "digest": fingerprint, "payload": normalized})
    assert send(client, auth, envelope(2)).status_code == 409
    assert send(client, auth, body).status_code == 200
    assert client.get(path + "/bills", headers=setup_shop[0]).json()["bills"][0]["historical"]
    # Crash after ack persistence but before clearing fence: replay repairs it.
    db.radiosoft_real_integrations.update_one(
        {"_id": s.shop_id}, {"$set": {"pending": pending, "last_sequence": 0}}
    )
    assert send(client, auth, body).json()["replayed"]
    assert send(client, auth, envelope(2, net="0", number="2")).status_code == 200
    assert len(db.radiosoft_real_bills.find_one({"snapshot.key.invoice_no": "1"})["versions"]) == 1


def test_equal_source_labels_in_two_shops_are_isolated(client, setup_shop):
    path, auth, first_scope = configure(client, setup_shop)
    owner = setup_shop[0]
    second = client.post(
        "/api/shops", headers=owner, json={"name": "Same name source", "timezone": "Asia/Kolkata"}
    ).json()["id"]
    second_scope = first_scope.model_copy(update={"shop_id": second})
    client.app.state.settings.radiosoft_real_pilots.append(second_scope)
    base = f"/api/shops/{second}/radiosoft-real"
    assert (
        client.post(
            base + "/setup",
            headers=owner,
            json={"scope": second_scope.model_dump(mode="json"), "confirm_source_and_scope": True},
        ).status_code
        == 200
    )
    code = client.post(base + "/pairing", headers=owner).json()["code"]
    assert (
        client.post(
            "/api/radiosoft/real-connector/pair", json={"code": code, "credential": "B" * 43}
        ).status_code
        == 200
    )
    one = send(client, auth, envelope()).json()["bill_id"]
    two = send(client, {"Authorization": "Bearer " + "B" * 43}, envelope()).json()["bill_id"]
    assert one != two
    assert client.get(path + "/bills", headers=owner).json()["bills"][0]["id"] == one
    assert client.get(base + "/bills", headers=owner).json()["bills"][0]["id"] == two
    assert (
        client.post(
            "/api/radiosoft/real-connector/observations",
            headers={**auth, "X-Hishob-Shop": second},
            json=envelope(2),
        ).status_code
        == 400
    )


def test_unknown_and_large_source_payable_do_not_poison_delivery(client, setup_shop):
    path, auth, _ = configure(client, setup_shop)
    assert send(client, auth, envelope(net=None)).status_code == 200
    exact = "-123456789012345678901234567890123456789.125"
    assert send(client, auth, envelope(2, exact, "2")).status_code == 200
    assert send(client, auth, envelope(3, "1199", "3")).status_code == 200
    bills = client.get(path + "/bills", headers=setup_shop[0]).json()["bills"]
    unknown = next(b for b in bills if b["key"]["invoice_no"] == "1")
    assert unknown["owed_to_customer"] is None and unknown["review_required"]
    large = next(b for b in bills if b["key"]["invoice_no"] == "2")
    assert large["owed_to_customer"] == exact[1:]
    assert large["signed_source_payable"] == exact


def test_manager_mapping_delegation_does_not_grant_bill_access(client, setup_shop):
    from conftest import login

    path, auth, s = configure(client, setup_shop)
    owner, shop, worker, _ = setup_shop
    created = client.post(
        f"/api/shops/{shop}/managers", headers=owner, json={"name": "Mapper", "mobile": "+919876543219"}
    )
    assert created.status_code == 201
    manager = login(client, "+919876543219", "MANAGER")
    assert client.get(path + "/salespeople", headers=manager).status_code == 403
    assert (
        client.post(
            path + "/setup",
            headers=owner,
            json={
                "scope": s.model_dump(mode="json"),
                "confirm_source_and_scope": True,
                "manager_map": True,
                "manager_view": False,
            },
        ).status_code
        == 200
    )
    directory = {**envelope(), "kind": "DIRECTORY", "bill": None, "people": [{"ref": "0", "name": "Zero"}]}
    assert send(client, auth, directory).status_code == 200
    status = client.get(path + "/status", headers=manager).json()
    assert status["can_map"] and not status["can_view"]
    person = client.get(path + "/salespeople", headers=manager).json()["people"][0]
    assert (
        client.put(
            path + f"/salespeople/{person['id']}/mapping",
            headers=manager,
            json={"revision": 0, "worker_id": worker, "reason": "Authorized link"},
        ).status_code
        == 200
    )
    assert client.get(path + "/bills", headers=manager).status_code == 403
    assert (
        client.get(path + "/worker-sales?start=2026-11-01&end=2026-11-05", headers=manager).status_code == 403
    )
    assert client.post(path + "/pairing", headers=manager).status_code == 403
