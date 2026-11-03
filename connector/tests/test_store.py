import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

import pytest

from hishob_connector.contract import local_api
from hishob_connector.store import Store
from hishob_connector.synthetic import SyntheticScan, scan

BINDING = {
    "version": 1,
    "shop_id": "fake-shop",
    "source_id": "synthetic-installation",
    "generation": "fake-generation",
    "firm_codes": [0],
    "invoice_types": [0, 1],
    "tracking_from": "2026-11-01",
    "synthetic_only": True,
    "next_action": "SEND_SYNTHETIC_OBSERVATIONS",
}


def bound(store):
    store.queue_pair("http://127.0.0.1:8000", secrets.token_urlsafe(24))
    store.finish_pair(store.get("pending_pair")["id"], BINDING)


def capture(store):
    return store.enqueue_scan(
        scan(store.get("identity"), BINDING, "baseline"), datetime.now(timezone.utc).isoformat()
    )


def test_contract_schema_is_identical_to_backend():
    root = Path(__file__).resolve().parents[2]
    assert json.loads((root / "docs/radiosoft-observation.schema.json").read_text()) == json.loads(
        (root / "connector/hishob_connector/observation.schema.json").read_text()
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com",
        "http://localhost:8000",
        "http://127.0.0.1:8000/api",
        "http://user:pass@127.0.0.1:8000",
        "http://127.0.0.1:8000?x=1",
        "http://127.0.0.1.example.com:8000",
    ],
)
def test_remote_or_ambiguous_endpoints_refused(url):
    with pytest.raises(ValueError):
        local_api(url)


def test_dpapi_and_status_never_expose_pairing_secrets(store):
    code = secrets.token_urlsafe(24)
    store.queue_pair("http://127.0.0.1:8000", code)
    credential = store.get("pending_pair")["body"]["credential"]
    assert code not in json.dumps(store.status()) and credential not in json.dumps(store.status())
    if os.name == "nt":
        raw = store.path.read_bytes()
        assert code.encode() not in raw and credential.encode() not in raw
        from hishob_connector.security import DPAPI

        encrypted = DPAPI().seal(b"test-secret")
        assert DPAPI().open(encrypted) == b"test-secret"
        with pytest.raises(Exception):
            DPAPI().open(encrypted[:-8] + b"tampered")


def test_restart_retains_exact_queue_and_sequence(store, vault):
    bound(store)
    capture(store)
    first = store.head()
    with StoreContext(store.directory, vault) as reopened:
        assert reopened.head()["body"] == first["body"]
        assert reopened.get("sequence") == 3 and reopened.get("scan_checkpoint") == 1
        assert reopened.get("credential") == store.get("credential")
    store.acknowledge(
        1, {"sequence": 1, "bill_id": "b", "accepted_at": "2026-11-01T00:00:00Z", "replayed": False}
    )
    assert store.head()["sequence"] == 2
    assert store.db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0] == 1


class StoreContext:
    def __init__(self, path, vault):
        self.store = Store(path, vault)

    def __enter__(self):
        return self.store

    def __exit__(self, *_):
        self.store.close()


def test_partial_scan_rolls_back_everything(store):
    bound(store)
    snapshots = scan(store.get("identity"), BINDING, "baseline").snapshots
    broken = SyntheticScan((snapshots[0], {**snapshots[1], "synthetic": False}))
    with pytest.raises(ValueError):
        store.enqueue_scan(broken, datetime.now(timezone.utc).isoformat())
    assert store.count() == store.get("sequence") == store.get("scan_checkpoint") == 0


def test_non_synthetic_payload_cannot_be_relabeled_by_queue(store):
    bound(store)
    with pytest.raises(TypeError):
        store.enqueue_scan([{"NetAmt": 1000, "source_kind": "REAL_LOCAL_ONLY"}], "2026-11-01T00:00:00Z")
    assert store.count() == 0


def test_repair_preserves_queue_and_rejects_rebinding(store):
    bound(store)
    capture(store)
    payload = store.head()["body"]
    store.queue_pair("http://127.0.0.1:8000", secrets.token_urlsafe(24))
    store.finish_pair(store.get("pending_pair")["id"], BINDING)
    assert store.head()["body"] == payload and store.get("sequence") == 3
    store.queue_pair("http://127.0.0.1:8000", secrets.token_urlsafe(24))
    assert not store.finish_pair(store.get("pending_pair")["id"], {**BINDING, "generation": "other"})
    assert store.get("mode") == "BINDING_MISMATCH" and store.count() == 3


def test_missing_or_wrong_state_never_resets(store, vault, tmp_path):
    with pytest.raises(RuntimeError):
        Store.initialize(store.directory, vault)
    with pytest.raises(RuntimeError):
        Store(tmp_path / "missing", vault)
    store.put("identity", "wrong")
    with pytest.raises(RuntimeError):
        Store(store.directory, vault)


def test_capacity_backpressure_retains_queue(store):
    bound(store)
    with store.transaction():
        store.db.executemany(
            "INSERT INTO outbox(sequence,body,digest) VALUES(?,?,?)",
            [(i, b"unused", "unused") for i in range(1, 5000)],
        )
    with pytest.raises(RuntimeError, match="OUTBOX_CAPACITY"):
        capture(store)
    assert store.count() == 4999 and store.get("sequence") == 0


def test_wrong_ack_keeps_head(store):
    bound(store)
    capture(store)
    with pytest.raises(ValueError):
        store.acknowledge(2, {"sequence": 2, "bill_id": "b", "accepted_at": "x"})
    assert store.count() == 3
