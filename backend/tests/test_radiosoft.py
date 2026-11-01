"""All examples are synthetic. No source database, shop IDs or production pairing."""

import json
import secrets
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from pathlib import Path

import pytest
from conftest import login
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.db import now
from app.main import create_app
from app.radiosoft import to_paise

CONNECTOR = "/api/radiosoft/connector"
FIXTURE = json.loads((Path(__file__).parent / "fixtures/radiosoft-observation.json").read_text())


@pytest.fixture
def pilot(client, setup_shop):
    owner, shop, _, worker = setup_shop
    settings = client.app.state.settings
    settings.radiosoft_synthetic_enabled = True
    db = client.app.state.db
    settings.radiosoft_pilots = [
        {
            "shop_id": shop,
            "owner_id": db.shops.find_one({"_id": shop})["created_by"],
            "source_id": "synthetic-installation",
            "firm_codes": [0],
            "tracking_from": "2026-11-01",
        }
    ]
    base = f"/api/shops/{shop}/radiosoft"
    assert (
        client.put(base + "/settings", headers=owner, json={"revision": 0, "mode": "PREVIEW"}).status_code
        == 200
    )
    code = client.post(base + "/pairing", headers=owner).json()["code"]
    credential = secrets.token_urlsafe(32)
    paired = client.post(CONNECTOR + "/pair", json={"code": code, "credential": credential})
    assert paired.status_code == 200, paired.text
    auth = {"Authorization": "Bearer " + credential}
    observation = {
        **deepcopy(FIXTURE),
        "generation": paired.json()["generation"],
        "observed_at": now().isoformat(),
    }
    return {
        "owner": owner,
        "worker": worker,
        "shop": shop,
        "base": base,
        "auth": auth,
        "observation": observation,
        "code": code,
        "credential": credential,
    }


def send(client, pilot, sequence=1, **changes):
    body = {**deepcopy(pilot["observation"]), "sequence": sequence, **changes}
    return client.post(CONNECTOR + "/observations", headers=pilot["auth"], json=body)


def get_bill(client, p, bill_id):
    response = client.get(p["base"] + "/bills/" + bill_id, headers=p["owner"])
    assert response.status_code == 200, response.text
    return response.json()


def collect(client, p, bill_id, action="MARK_PAID", allocations=None, **kwargs):
    body = {
        "revision": get_bill(client, p, bill_id)["revision"],
        "request_id": secrets.token_hex(16),
        "action": action,
    }
    if allocations is not None:
        body["allocations"] = allocations
    body.update(kwargs)
    return client.post(p["base"] + f"/bills/{bill_id}/collections", headers=p["owner"], json=body)


def allocation(method, amount):
    return {"method": method, "amount_paise": amount}


def test_default_off_and_production_guard(client, setup_shop):
    owner, shop, *_ = setup_shop
    base = f"/api/shops/{shop}/radiosoft"
    assert client.get(base + "/status", headers=owner).json()["mode"] == "OFF"
    assert client.get(base + "/bills", headers=owner).status_code == 403
    assert (
        client.put(base + "/settings", headers=owner, json={"revision": 0, "mode": "PREVIEW"}).status_code
        == 403
    )
    with pytest.raises(ValidationError, match="cannot run in production"):
        Settings(_env_file=None, app_env="production", jwt_secret="x" * 40, radiosoft_synthetic_enabled=True)


@pytest.mark.parametrize(
    "value,expected",
    [("1.005", 101), ("4419.9921", 441999), ("0.0049", 0), ("-1.005", -101), ("1199", 119900)],
)
def test_decimal_rounding(value, expected):
    assert to_paise(value) == expected


def test_pairing_lost_response_expiry_reuse_and_revocation(client, pilot):
    p = pilot
    body = {"code": p["code"], "credential": p["credential"]}
    assert client.post(CONNECTOR + "/pair", json=body).status_code == 200
    assert (
        client.post(CONNECTOR + "/pair", json={**body, "credential": secrets.token_urlsafe(32)}).status_code
        == 409
    )
    db = client.app.state.db
    config = db.radiosoft_integrations.find_one({"_id": p["shop"]})
    assert p["credential"] not in str(config) and p["code"] not in str(config)
    db.radiosoft_integrations.update_one(
        {"_id": p["shop"]}, {"$set": {"pairing.expires_at": now() - timedelta(seconds=1)}}
    )
    assert client.post(CONNECTOR + "/pair", json=body).status_code == 401
    assert client.post(p["base"] + "/revoke", headers=p["owner"]).status_code == 200
    assert send(client, p).status_code == 401
    assert client.post(CONNECTOR + "/pair", json=body).status_code == 401


