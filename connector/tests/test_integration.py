"""Real unchanged FastAPI contract + disposable loopback Mongo, fake data only."""

import json
import time
from datetime import datetime, timedelta, timezone

import pytest
from conftest import BackendTransport, new_code, pair

from hishob_connector.contract import encoded
from hishob_connector.engine import Engine
from hishob_connector.store import Store
from hishob_connector.synthetic import scan

pytestmark = pytest.mark.integration


def ready(store):
    store.db.execute("UPDATE outbox SET retry_at=0")
    pending = store.get("pending_pair")
    if pending:
        pending["retry_at"] = 0
        store.put("pending_pair", pending)


def test_lost_pair_response_restart_uses_identical_proof(store, vault, backend):
    transport = BackendTransport(backend)
    transport.lose = "pair"
    store.queue_pair("http://127.0.0.1:8000", new_code(backend))
    Engine(store, transport).tick()
    assert store.get("mode") == "PAIRING"
    original = transport.calls[0][1]
    reopened = Store(store.directory, vault)
    try:
        ready(reopened)
        Engine(reopened, transport).tick()
        assert reopened.get("mode") == "RUNNING"
        assert transport.calls[1][1] == original
        assert reopened.get("credential") == json.loads(original)["credential"]
    finally:
        reopened.close()


def test_lost_acceptance_restart_duplicate_has_one_effect(store, vault, backend):
    transport = BackendTransport(backend)
    engine = pair(store, backend, transport)
    transport.lose = "observations"
    engine.tick()
    original = next(b for p, b in transport.calls if p == "observations")
    assert store.head()["body"] == original
    assert backend["db"].radiosoft_bills.count_documents({}) == 1
    reopened = Store(store.directory, vault)
    try:
        ready(reopened)
        Engine(reopened, transport).tick()
        assert reopened.get("last_acknowledged_sequence") == 1
        assert reopened.head()["sequence"] == 2
        requests = [b for p, b in transport.calls if p == "observations"]
        assert requests == [original, original]
        bill = backend["db"].radiosoft_bills.find_one({})
        assert len(bill["versions"]) == 1 and bill["events"] == []
        replay = transport.post("observations", original, reopened.get("credential"))
        assert replay["replayed"] is True
        assert replay["accepted_at"] == reopened.get("last_successful_sync")
    finally:
        reopened.close()


def test_outage_ordered_recovery_and_source_failure(store, backend):
    transport = BackendTransport(backend)
    engine = pair(store, backend, transport)
    transport.fail = 503
    engine.tick()
    first = store.head()["body"]
    assert store.count() == 3 and store.get("last_successful_sync") is None
    # Capture another full scan while disconnected; old envelopes stay unchanged.
    store.put("last_scan", 0)
    ready(store)
    engine.tick()
    assert store.count() == 6 and store.head()["body"] == first
    transport.fail = None
    for _ in range(6):
        ready(store)
        engine.tick()
    assert store.count() == 0 and store.get("last_acknowledged_sequence") == 6
    assert backend["db"].radiosoft_bills.count_documents({}) == 3
    accepted = store.get("last_successful_sync")
    store.put("scenario", "source_outage")
    store.put("last_scan", 0)
    store.put("last_health_attempt", 0)
    engine.tick()
    assert store.get("source_health") == "SOURCE_UNAVAILABLE"
    assert store.get("last_successful_sync") == accepted
    assert backend["db"].radiosoft_integrations.find_one({})["health"]["status"] == "SOURCE_UNAVAILABLE"


def test_revoke_stops_delivery_and_repair_preserves_pending_order(store, backend):
    transport = BackendTransport(backend)
    engine = pair(store, backend, transport)
    engine.tick()
    head = store.head()["body"]
    assert backend["client"].post(backend["base"] + "/revoke", headers=backend["owner"]).status_code == 200
    engine.tick()
    assert store.get("mode") == "REVOKED_OR_DISABLED"
    calls = len(transport.calls)
    engine.tick()
    assert len(transport.calls) == calls and store.head()["body"] == head
    pair(store, backend, transport)
    assert store.head()["body"] == head and store.get("sequence") == 3
    engine.tick()
    assert store.get("last_acknowledged_sequence") == 2


def test_conflict_never_mints_new_sequence_or_skips_head(store, backend):
    transport = BackendTransport(backend)
    engine = pair(store, backend, transport)
    transport.fail = 409
    transport.fail_path = "observations"
    for _ in range(4):
        ready(store)
        engine.tick()
    assert store.get("mode") == "OUTBOX_BLOCKED"
    attempts = [b for p, b in transport.calls if p == "observations"]
    assert len(attempts) == 4 and len(set(attempts)) == 1
    assert store.get("sequence") == 3 and store.count() == 3


def test_old_queue_replay_and_health_do_not_claim_fresh_source(store, backend):
    transport = BackendTransport(backend)
    engine = pair(store, backend, transport)
    old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    store.enqueue_scan(scan(store.get("identity"), store.get("binding"), "baseline"), old)
    engine.tick()
    assert store.status()["stale"] is True
    assert store.get("last_delivered_source_observation") == old
    assert store.get("last_contact") is not None


