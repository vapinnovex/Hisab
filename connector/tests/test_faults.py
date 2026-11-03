import json
import secrets
import time

import pytest
from test_store import bound, capture

from hishob_connector.diagnostics import redacted_status
from hishob_connector.engine import Engine
from hishob_connector.transport import DeliveryError


class Reply:
    def __init__(self, value):
        self.value = value

    def post(self, path, body, credential=None):
        if path == "health":
            return {"received": True}
        if isinstance(self.value, Exception):
            raise self.value
        return self.value


@pytest.mark.parametrize(
    "response",
    [
        [],
        {},
        {"sequence": True},
        {"sequence": 1, "bill_id": "fake", "accepted_at": "invalid", "replayed": False},
        {"sequence": 1, "bill_id": "fake", "accepted_at": "2026-11-02T10:00:00", "replayed": False},
    ],
)
def test_malformed_success_retains_exact_head(store, response):
    bound(store)
    capture(store)
    body = store.head()["body"]
    Engine(store, Reply(response)).tick()
    assert store.get("mode") == "OUTBOX_BLOCKED" and store.head()["body"] == body
    assert store.get("last_acknowledged_sequence") is None


@pytest.mark.parametrize(
    "status,expected",
    [
        (401, "REVOKED_OR_DISABLED"),
        (403, "REVOKED_OR_DISABLED"),
        (422, "OUTBOX_BLOCKED"),
        (429, "RUNNING"),
        (0, "RUNNING"),
    ],
)
def test_http_failure_retains_queue_and_scope(store, status, expected):
    bound(store)
    capture(store)
    before = store.head()["body"]
    Engine(store, Reply(DeliveryError(status))).tick()
    assert store.get("mode") == expected and store.head()["body"] == before and store.count() == 3


def test_gui_repair_race_cannot_be_overwritten_by_old_auth_failure(store):
    bound(store)
    capture(store)

    class RacingReply:
        def post(self, *_):
            store.queue_pair("http://127.0.0.1:8000", secrets.token_urlsafe(24))
            raise DeliveryError(401)

    Engine(store, RacingReply()).tick()
    assert store.get("mode") == "PAIRING" and store.count() == 3


def test_redacted_export_and_stopped_worker_are_explicit(store):
    bound(store)
    capture(store)
    store.put("last_worker_tick", time.time() - 200)
    data = redacted_status(store)
    text = json.dumps(data)
    assert store.get("credential") not in text and "fake-shop" not in text
    assert data["status"]["worker_alive"] is False and data["status"]["stale"] is True
    assert "pending_pair" not in text and "Synthetic item" not in text