def test_scope_permissions_and_tampering(client, pilot):
    p = pilot
    other = login(client, "+919876500001")
    another_shop = client.post("/api/shops", headers=other, json={"name": "Same name"}).json()["id"]
    assert client.get(p["base"] + "/bills", headers=other).status_code == 403
    assert client.get(p["base"] + "/bills", headers=p["worker"]).status_code == 403
    assert send(client, p, shop_id=another_shop).status_code == 422
    assert send(client, p, source_id="another-source").status_code == 403
    assert send(client, p, generation="another-generation").status_code == 403
    assert send(client, p, key={**p["observation"]["key"], "firm_code": 1}).status_code == 403
    for url, headers in [
        (CONNECTOR + "/observations?shop_id=" + another_shop, p["auth"]),
        (CONNECTOR + "/observations", {**p["auth"], "X-Hishob-Shop": another_shop}),
    ]:
        assert client.post(url, headers=headers, json=p["observation"]).status_code == 400
    assert (
        client.post(CONNECTOR + "/observations", headers=p["owner"], json=p["observation"]).status_code == 401
    )
    # Eligibility is rechecked on every request, including ingestion and reads.
    client.app.state.settings.radiosoft_pilots[0]["owner_id"] = "wrong-owner"
    assert send(client, p).status_code == 401
    assert client.get(p["base"] + "/bills", headers=p["owner"]).status_code == 403


def test_manager_permissions_are_independent_and_live(client, pilot):
    p = pilot
    shop = p["shop"]
    created = client.post(
        f"/api/shops/{shop}/managers", headers=p["owner"], json={"name": "Manager", "mobile": "+919876500002"}
    )
    assert created.status_code == 201, created.text
    manager = login(client, "+919876500002", "MANAGER")
    bill_id = send(client, p).json()["bill_id"]
    assert client.get(p["base"] + "/bills", headers=manager).status_code == 403
    for grants in [{"manager_view": True}, {"manager_view": True, "manager_collect": True}]:
        status = client.get(p["base"] + "/status", headers=p["owner"]).json()
        assert (
            client.put(
                p["base"] + "/settings",
                headers=p["owner"],
                json={"revision": status["revision"], "mode": "PREVIEW", **grants},
            ).status_code
            == 200
        )
        assert client.get(p["base"] + "/bills", headers=manager).status_code == 200
        body = {
            "revision": get_bill(client, p, bill_id)["revision"],
            "request_id": secrets.token_hex(16),
            "action": "MARK_PAID",
        }
        result = client.post(p["base"] + f"/bills/{bill_id}/collections", headers=manager, json=body)
        assert result.status_code == (200 if grants.get("manager_collect") else 403)
    event = get_bill(client, p, bill_id)["collections"][0]
    body.update(action="REVERSE", collection_id=event["id"], reason="Wrong bill", revision=2)
    assert (
        client.post(p["base"] + f"/bills/{bill_id}/collections", headers=manager, json=body).status_code
        == 403
    )
    assert client.post(p["base"] + "/pairing", headers=manager).status_code == 403


def test_replay_out_of_order_and_restart(client, pilot):
    p = pilot
    accepted = send(client, p)
    assert accepted.status_code == 200, accepted.text
    bill_id = accepted.json()["bill_id"]
    assert send(client, p).json()["replayed"] is True
    assert send(client, p, amounts={"net_amt": "999"}).status_code == 409
    assert send(client, p, 3, amounts={"net_amt": "1200"}).status_code == 200
    assert send(client, p, 2).status_code == 409
    # New app process/lifespan against same database: no in-memory replay state.
    with TestClient(create_app(client.app.state.settings)) as restarted:
        assert send(restarted, p, 3, amounts={"net_amt": "1200"}).json()["replayed"]
        assert get_bill(restarted, p, bill_id)["payable_paise"] == 120000
    assert len(get_bill(client, p, bill_id)["versions"]) == 2


@pytest.mark.parametrize("method", ["CASH", "UPI", "CARD", "UNSPECIFIED"])
def test_partial_methods_split_unspecified_reclassification(client, pilot, method):
    p = pilot
    bill_id = send(client, p).json()["bill_id"]
    partial = collect(client, p, bill_id, "RECEIVE", [allocation(method, 40000)])
    assert partial.status_code == 200, partial.text
    assert partial.json()["outstanding_paise"] == 60000
    paid = collect(client, p, bill_id)
    assert paid.status_code == 200
    assert paid.json()["collection_status"] == "PAID"
    assert paid.json()["bank_verified"] is False
    receipt = paid.json()["collections"][-1]
    reclassified = collect(
        client,
        p,
        bill_id,
        "RECLASSIFY",
        [allocation("UPI", 30000), allocation("CARD", 30000)],
        collection_id=receipt["id"],
        reason="Checked cashier receipt",
    )
    assert reclassified.status_code == 200, reclassified.text
    result = reclassified.json()
    assert result["collected_paise"] == 100000 and len(result["collections"]) == 2
    assert len(result["events"]) == 3
    assert result["events"][-1]["source_sequence"] == 1
    assert (
        collect(
            client,
            p,
            bill_id,
            "RECLASSIFY",
            [allocation("CASH", 1)],
            collection_id=receipt["id"],
            reason="Wrong amount",
        ).status_code
        == 409
    )
    assert (
        collect(client, p, bill_id, "REVERSE", collection_id=receipt["id"], reason="Incorrect entry").json()[
            "outstanding_paise"
        ]
        == 60000
    )
    assert (
        collect(
            client, p, bill_id, "REVERSE", collection_id=receipt["id"], reason="Retry with different ID"
        ).status_code
        == 409
    )