def test_real_ingestion_and_accounting_remain_rejected(store, backend):
    transport = BackendTransport(backend)
    engine = pair(store, backend, transport)
    engine.tick()
    body = json.loads(store.head()["body"])
    body["synthetic"] = False
    response = backend["client"].post(
        "/api/radiosoft/connector/observations",
        content=encoded(body),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + store.get("credential")},
    )
    assert response.status_code == 422
    status = backend["client"].get(backend["base"] + "/status", headers=backend["owner"]).json()
    result = backend["client"].put(
        backend["base"] + "/settings",
        headers=backend["owner"],
        json={"revision": status["revision"], "mode": "ACCOUNTING"},
    )
    assert result.status_code == 422


def test_real_http_transport_to_isolated_backend(store, backend):
    import socket
    import threading

    import uvicorn

    from hishob_connector.transport import HttpTransport

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(backend["client"].app, lifespan="off", log_level="critical"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.02)
        assert server.started
        api = f"http://127.0.0.1:{sock.getsockname()[1]}"
        store.queue_pair(api, new_code(backend))
        engine = Engine(store, HttpTransport(api))
        engine.tick()
        engine.tick()
        assert store.get("last_acknowledged_sequence") == 1
        assert backend["db"].radiosoft_bills.count_documents({}) == 1
    finally:
        server.should_exit = True
        thread.join(10)
        sock.close()
    assert not thread.is_alive()


def test_expired_pair_requires_new_owner_code_without_reset(store, backend):
    from app.db import now

    transport = BackendTransport(backend)
    store.queue_pair("http://127.0.0.1:8000", new_code(backend))
    backend["db"].radiosoft_integrations.update_one(
        {}, {"$set": {"pairing.expires_at": now() - timedelta(seconds=1)}}
    )
    Engine(store, transport).tick()
    assert store.get("mode") == "REPAIR_REQUIRED" and store.get("sequence") == 0
    store.cancel_pair()
    pair(store, backend, transport)


def test_salespeople_multiset_and_source_updates_preserve_settlement(store, backend):
    import secrets

    transport = BackendTransport(backend)
    engine = pair(store, backend, transport)
    engine.tick()
    bill = backend["db"].radiosoft_bills.find_one({})
    url = backend["base"] + "/bills/" + bill["_id"]
    client, owner = backend["client"], backend["owner"]
    result = client.post(
        url + "/collections",
        headers=owner,
        json={
            "revision": 1,
            "request_id": secrets.token_hex(16),
            "action": "SETTLE",
            "allocations": [{"method": "CASH", "amount_paise": 90000}],
            "remainder": "DISCOUNT",
            "note": "Synthetic collection and waiver test",
        },
    )
    assert result.status_code == 200, result.text
    events = client.get(url, headers=owner).json()["events"]

    def scenario(name):
        # Drain prior scan, then capture exactly one new scan.
        while store.count():
            engine.tick()
        store.put("scenario", name)
        store.put("last_scan", 0)
        engine.tick()
        return client.get(url, headers=owner).json()

    changed = scenario("salesperson_change")
    assert changed["snapshot"]["lines"][0]["salesperson_ref"] == "102"
    assert len(changed["versions"]) == 2 and changed["events"] == events
    multi = scenario("multiple_salespeople")
    assert {x["salesperson_ref"] for x in multi["snapshot"]["lines"]} == {"101", "102"}
    assert {(x["salesperson_ref"], x["salesperson_name"]) for x in multi["snapshot"]["lines"]} == {
        ("101", "Synthetic seller A"),
        ("102", "Synthetic seller B"),
    }
    assert multi["payable_paise"] == 100000 and multi["waived_paise"] == 10000
    workers = client.get(backend["base"] + "/bills?worker=102", headers=owner).json()
    assert len(workers["bills"]) == 1 and workers["summary"]["billed_paise"] == 100000
    duplicated = scenario("duplicate_items")
    assert len(duplicated["snapshot"]["lines"]) == 3
    reordered = scenario("reordered_items")
    assert len(reordered["versions"]) == len(duplicated["versions"])
    unresolved = scenario("missing_salesperson")
    assert unresolved["snapshot"]["lines"][0]["salesperson_ref"] == "999"
    assert unresolved["snapshot"]["lines"][0]["salesperson_name"] == ""
    increased = scenario("increase")
    assert increased["outstanding_paise"] == 20000 and increased["events"] == events
    reduced = scenario("decrease")
    assert reduced["outstanding_paise"] == -20000 and reduced["review_required"]
    cancelled = scenario("cancelled")
    assert cancelled["collected_paise"] == 90000 and cancelled["events"] == events
    assert cancelled["waived_paise"] == 10000  # No inferred refund or second waiver.


def test_packaged_schema_matches_current_backend_model():
    from app.radiosoft_schemas import Observation

    from hishob_connector.contract import SCHEMA

    # Compare against executable backend code, not only its checked-in schema export.
    assert SCHEMA == Observation.model_json_schema()


