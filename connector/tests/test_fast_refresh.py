"""Exercise the production transport and wire contract, not just mock command replies."""

import json
from datetime import date

import httpx
import pytest
from test_real import real_store

from hishob_connector import real
from hishob_connector.extractor import ExtractionReview, LocalRadioSoftSnapshot
from hishob_connector.transport import HttpTransport


def test_real_command_is_permitted_by_actual_http_transport(monkeypatch):
    seen = []
    real_client = httpx.Client

    def handle(request):
        seen.append(request.url.path)
        return httpx.Response(200, json={"scan_request_id": "request"})

    monkeypatch.setattr(
        httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs)
    )
    assert real.RealTransport("https://dev.example.test").post("command", b"{}", "proof") == {
        "scan_request_id": "request"
    }
    assert seen == ["/api/radiosoft/real-connector/command"]
    with pytest.raises(ValueError):
        HttpTransport("http://127.0.0.1:8000").post("command", b"{}")


class RecentReader:
    def __init__(self):
        self.amounts = {3: "30", 2: "20", 1: "10"}
        self.broken = False

    def keys_page(self, invoice_type, firm, start, end, after, limit, newest_first=False):
        assert newest_first and limit == 5
        return (
            [
                {"InvoiceNo": n, "FYear": "2026", "InvoiceType": invoice_type, "FirmCode": firm}
                for n in self.amounts
            ]
            if invoice_type == 0
            else []
        )

    def inspect_bill(self, number, year, invoice_type, firm):
        if self.broken:
            raise ExtractionReview("UNSTABLE_HEADER_OR_ITEMS_RETRY_LATER")
        return LocalRadioSoftSnapshot(
            (number, year, invoice_type, firm),
            {"InvoiceDate": "2026-11-09", "NetAmt": self.amounts[number]},
            (),
            "fixture",
        )


def freeze_today(monkeypatch):
    class Today(date):
        @classmethod
        def today(cls):
            return cls(2026, 11, 9)

    monkeypatch.setattr(real, "date", Today)


def test_recent_window_burst_edits_dedup_and_failed_read_keep_checkpoint(tmp_path, vault, monkeypatch):
    freeze_today(monkeypatch)
    store = real_store(tmp_path, vault)
    reader = RecentReader()
    poller = real.Poller(store, reader)
    assert poller.capture(force_latest=True) is False
    assert store.count() == 3  # all three arrivals, not just the newest
    assert poller.capture(force_latest=True) is True
    assert poller.capture(force_latest=True) is False
    assert store.count() == 3  # unchanged windows don't bloat the durable queue
    reader.amounts[2] = "25"  # an edit behind the newest invoice is noticed
    poller.capture(force_latest=True)
    poller.capture(force_latest=True)
    assert store.count() == 4
    checkpoint = store.get("real_checkpoint")
    sequence = store.get("sequence")
    reader.broken = True
    with pytest.raises(ExtractionReview):
        poller.capture(force_latest=True, restart_latest=True)
    assert store.get("real_checkpoint") == checkpoint and store.get("sequence") == sequence
    store.close()


def test_health_matches_backend_even_with_large_local_checkpoint(tmp_path, vault):
    from app.radiosoft_real_schemas import RealHealth

    store = real_store(tmp_path, vault)
    checkpoint = {f"old_cursor_{i}": i for i in range(30)}
    checkpoint.update(
        turn=2, fast_scope=1, complete_history_claim=False, fast_fingerprints={"0": {"secret-key": "hash"}}
    )
    store.put("real_checkpoint", checkpoint)

    class Transport:
        def post(self, path, body, credential=None):
            assert path == "health"
            data = json.loads(body)
            RealHealth.model_validate(data)
            assert len(data["coverage"]) <= 8
            assert "fast_fingerprints" not in data["coverage"]
            assert data["connector_version"] == "0.3.0"
            return {"received": True}

    real.RealEngine(store, Transport()).health(100)
    assert store.get("mode") == "RUNNING"
    store.close()


def test_sql_failure_is_redacted_and_request_not_acknowledged(tmp_path, vault, monkeypatch):
    store = real_store(tmp_path, vault)
    calls = []

    class Transport:
        def post(self, path, body, credential=None):
            if path == "command":
                return {"scan_request_id": "refresh-error"}
            calls.append(json.loads(body))
            return {"received": True}

    def broken(*_args):
        raise Exception("28000", "sensitive SQL driver details")

    monkeypatch.setattr(real, "open_local_readonly", broken)
    real.RealEngine(store, Transport()).tick(100)
    assert store.get("source_error") == "SQLSTATE_28000"
    assert store.get("completed_scan_request_id") is None
    assert calls[-1]["scan_request_failed"] == "refresh-error"
    assert "sensitive" not in json.dumps(calls)
    store.close()


def test_health_recovery_requires_server_confirmation_and_preserves_stream(tmp_path, vault):
    store = real_store(tmp_path, vault)
    store.put("sequence", 42)
    credential = store.get("credential")
    store.put("mode", "INCOMPATIBLE")
    store.put("error", "HEALTH_HTTP_422")

    class Transport:
        def post(self, path, body, proof=None):
            assert proof == credential and path == "health"
            return {"received": True}

    real.RealEngine(store, Transport()).resume_health_upgrade()
    assert store.get("mode") == "RUNNING"
    assert store.get("sequence") == 42 and store.get("credential") == credential
    store.put("mode", "INCOMPATIBLE")
    store.put("error", "INVALID_ACK_RETAINED")
    with pytest.raises(ValueError):
        real.RealEngine(store, Transport()).resume_health_upgrade()
    assert store.get("mode") == "INCOMPATIBLE"
    store.close()


def test_automatic_latest_reads_do_not_wait_for_minute_sweep(tmp_path, vault, monkeypatch):
    from test_extractor import FakeConnection

    store = real_store(tmp_path, vault)
    source = FakeConnection()
    source.close = lambda: None
    monkeypatch.setattr(real, "open_local_readonly", lambda *_: source)
    passes = []
    monkeypatch.setattr(
        real.Poller, "capture", lambda self, **kwargs: passes.append(kwargs["force_latest"]) or False
    )

    class Transport:
        def post(self, path, body, credential=None):
            return {"scan_request_id": None} if path == "command" else {"received": True}

    engine = real.RealEngine(store, Transport())
    for clock in (100, 101, 104, 106):
        engine.tick(clock)
    assert passes == [True, False, True]
    assert store.get("last_capture_queries") == 1
    store.close()