def test_concurrent_cashiers_and_lost_ack(client, pilot):
    p = pilot
    bill_id = send(client, p).json()["bill_id"]
    url = p["base"] + f"/bills/{bill_id}/collections"
    body = {"revision": 1, "request_id": "cashier-one-001", "action": "MARK_PAID"}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda request_id: client.post(
                    url, headers=p["owner"], json={**body, "request_id": request_id}
                ),
                [body["request_id"], "cashier-two-001"],
            )
        )
    assert sorted(r.status_code for r in responses) == [200, 409]
    winning_id = next(r.json()["events"][0]["request_id"] for r in responses if r.status_code == 200)
    retry = client.post(url, headers=p["owner"], json={**body, "request_id": winning_id})
    assert retry.status_code == 200 and len(retry.json()["events"]) == 1
    assert (
        client.post(
            url, headers=p["owner"], json={**body, "request_id": winning_id, "reason": "Changed payload"}
        ).status_code
        == 409
    )
    assert retry.json()["method_totals"] == {"CASH": 0, "UPI": 0, "CARD": 0, "UNSPECIFIED": 100000}


def test_source_changes_cancel_missing_return_and_no_auto_refund(client, pilot):
    p = pilot
    bill_id = send(client, p).json()["bill_id"]
    assert collect(client, p, bill_id).status_code == 200
    for sequence, amount, outstanding in [(2, "1200", 20000), (3, "800", -20000)]:
        assert send(client, p, sequence, amounts={"net_amt": amount}).status_code == 200
        result = get_bill(client, p, bill_id)
        assert result["outstanding_paise"] == outstanding
        assert result["collected_paise"] == 100000
    assert send(client, p, 4, source_status="CANCELLED").status_code == 422
    for sequence, status in [(4, "MISSING_REVIEW"), (5, "CANCELLED"), (6, "CURRENT")]:
        assert (
            send(
                client, p, sequence, source_status=status, lifecycle_evidence="Synthetic lifecycle test"
            ).status_code
            == 200
        )
        result = get_bill(client, p, bill_id)
        assert len(result["collections"]) == 1 and len(result["events"]) == 1
        if status != "CURRENT":
            assert result["review_required"] and collect(client, p, bill_id).status_code == 409
    assert send(client, p, 7, amounts={"net_amt": "1535", "exchange_amt": "4960"}).status_code == 200
    assert get_bill(client, p, bill_id)["payable_paise"] == 153500  # Never deduct exchange twice.
    assert (
        send(client, p, 8, return_amount="200").status_code == 422
    )  # Unsupported returns cannot fabricate refunds.


def test_full_key_line_multiset_and_historical_boundary(client, pilot):
    p = pilot
    bill_id = send(client, p).json()["bill_id"]
    for changes in [{"fyear": "SYNTHETIC-2025-26"}, {"invoice_type": 1}]:
        assert send(client, p, key={**p["observation"]["key"], **changes}).json()["bill_id"] != bill_id
    line = p["observation"]["lines"][0]
    assert send(client, p, 2, lines=[line, {**line, "salesperson_ref": "SYN-2"}]).status_code == 200
    assert send(client, p, 3, lines=[{**line, "salesperson_ref": "SYN-2"}, line]).status_code == 200
    assert len(get_bill(client, p, bill_id)["versions"]) == 2
    assert send(client, p, 4, lines=[line, line]).status_code == 200
    assert len(get_bill(client, p, bill_id)["snapshot"]["lines"]) == 2
    assert send(client, p, 5, business_date="2026-10-31").status_code == 200
    assert get_bill(client, p, bill_id)["collection_status"] == "HISTORICAL_REVIEW"
    assert collect(client, p, bill_id).status_code == 409
    assert client.get(p["base"] + "/bills?limit=1", headers=p["owner"]).json()["next_cursor"]