@pytest.mark.parametrize("second_source", ["synthetic-installation", "another-synthetic-source"])
def test_two_paired_shops_keep_identical_bill_keys_isolated(store, backend, second_source):
    transport = BackendTransport(backend)
    engine = pair(store, backend, transport)
    engine.tick()
    first = backend["db"].radiosoft_bills.find_one({})
    client, owner = backend["client"], backend["owner"]
    shop = client.post("/api/shops", headers=owner, json={"name": "Second synthetic shop"}).json()["id"]
    scope = {**backend["settings"].radiosoft_pilots[0], "shop_id": shop, "source_id": second_source}
    backend["settings"].radiosoft_pilots.append(scope)
    base = f"/api/shops/{shop}/radiosoft"
    assert (
        client.put(base + "/settings", headers=owner, json={"revision": 0, "mode": "PREVIEW"}).status_code
        == 200
    )
    import secrets

    credential = secrets.token_urlsafe(32)
    code = client.post(base + "/pairing", headers=owner).json()["code"]
    response = client.post("/api/radiosoft/connector/pair", json={"code": code, "credential": credential})
    assert response.status_code == 200
    binding = response.json()
    body = {**first["snapshot"], "sequence": 1, "observed_at": datetime.now(timezone.utc).isoformat()}
    body.update(source_id=binding["source_id"], generation=binding["generation"])
    headers = {"Authorization": "Bearer " + credential}
    endpoint = "/api/radiosoft/connector/observations"
    accepted = client.post(endpoint, headers=headers, json=body)
    assert accepted.status_code == 200
    assert accepted.json()["bill_id"] != first["_id"]
    assert backend["db"].radiosoft_bills.count_documents({}) == 2
    assert client.get(base + "/bills/" + first["_id"], headers=owner).status_code == 404
    for changes in (
        {"source_id": "unapproved"},
        {"generation": first["generation"]},
        {"key": {**body["key"], "firm_code": 99}},
    ):
        assert client.post(endpoint, headers=headers, json={**body, **changes}).status_code == 403
    assert client.post(endpoint + "?shop_id=" + shop, headers=headers, json=body).status_code == 400
    assert client.post(endpoint, headers={**headers, "X-Hishob-Shop": shop}, json=body).status_code == 400
    scope["source_id"] = "changed-deployment-scope"
    assert client.post(endpoint, headers=headers, json=body).status_code == 401
    assert backend["db"].radiosoft_bills.find_one({"_id": first["_id"]}) == first


@pytest.mark.parametrize("remainder", ["CREDIT", "DISCOUNT"])
def test_source_delivery_retains_notes_credit_waivers_and_receipts(store, backend, remainder):
    transport = BackendTransport(backend)
    engine = pair(store, backend, transport)
    engine.tick()
    bill = backend["db"].radiosoft_bills.find_one({})
    client, owner = backend["client"], backend["owner"]
    url = backend["base"] + "/bills/" + bill["_id"]
    settlement = {
        "revision": 1,
        "request_id": "integration-settlement",
        "action": "SETTLE",
        "allocations": [{"method": "UPI", "amount_paise": 40000}],
        "remainder": remainder,
        "customer_name": "Synthetic customer" if remainder == "CREDIT" else "",
    }
    response = client.post(url + "/collections", headers=owner, json=settlement)
    assert response.status_code == 200
    response = client.post(
        url + "/collections",
        headers=owner,
        json={
            "revision": response.json()["revision"],
            "request_id": "integration-bill-note",
            "action": "NOTE",
            "note": "Synthetic follow-up note",
        },
    )
    assert response.status_code == 200
    # Read the persisted baseline: BSON timestamps have millisecond precision,
    # while the immediate POST response can still contain Python microseconds.
    before = client.get(url, headers=owner).json()
    for scenario_name in ("multiple_salespeople", "increase", "missing", "cancelled", "baseline"):
        for _ in range(store.count()):
            engine.tick()
        assert store.count() == 0
        store.put("scenario", scenario_name)
        store.put("last_scan", 0)
        engine.tick()
        after = client.get(url, headers=owner).json()
        for field in ("events", "collections", "notes", "waivers", "customer_name", "credit"):
            assert after[field] == before[field]
        assert after["collected_paise"] == 40000
        assert after["waived_paise"] == (60000 if remainder == "DISCOUNT" else 0)
    summary = client.get(backend["base"] + "/bills", headers=owner).json()["summary"]
    assert summary["billed_paise"] == 325000  # Three headers, irrespective of item attribution.
    assert summary["collected_paise"] == 40000
    assert summary["credit_paise"] == (60000 if remainder == "CREDIT" else 0)

    body = json.loads(store.head()["body"])
    for extra in ({"CashPay": "750"}, {"collections": []}, {"UserID": "billing-operator"}):
        response = client.post(
            "/api/radiosoft/connector/observations",
            headers={"Authorization": "Bearer " + store.get("credential")},
            json={**body, **extra},
        )
        assert response.status_code == 422
    assert client.get(url, headers=owner).json()["events"] == before["events"]