@pytest.mark.parametrize(
    "field", ["card_pay_charges", "round_amt", "advance_amt", "coupon_discount", "loyalty_discount"]
)
def test_unknown_amounts_are_visible_but_not_collectible(client, pilot, field):
    bill_id = send(client, pilot, amounts={"net_amt": "1000", field: "1"}).json()["bill_id"]
    assert get_bill(client, pilot, bill_id)["payable_paise"] is None
    assert collect(client, pilot, bill_id).status_code == 409


def test_source_payment_fields_and_invalid_money_are_rejected(client, pilot):
    for extra in [{"CashPay": "1000"}, {"collections": []}, {"synthetic": False}, {"sequence": True}]:
        assert send(client, pilot, **extra).status_code == 422
    for amount in ["NaN", "Infinity", "-1", 12.50]:
        assert send(client, pilot, amounts={"net_amt": amount}).status_code == 422


def test_freshness_heartbeat_is_not_sync_and_offline_preserves_data(client, pilot):
    p = pilot
    db = client.app.state.db
    body = {"status": "OK", "pending_observations": 0}
    assert client.post(CONNECTOR + "/health", headers=p["auth"], json=body).status_code == 200
    status = client.get(p["base"] + "/status", headers=p["owner"]).json()
    assert status["connection"] == "CONNECTED" and status["stale"] and status["last_successful_sync"] is None
    bill_id = send(client, p).json()["bill_id"]
    db.radiosoft_bills.update_one({"_id": bill_id}, {"$set": {"observed_at": now() - timedelta(minutes=3)}})
    assert send(client, p).json()["replayed"]  # replay must not make stale data look fresh
    client.post(CONNECTOR + "/health", headers=p["auth"], json={**body, "status": "SOURCE_UNAVAILABLE"})
    status = client.get(p["base"] + "/status", headers=p["owner"]).json()
    assert status["stale"] and status["source_health"]["status"] == "SOURCE_UNAVAILABLE"
    assert len(client.get(p["base"] + "/bills", headers=p["owner"]).json()["bills"]) == 1


def test_evidence_does_not_double_count_and_rollback_preserves_manual_closed_days(client, pilot):
    from test_cashbook_modes import close, entry, start

    p = pilot
    # Exercise real manual BILLING closing before pilot operations.
    _, day_url, day = start(client, (p["owner"], p["shop"], None, None), "BILLING")
    day = entry(client, p["owner"], day_url, day, "EXPENSE", "100")
    closed = close(
        client,
        p["owner"],
        day_url,
        day,
        "1600",
        billing_input="TOTAL",
        total_sales="700",
        digital_sales="0",
        credit_sales="0",
    )
    assert closed.status_code == 200, closed.text
    original_days = list(client.app.state.db.hishob_days.find({"shop_id": p["shop"]}))
    bill_id = send(client, p).json()["bill_id"]
    paid = collect(
        client, p, bill_id, "RECEIVE", [allocation("UPI", 60000), allocation("UNSPECIFIED", 40000)]
    ).json()
    business_date = paid["collections"][0]["business_date"]
    evidence = {
        "request_id": "daily-evidence-one",
        "date": business_date,
        "scope": "ALL_PILOT_COLLECTIONS",
        "source": "Synthetic payment app",
        "upi_paise": 70000,
        "card_paise": 0,
    }
    for _ in range(2):
        assert (
            client.post(p["base"] + "/daily-evidence", headers=p["owner"], json=evidence).status_code == 200
        )
    summary = client.get(p["base"] + "/daily-evidence/" + business_date, headers=p["owner"]).json()
    assert len(summary["evidence"]) == 1 and summary["difference"]["UPI"] == 10000
    assert summary["recorded"]["UNSPECIFIED"] == 40000 and summary["fully_reconciled"] is False
    assert list(client.app.state.db.hishob_days.find({"shop_id": p["shop"]})) == original_days
    status = client.get(p["base"] + "/status", headers=p["owner"]).json()
    assert (
        client.put(
            p["base"] + "/settings",
            headers=p["owner"],
            json={"revision": status["revision"], "mode": "ACCOUNTING"},
        ).status_code
        == 422
    )
    assert (
        client.put(
            p["base"] + "/settings", headers=p["owner"], json={"revision": status["revision"], "mode": "OFF"}
        ).status_code
        == 200
    )
    assert send(client, p, 2).status_code == 401
    assert client.get(p["base"] + "/bills", headers=p["owner"]).status_code == 403
    assert client.app.state.db.radiosoft_bills.find_one({"_id": bill_id})["events"]
    status = client.get(p["base"] + "/status", headers=p["owner"]).json()
    assert (
        client.put(
            p["base"] + "/settings",
            headers=p["owner"],
            json={"revision": status["revision"], "mode": "PREVIEW"},
        ).status_code
        == 200
    )
    assert send(client, p, 2).status_code == 401  # Re-enable never restores revoked credential.
    assert get_bill(client, p, bill_id)["collected_paise"] == 100000


def test_queued_old_observation_does_not_claim_fresh_source(client, pilot):
    p = pilot
    old = (now() - timedelta(hours=2)).isoformat()
    assert send(client, p, observed_at=old).status_code == 200
    status = client.get(p["base"] + "/status", headers=p["owner"]).json()
    assert status["last_successful_sync"] and status["stale"]
    assert send(client, p, 2, observed_at=(now() + timedelta(hours=1)).isoformat()).status_code == 422
    assert send(client, p, 2, observed_at=now().isoformat()).status_code == 200
    assert not client.get(p["base"] + "/status", headers=p["owner"]).json()["stale"]


def test_source_and_cashier_race_commit_only_one_revision(client, pilot, monkeypatch):
    import threading

    from app import radiosoft

    p = pilot
    bill_id = send(client, p).json()["bill_id"]
    barrier = threading.Barrier(2)
    save = radiosoft.save_bill

    def competing_save(db, bill, previous_revision):
        barrier.wait(timeout=5)
        return save(db, bill, previous_revision)

    monkeypatch.setattr(radiosoft, "save_bill", competing_save)
    with ThreadPoolExecutor(max_workers=2) as pool:
        source = pool.submit(send, client, p, 2, amounts={"net_amt": "800"})
        cashier = pool.submit(collect, client, p, bill_id)
        responses = [source.result(), cashier.result()]
    assert sorted(r.status_code for r in responses) == [200, 409]
    bill = get_bill(client, p, bill_id)
    assert bill["revision"] == 2
    assert (bill["payable_paise"], bill["collected_paise"]) in [(80000, 0), (100000, 100000)]


def test_bill_ids_cannot_cross_two_approved_shops(client, pilot):
    p = pilot
    first_bill = send(client, p).json()["bill_id"]
    owner2 = login(client, "+919876500003")
    second = client.post("/api/shops", headers=owner2, json={"name": "Same source label"}).json()["id"]
    db = client.app.state.db
    client.app.state.settings.radiosoft_pilots.append(
        {
            "shop_id": second,
            "owner_id": db.shops.find_one({"_id": second})["created_by"],
            "source_id": "synthetic-installation",
            "firm_codes": [0, 1],
            "tracking_from": "2026-11-01",
        }
    )
    base = f"/api/shops/{second}/radiosoft"
    assert (
        client.put(base + "/settings", headers=owner2, json={"revision": 0, "mode": "PREVIEW"}).status_code
        == 200
    )
    assert client.get(base + f"/bills/{first_bill}", headers=owner2).status_code == 404
    assert (
        client.post(
            base + f"/bills/{first_bill}/collections",
            headers=owner2,
            json={"request_id": "cross-shop-attempt", "revision": 1, "action": "MARK_PAID"},
        ).status_code
        == 404
    )
    assert client.get(base + "/bills", headers=owner2).json()["bills"] == []
    assert client.get(base + "/daily-evidence/2026-11-01", headers=owner2).json()["evidence"] == []


def test_local_demo_helper_pairs_and_simulates_changes(client, pilot, monkeypatch):
    from scripts import radiosoft_demo

    p = pilot
    code = client.post(p["base"] + "/pairing", headers=p["owner"]).json()["code"]
    monkeypatch.setattr(radiosoft_demo.getpass, "getpass", lambda _: code)
    actions = iter(["+", "-", "m", "c", "u", "h", "r", "q"])
    monkeypatch.setattr("builtins.input", lambda _: next(actions))

    def local_post(api, path, body, credential=None):
        assert api == "http://localhost:8000"
        response = client.post(
            CONNECTOR + "/" + path,
            json=body,
            headers={"Authorization": "Bearer " + credential} if credential else {},
        )
        assert response.status_code == 200, response.text
        return response.json()

    monkeypatch.setattr(radiosoft_demo, "post", local_post)
    radiosoft_demo.demo("http://localhost:8000")
    rows = client.get(p["base"] + "/bills", headers=p["owner"]).json()["bills"]
    assert len(rows) == 3
    assert sorted(row["payable_paise"] for row in rows) == [75000, 80000, 150000]
    assert all(row["source_status"] == "CURRENT" and row["collected_paise"] == 0 for row in rows)
    changed = next(row for row in rows if row["payable_paise"] == 80000)
    versions = get_bill(client, p, changed["id"])["versions"]
    assert {v["snapshot"]["source_status"] for v in versions} == {"CURRENT", "MISSING_REVIEW", "CANCELLED"}
    assert client.get(p["base"] + "/status", headers=p["owner"]).json()["connection"] == "CONNECTED"


def test_demo_helper_refuses_remote_addresses():
    import argparse

    from scripts.radiosoft_demo import local_api

    assert local_api("http://localhost:8000/") == "http://localhost:8000"
    for address in [
        "https://production.example",
        "http://10.0.0.1:8000",
        "http://localhost:8000/path",
        "http://secret@localhost:8000",
    ]:
        with pytest.raises(argparse.ArgumentTypeError):
            local_api(address)


def test_cash_counter_search_queues_rollups_and_stable_order(client, pilot):
    p = pilot
    first = send(client, p).json()["bill_id"]
    second = send(
        client, p, key={**p["observation"]["key"], "invoice_no": "2002"}, amounts={"net_amt": "750"}
    ).json()["bill_id"]
    third = send(
        client, p, key={**p["observation"]["key"], "invoice_no": "3003"}, amounts={"net_amt": "500"}
    ).json()["bill_id"]

    def listing(**params):
        result = client.get(p["base"] + "/bills", params=params, headers=p["owner"])
        assert result.status_code == 200, result.text
        return result.json()

    assert [row["id"] for row in listing()["bills"]] == [third, second, first]
    assert send(client, p, 2).status_code == 200
    assert [row["id"] for row in listing()["bills"]] == [third, second, first]
    page = listing(limit=1, status="PENDING")
    assert page["summary"]["billed_paise"] == 225000
    assert page["next_cursor"] == third
    assert collect(client, p, third).status_code == 200
    assert listing(limit=1, status="PENDING", after=third)["bills"][0]["id"] == second
    assert listing(status="PENDING")["counts"] == {
        "ALL": 3,
        "PENDING": 2,
        "CREDIT": 0,
        "PAID": 1,
        "REVIEW": 0,
    }
    assert listing(status="PAID")["bills"][0]["id"] == third
    assert listing(search="002")["bills"][0]["id"] == second
    assert len(listing(search="999")["bills"]) == 0
    assert listing(business_date="2026-11-02")["summary"]["billed_paise"] == 0
    assert client.get(p["base"] + "/bills?search=.*", headers=p["owner"]).status_code == 422
    # Multi-worker attribution never multiplies the header sale or its receipts.
    lines = deepcopy(p["observation"]["lines"])
    lines[0].update(salesperson_ref="w1", salesperson_name="Worker One")
    lines.append({**lines[0], "salesperson_ref": "w2", "salesperson_name": "Worker Two"})
    assert send(client, p, 3, lines=lines).status_code == 200
    assert listing(worker="w2")["summary"]["billed_paise"] == 100000
    assert listing(worker="w1")["bills"][0]["salespeople"] == ["Worker One", "Worker Two"]
    assert (
        send(client, p, 4, source_status="CANCELLED", lifecycle_evidence="Synthetic cancellation").status_code
        == 200
    )
    reviewed = listing(status="REVIEW")
    assert reviewed["bills"][0]["id"] == first
    assert reviewed["summary"]["billed_paise"] == 125000
    assert reviewed["summary"]["excluded_bills"] == 1


def test_waiver_is_audited_reversible_and_never_money(client, pilot):
    p = pilot
    bill_id = send(client, p).json()["bill_id"]
    assert collect(client, p, bill_id, "RECEIVE", [allocation("CASH", 90000)]).status_code == 200
    assert collect(client, p, bill_id, "WAIVE", amount_paise=10000).status_code == 422
    assert collect(client, p, bill_id, "WAIVE", amount_paise=10001, reason="Too much").status_code == 409
    body = dict(
        revision=2,
        request_id="waiver-retry-key",
        action="WAIVE",
        amount_paise=10000,
        reason="Approved goodwill discount",
    )
    url = p["base"] + f"/bills/{bill_id}/collections"
    for _ in range(2):
        result = client.post(url, headers=p["owner"], json=body)
        assert result.status_code == 200, result.text
        row = result.json()
        assert (
            row["payable_paise"],
            row["collected_paise"],
            row["waived_paise"],
            row["outstanding_paise"],
        ) == (100000, 90000, 10000, 0)
        assert len(row["collections"]) == 1 and len(row["waivers"]) == 1
    totals = client.get(p["base"] + "/bills", headers=p["owner"]).json()["summary"]
    assert totals["collected_paise"] == 90000 and totals["waived_paise"] == 10000
    assert collect(client, p, bill_id, "MARK_PAID").status_code == 409
    assert send(client, p, 2, amounts={"net_amt": "950"}).status_code == 200
    changed = get_bill(client, p, bill_id)
    assert changed["review_required"] and changed["outstanding_paise"] == -5000
    reversed_waiver = collect(
        client, p, bill_id, "REVERSE_WAIVER", adjustment_id="waiver-retry-key", reason="Source bill corrected"
    )
    assert reversed_waiver.status_code == 200, reversed_waiver.text
    assert reversed_waiver.json()["outstanding_paise"] == 5000
    assert reversed_waiver.json()["waived_paise"] == 0
    assert reversed_waiver.json()["collected_paise"] == 90000
    assert (
        collect(
            client, p, bill_id, "REVERSE_WAIVER", adjustment_id="waiver-retry-key", reason="Again"
        ).status_code
        == 409
    )


def test_waiver_permissions_and_concurrent_payment(client, pilot):
    p = pilot
    bill_id = send(client, p).json()["bill_id"]
    client.post(
        f"/api/shops/{p['shop']}/managers",
        headers=p["owner"],
        json={"name": "Manager", "mobile": "+919876500009"},
    )
    manager = login(client, "+919876500009", "MANAGER")
    status = client.get(p["base"] + "/status", headers=p["owner"]).json()
    client.put(
        p["base"] + "/settings",
        headers=p["owner"],
        json={
            "revision": status["revision"],
            "mode": "PREVIEW",
            "manager_view": True,
            "manager_collect": True,
        },
    )
    body = dict(
        revision=1,
        request_id="waiver-manager-test",
        action="WAIVE",
        amount_paise=100000,
        reason="Test discount",
    )
    url = p["base"] + f"/bills/{bill_id}/collections"
    assert client.post(url, headers=manager, json=body).status_code == 403
    assert client.post(url, headers=p["worker"], json=body).status_code == 403
    payment = dict(revision=1, request_id="cashier-racing-waiver", action="MARK_PAID")
    with ThreadPoolExecutor(2) as pool:
        outcomes = list(
            pool.map(
                lambda payload: client.post(url, headers=p["owner"], json=payload).status_code,
                [body, payment],
            )
        )
    assert sorted(outcomes) == [200, 409]
    result = get_bill(client, p, bill_id)
    assert result["collected_paise"] + result["waived_paise"] == 100000


def test_demo_auto_sync_and_outage_pause(client, pilot, monkeypatch):
    from scripts import radiosoft_demo

    p = pilot
    code = client.post(p["base"] + "/pairing", headers=p["owner"]).json()["code"]
    monkeypatch.setattr(radiosoft_demo.getpass, "getpass", lambda _: code)
    # Drive timer expirations without sleeping or reading terminal input.
    commands = iter([None, "h", None, "r", "q"])

    class TimerQueue:
        def get(self, timeout):
            value = next(commands)
            if value is None:
                raise radiosoft_demo.queue.Empty
            return value

    class NoReader:
        def __init__(self, **kwargs):
            pass

        def start(self):
            pass

    monkeypatch.setattr(radiosoft_demo.queue, "Queue", TimerQueue)
    monkeypatch.setattr(radiosoft_demo.threading, "Thread", NoReader)
    statuses = []
    observations = []

    def local_post(api, path, body, credential=None):
        if path == "health":
            statuses.append(body["status"])
        if path == "observations":
            observations.append(deepcopy(body))
        response = client.post(
            CONNECTOR + "/" + path,
            json=body,
            headers={"Authorization": "Bearer " + credential} if credential else {},
        )
        assert response.status_code == 200, response.text
        return response.json()

    monkeypatch.setattr(radiosoft_demo, "post", local_post)
    radiosoft_demo.demo("http://localhost:8001")
    assert statuses == ["OK", "OK", "SOURCE_UNAVAILABLE", "OK"]
    assert len(observations) == 9
    assert len({item["sequence"] for item in observations}) == 9
    assert observations[3]["observed_at"] >= observations[0]["observed_at"]


def test_atomic_settlement_discount_retry_and_independent_reversal(client, pilot):
    p = pilot
    bill_id = send(client, p).json()["bill_id"]
    url = p["base"] + f"/bills/{bill_id}/collections"
    body = dict(
        request_id="counter-settle-001",
        revision=1,
        action="SETTLE",
        allocations=[allocation("CASH", 90000)],
        remainder="DISCOUNT",
        note="Paid at counter",
    )
    for _ in range(2):
        response = client.post(url, headers=p["owner"], json=body)
        assert response.status_code == 200, response.text
        result = response.json()
        assert (result["collected_paise"], result["waived_paise"], result["outstanding_paise"]) == (
            90000,
            10000,
            0,
        )
        assert len(result["events"]) == len(result["collections"]) == len(result["waivers"]) == 1
    assert client.post(url, headers=p["owner"], json={**body, "note": "Changed retry"}).status_code == 409
    assert (
        collect(
            client,
            p,
            bill_id,
            "REVERSE",
            collection_id="counter-settle-001",
            reason="Payment entered in error",
        ).status_code
        == 200
    )
    result = get_bill(client, p, bill_id)
    assert (result["collected_paise"], result["waived_paise"], result["outstanding_paise"]) == (
        0,
        10000,
        90000,
    )
    assert (
        collect(
            client,
            p,
            bill_id,
            "REVERSE_WAIVER",
            adjustment_id="counter-settle-001",
            reason="Undo agreed discount",
        ).status_code
        == 200
    )
    assert get_bill(client, p, bill_id)["outstanding_paise"] == 100000


def test_customer_credit_notes_search_and_later_collection(client, pilot):
    p = pilot
    bill_id = send(client, p).json()["bill_id"]
    response = collect(
        client,
        p,
        bill_id,
        "SETTLE",
        [],
        remainder="CREDIT",
        customer_name="Demo Customer",
        note="Pay after Friday [family]",
    )
    assert response.status_code == 200, response.text
    assert response.json()["credit"] and response.json()["collected_paise"] == 0

    def listing(**params):
        return client.get(p["base"] + "/bills", headers=p["owner"], params=params).json()

    assert listing(status="PENDING")["bills"] == []
    credit = listing(status="CREDIT", q="demo customer")
    assert len(credit["bills"]) == 1 and credit["summary"]["credit_paise"] == 100000
    assert len(listing(q="[family]")["bills"]) == 1
    assert listing(q=".*")["bills"] == []  # literal text, not executable regex
    assert collect(client, p, bill_id, "NOTE", note="Follow up Monday").status_code == 200
    assert len(listing(q="monday")["bills"]) == 1
    partial = collect(
        client, p, bill_id, "SETTLE", [allocation("UPI", 40000)], remainder="PENDING", note="Part paid"
    )
    assert partial.status_code == 200 and partial.json()["credit"]
    assert partial.json()["customer_name"] == "Demo Customer"
    assert listing(status="CREDIT")["summary"]["credit_paise"] == 60000
    final = collect(client, p, bill_id, "SETTLE", [allocation("CASH", 60000)], remainder="PENDING")
    assert final.status_code == 200 and not final.json()["credit"]
    assert final.json()["collected_paise"] == 100000 and final.json()["waived_paise"] == 0
    assert listing(status="CREDIT")["bills"] == []
    assert len(listing(status="PAID", q="Friday")["bills"]) == 1
    assert len(final.json()["collections"]) == 2


def test_settlement_permissions_shape_and_source_concurrency(client, pilot):
    p = pilot
    bill_id = send(client, p).json()["bill_id"]
    url = p["base"] + f"/bills/{bill_id}/collections"
    for changes, expected in [
        ({"allocations": [], "remainder": "PENDING"}, 409),
        ({"allocations": [], "remainder": "CREDIT"}, 422),
        ({"allocations": [allocation("CASH", 100001)], "remainder": "PENDING"}, 409),
    ]:
        response = client.post(
            url,
            headers=p["owner"],
            json={"request_id": secrets.token_hex(16), "revision": 1, "action": "SETTLE", **changes},
        )
        assert response.status_code == expected, response.text
    assert len(get_bill(client, p, bill_id)["events"]) == 0
    client.post(
        f"/api/shops/{p['shop']}/managers",
        headers=p["owner"],
        json={"name": "Manager", "mobile": "+919876500018"},
    )
    manager = login(client, "+919876500018", "MANAGER")
    status = client.get(p["base"] + "/status", headers=p["owner"]).json()
    client.put(
        p["base"] + "/settings",
        headers=p["owner"],
        json={
            "revision": status["revision"],
            "mode": "PREVIEW",
            "manager_view": True,
            "manager_collect": True,
        },
    )
    body = dict(
        request_id="manager-settle-001",
        revision=1,
        action="SETTLE",
        allocations=[allocation("CASH", 90000)],
        remainder="DISCOUNT",
        reason="Discount",
    )
    assert client.post(url, headers=manager, json=body).status_code == 403
    assert not get_bill(client, p, bill_id)["events"]  # even the receipt was not committed
    assert send(client, p, 2, amounts={"net_amt": "1200"}).status_code == 200
    assert client.post(url, headers=p["owner"], json=body).status_code == 409
    assert not get_bill(client, p, bill_id)["events"]
    assert (
        send(
            client, p, 3, source_status="MISSING_REVIEW", lifecycle_evidence="Synthetic missing bill"
        ).status_code
        == 200
    )
    body["revision"] = 3
    assert client.post(url, headers=p["owner"], json=body).status_code == 409


def test_counter_discount_and_payment_note_are_optional(client, pilot):
    p = pilot
    bill_id = send(client, p).json()["bill_id"]
    response = collect(client, p, bill_id, "SETTLE", [allocation("CASH", 90000)], remainder="DISCOUNT")
    assert response.status_code == 200, response.text
    row = response.json()
    assert (row["collected_paise"], row["waived_paise"], row["outstanding_paise"]) == (90000, 10000, 0)
    assert row["events"][0]["reason"] == "" and row["notes"] == []
