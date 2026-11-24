"""Explicit real DEV adapter. Local snapshots retain their original provenance."""

import hashlib
import json
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from importlib.resources import files
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator, FormatChecker

from . import __version__
from .contract import MAX_SEQUENCE, encoded
from .engine import Engine
from .extractor import (
    HEAD_COLUMNS,
    LINE_COLUMNS,
    ExtractionReview,
    LocalRadioSoftSnapshot,
    Reader,
    open_local_readonly,
)
from .store import Store
from .transport import DeliveryError, HttpTransport

VALIDATOR = Draft202012Validator(
    json.loads(files("hishob_connector").joinpath("real-observation.schema.json").read_text()),
    format_checker=FormatChecker(),
)


def https_origin(value):
    p = urlsplit(value)
    if (
        p.scheme != "https"
        or not p.hostname
        or p.username
        or p.password
        or p.path not in ("", "/")
        or p.query
        or p.fragment
        or p.port not in (None, 443)
    ):
        raise ValueError("An exact HTTPS origin with certificate verification is required")
    return value.rstrip("/")


def validate_binding(body):
    required = {
        "version",
        "shop_id",
        "owner_id",
        "source_id",
        "generation",
        "database",
        "firm_codes",
        "invoice_types",
        "tracking_from",
        "capture_from",
        "capture_until",
        "mapping_version",
        "synthetic_only",
        "next_action",
    }
    if (
        set(body) != required
        or body["version"] != 2
        or body["synthetic_only"] is not False
        or body["mapping_version"] != "real-display-v1"
        or body["next_action"] != "SEND_REAL_REVIEW_OBSERVATIONS"
        or body["database"] != "RsDB"
    ):
        raise ValueError("Incompatible real binding")
    for k in ("shop_id", "owner_id", "source_id", "generation"):
        if not isinstance(body[k], str) or not 1 <= len(body[k]) <= 100:
            raise ValueError("Invalid binding")
    if (
        not body["firm_codes"]
        or any(type(x) is not int or x < 0 for x in body["firm_codes"])
        or not body["invoice_types"]
        or any(type(x) is not int or x not in (0, 1) for x in body["invoice_types"])
    ):
        raise ValueError("Invalid source scope")
    if (
        not date.fromisoformat(body["capture_from"])
        <= date.fromisoformat(body["tracking_from"])
        < date.fromisoformat(body["capture_until"])
    ):
        raise ValueError("Invalid date scope")
    return body


def map_bill(snapshot):
    if not isinstance(snapshot, LocalRadioSoftSnapshot) or snapshot.source_kind != "REAL_LOCAL_ONLY":
        raise TypeError("Expected real local reader snapshot")
    h = snapshot.header
    value = Decimal(str(h["NetAmt"])) if h["NetAmt"] is not None else None
    if value is not None and not value.is_finite():
        raise ExtractionReview("NONFINITE_NET_AMT")
    raw = {k: h.get(k) for k in HEAD_COLUMNS}
    net = format(value, "f") if value is not None else None
    return {
        "kind": "BILL",
        "bill": {
            "key": dict(
                zip(
                    ("invoice_no", "fyear", "invoice_type", "firm_code"),
                    (str(snapshot.key[0]), snapshot.key[1], snapshot.key[2], snapshot.key[3]),
                )
            ),
            "business_date": str(h["InvoiceDate"])[:10],
            "source_time_raw": "" if h.get("Time") is None else str(h["Time"]),
            "net_amt": net,
            "raw_header": raw,
            "lines": [
                {
                    "raw": {k: r.get(k) for k in LINE_COLUMNS},
                    "salesperson_ref": None if r["SLNo"] is None else str(r["SLNo"]),
                    "salesperson_name": r["salesperson_name"],
                    "attribution_status": r["attribution_status"],
                }
                for r in snapshot.lines
            ],
        },
        "people": [],
    }


class RealTransport(HttpTransport):
    prefix = "/api/radiosoft/real-connector/"
    allowed_paths = HttpTransport.allowed_paths | {"command"}

    def __init__(self, api):
        self.api = https_origin(api)


class RealStore(Store):
    """Same encrypted FULL SQLite outbox; explicitly separate state/mode."""

    def queue_pair(self, api, code):
        api = https_origin(api)
        if self.get("pilot_kind") != "REAL_DEV":
            raise ValueError("Real pairing requires initialized real DEV state")
        from .pairing_ui import normalize_code

        code = normalize_code(code)
        import secrets

        with self.transaction():
            if self.get("api") not in (None, api) or self.get("pending_pair"):
                raise ValueError("Origin bound or pairing pending")
            self.put("api", api)
            self.put(
                "pending_pair",
                {
                    "id": secrets.token_hex(16),
                    "body": {"code": code, "credential": secrets.token_urlsafe(32)},
                    "retry_at": 0,
                    "attempts": 0,
                },
            )
            self.put("mode", "PAIRING")
            self.put("error", None)

    def finish_pair(self, pending_id, response):
        response = validate_binding(response)
        expected = self.get("expected_binding")
        if response != expected:
            raise ValueError("Owner confirmed binding differs from local qualification")
        with self.transaction():
            pending = self.get("pending_pair")
            if not pending or pending["id"] != pending_id:
                return False
            if self.get("binding") not in (None, response):
                raise ValueError("State binding changed; reviewed recovery required")
            self.put("binding", response)
            self.put("credential", pending["body"]["credential"])
            self.put("pending_pair", None)
            self.put("mode", "RUNNING")
            self.put("error", None)
            return True

    def enqueue_real(self, records, observed_at, checkpoint):
        with self.transaction():
            if self.get("mode") != "RUNNING":
                return False
            if self.count() + len(records) > 5000:
                raise RuntimeError("OUTBOX_CAPACITY")
            seq = self.get("sequence")
            b = self.get("binding")
            for record in records:
                seq += 1
                body = {
                    **record,
                    "version": 2,
                    "synthetic": False,
                    "mapping_version": "real-display-v1",
                    "source_id": b["source_id"],
                    "generation": b["generation"],
                    "sequence": seq,
                    "observed_at": observed_at,
                }
                if seq > MAX_SEQUENCE:
                    raise RuntimeError("SEQUENCE_EXHAUSTED")
                VALIDATOR.validate(body)
                payload = encoded(body)
                self.db.execute(
                    "INSERT INTO outbox(sequence,body,digest) VALUES(?,?,?)",
                    (seq, self.vault.seal(payload), hashlib.sha256(payload).hexdigest()),
                )
            self.put("sequence", seq)
            self.put("real_checkpoint", checkpoint)
            self.put("last_source_observation", observed_at)
            self.put("scan_checkpoint", self.get("scan_checkpoint", 0) + 1)
            return True

    def acknowledge(self, sequence, response):
        head = self.head()
        if not head:
            raise ValueError("No pending envelope")
        body = json.loads(head["body"])
        b = self.get("binding")
        key = body["bill"]["key"] if body["kind"] == "BILL" else {"directory": True}
        expected = hashlib.sha256(encoded([b["shop_id"], b["source_id"], b["generation"], key])).hexdigest()
        if response.get("bill_id") != expected:
            raise ValueError("Acknowledgement source key mismatch")
        super().acknowledge(sequence, response)

    def status(self):
        result = super().status()
        from .security import service_state

        result["scm_service_state"] = service_state("HishobRadioSoftDev")
        result["source_error"] = self.get("source_error")
        result["connector_version"] = __version__
        result["last_capture_seconds"] = self.get("last_capture_seconds")
        result["last_capture_queries"] = self.get("last_capture_queries")
        result["last_fast_source_read"] = self.get("last_fast_source_read")
        result["historical_coverage"] = self.get("real_checkpoint", {})
        result["coverage_limit"] = (
            "Bounded cyclic rereads; absence is not deletion; stability is not final save"
        )
        return result


class Poller:
    """One directory page or <=5 bill keys per minute, prioritizing today's bills.

    The current local business date is revisited separately from bounded history.
    Checkpoint and observations commit together. Failures do not advance the page,
    infer disappearance, or discard queued deliveries.
    """

    def __init__(self, store, reader):
        self.store, self.reader = store, reader

    def capture(self, force_latest=False, restart_latest=False, request_id=None):
        b = self.store.get("binding")
        cp = self.store.get(
            "real_checkpoint",
            {
                "turn": 0,
                "directory_after": -2147483649,
                "day": b["capture_from"],
                "scope": 0,
                "after": [0, ""],
                "recent_day": None,
                "recent_scope": 0,
                "recent_after": [2147483647, "ZZZZZZZZ"],
                "recent_order": "DESC",
            },
        )
        if force_latest:
            today = date.today()
            capture_from = date.fromisoformat(b["capture_from"])
            capture_until = date.fromisoformat(b["capture_until"])
            if not capture_from <= today < capture_until:
                raise ExtractionReview("TODAY_OUTSIDE_CAPTURE_WINDOW")
            scopes = [(t, f) for f in b["firm_codes"] for t in b["invoice_types"]]
            # One scope / five newest bills per pass, rotated independently of history.
            # Keep the complete small window, not just its head: bursts of sales and
            # edits to the previous bill must not wait for the historical cursor.
            restart_latest = restart_latest or (request_id and cp.get("fast_request_id") != request_id)
            scope_index = 0 if restart_latest else cp.get("fast_scope", 0) % len(scopes)
            if request_id:
                cp["fast_request_id"] = request_id
            invoice_type, firm = scopes[scope_index]
            keys = self.reader.keys_page(
                invoice_type,
                firm,
                str(today),
                str(today + timedelta(days=1)),
                (2147483647, "ZZZZZZZZ"),
                5,
                newest_first=True,
            )
            fingerprints = cp.setdefault("fast_fingerprints", {})
            previous = fingerprints.get(str(scope_index), {})
            window, records = {}, []
            for key in keys:
                record = map_bill(
                    self.reader.inspect_bill(
                        key["InvoiceNo"],
                        key["FYear"],
                        key["InvoiceType"],
                        key["FirmCode"],
                    )
                )
                identity = hashlib.sha256(encoded(record["bill"]["key"])).hexdigest()
                fingerprint = hashlib.sha256(encoded(record)).hexdigest()
                window[identity] = fingerprint
                if previous.get(identity) != fingerprint:
                    records.append(record)
            fingerprints[str(scope_index)] = window
            cp["fast_scope"] = (scope_index + 1) % len(scopes)
            cp["fast_day"] = str(today)
            cp["complete_history_claim"] = False
            if not self.store.enqueue_real(records, datetime.now(timezone.utc).isoformat(), cp):
                raise ExtractionReview("SOURCE_CAPTURE_NOT_COMMITTED")
            return cp["fast_scope"] == 0

        records = []
        turn = cp["turn"]
        if turn == 0 or turn % 10 == 0:
            rows = self.reader.salespeople_page(cp["directory_after"], 50)
            records = [
                {
                    "kind": "DIRECTORY",
                    "bill": None,
                    "people": [{"ref": str(r["SLNo"]), "name": r["SLName"] or ""} for r in rows],
                }
            ]
            cp["directory_after"] = rows[-1]["SLNo"] if len(rows) == 50 else -2147483649
        else:
            recent = turn % 5 != 4
            prefix = "recent_" if recent else ""
            lower = (
                max(
                    date.fromisoformat(b["capture_from"]),
                    date.today(),
                )
                if recent
                else date.fromisoformat(b["capture_from"])
            )
            upper = date.fromisoformat(b["capture_until"])
            lower = min(lower, upper - timedelta(days=1))
            day = date.fromisoformat(cp[prefix + "day"]) if cp[prefix + "day"] else lower
            if recent and (day != lower or cp.get("recent_order") != "DESC"):
                cp["recent_order"] = "DESC"
                cp["recent_after"] = [2147483647, "ZZZZZZZZ"]
                cp["recent_scope"] = 0
                day = lower
            elif day < lower or day >= upper:
                day = lower
                cp[prefix + "after"] = [2147483647, "ZZZZZZZZ"] if recent else [0, ""]
            scopes = [(t, f) for f in b["firm_codes"] for t in b["invoice_types"]]
            if recent:
                head_scope = cp.get("recent_head_scope", 0) % len(scopes)
                head_type, head_firm = scopes[head_scope]
                latest_keys = self.reader.keys_page(
                    head_type,
                    head_firm,
                    str(lower),
                    str(min(lower + timedelta(days=1), upper)),
                    (2147483647, "ZZZZZZZZ"),
                    1,
                    newest_first=True,
                )
                cp["recent_head_scope"] = (head_scope + 1) % len(scopes)
                if latest_keys:
                    latest_key = latest_keys[0]
                    latest_record = map_bill(
                        self.reader.inspect_bill(
                            latest_key["InvoiceNo"],
                            latest_key["FYear"],
                            latest_key["InvoiceType"],
                            latest_key["FirmCode"],
                        )
                    )
                    fingerprints = cp.setdefault("recent_head_fingerprints", {})
                    fingerprint = hashlib.sha256(encoded(latest_record)).hexdigest()
                    if fingerprints.get(str(head_scope)) != fingerprint:
                        records.append(latest_record)
                        fingerprints[str(head_scope)] = fingerprint
                    latest_identity = tuple(
                        latest_key[k] for k in ("InvoiceNo", "FYear", "InvoiceType", "FirmCode")
                    )
                else:
                    latest_identity = None
            else:
                latest_identity = None
            t, f = scopes[cp[prefix + "scope"]]
            end = min(day + timedelta(days=1), upper)
            keys = self.reader.keys_page(
                t,
                f,
                str(day),
                str(end),
                tuple(cp[prefix + "after"]),
                5,
                newest_first=recent,
            )
            for k in keys:
                if recent and latest_identity == tuple(
                    k[key] for key in ("InvoiceNo", "FYear", "InvoiceType", "FirmCode")
                ):
                    continue
                records.append(
                    map_bill(
                        self.reader.inspect_bill(k["InvoiceNo"], k["FYear"], k["InvoiceType"], k["FirmCode"])
                    )
                )
            if len(keys) == 5:
                cp[prefix + "after"] = [keys[-1]["InvoiceNo"], keys[-1]["FYear"]]
            else:
                cp[prefix + "after"] = [2147483647, "ZZZZZZZZ"] if recent else [0, ""]
                cp[prefix + "scope"] = (cp[prefix + "scope"] + 1) % len(scopes)
                if cp[prefix + "scope"] == 0:
                    if not recent:
                        day = end if end < upper else lower
            cp[prefix + "day"] = str(day)
        cp["turn"] += 1
        cp["complete_history_claim"] = False
        self.store.enqueue_real(records, datetime.now(timezone.utc).isoformat(), cp)


class RealEngine(Engine):
    def post(self, path, body, credential=None):
        return (self.transport or RealTransport(self.store.get("api"))).post(path, body, credential)

    def resume_health_upgrade(self):
        """Explicit recovery for the old 422 health contract defect, never for bad data/acks."""
        store = self.store
        credential = store.get("credential")
        if (
            store.get("mode") != "INCOMPATIBLE"
            or store.get("error") != "HEALTH_HTTP_422"
            or not credential
            or store.get("pending_pair")
            or store.get("binding") != store.get("expected_binding")
        ):
            raise ValueError("Only an unchanged binding blocked by HEALTH_HTTP_422 can resume here")
        result = self.post(
            "health",
            encoded(
                {
                    "status": "SCAN_INCOMPLETE",
                    "pending_observations": store.count(),
                    "connector_version": __version__,
                }
            ),
            credential,
        )
        if result != {"received": True}:
            raise ValueError("Server did not confirm the upgraded health contract")
        with store.transaction():
            if store.get("mode") != "INCOMPATIBLE" or store.get("credential") != credential:
                raise ValueError("State changed; preserve it and review recovery")
            store.put("mode", "RUNNING")
            store.put("error", None)
            store.put("last_fast_attempt", 0)
            store.put("last_real_attempt", 0)

    def tick(self, now=None):
        clock = time.time() if now is None else now
        if self.store.get("mode") == "RUNNING" and clock - self.store.get("last_command_poll", 0) >= 5:
            self.store.put("last_command_poll", clock)
            try:
                command = self.post("command", encoded({}), self.store.get("credential"))
                if isinstance(command, dict):
                    request_id = command.get("scan_request_id")
                    if request_id:
                        self.store.put("requested_scan_id", request_id)
            except DeliveryError as exc:
                if exc.status in {401, 403}:
                    self.blocked("REVOKED_OR_DISABLED", f"COMMAND_HTTP_{exc.status}")
                    return
                # An older backend may not implement command. Regular scans still work.
        requested_scan = self.store.get("requested_scan_id")
        pending_request = bool(requested_scan and requested_scan != self.store.get("handled_scan_request_id"))
        first_attempt = pending_request and requested_scan != self.store.get("attempted_scan_request_id")
        fast_due = clock - self.store.get("last_fast_attempt", 0) >= 5
        background_due = clock - self.store.get("last_real_attempt", 0) >= 60
        fast_scan = first_attempt or fast_due
        if clock < self.store.get("source_retry_at", 0):
            fast_scan = background_due = False
        if self.store.get("mode") == "RUNNING" and (fast_scan or background_due):
            started = time.monotonic()
            if pending_request:
                self.store.put("attempted_scan_request_id", requested_scan)
            connection = None
            reader = None
            try:
                if self.store.count() > 4500:
                    raise RuntimeError("OUTBOX_CAPACITY")
                b = self.store.get("binding")
                connection = open_local_readonly(r".\SQLEXPRESS", "RsDB")
                reader = Reader(
                    connection,
                    b["firm_codes"],
                    b["capture_from"],
                    b["capture_until"],
                    0.05,
                    max_queries=100,
                    max_read_seconds=10 if fast_scan else 20,
                )
                reader.verify_schema()
                complete = Poller(self.store, reader).capture(
                    force_latest=fast_scan,
                    restart_latest=bool(first_attempt),
                    request_id=requested_scan if pending_request else None,
                )
                if fast_scan:
                    self.store.put("last_fast_source_read", self.store.get("last_source_observation"))
                if pending_request and fast_scan:
                    self.store.put("attempted_scan_request_id", requested_scan)
                    if complete:
                        self.store.put("handled_scan_request_id", requested_scan)
                        self.store.put("scan_request_sequence", self.store.get("sequence"))
                        self.store.put("failed_scan_request_id", None)
                        self.store.put("last_health_attempt", 0)
                self.store.put("source_health", "OK")
                self.store.put("source_failures", 0)
                self.store.put("source_retry_at", 0)
                self.store.put("source_error", None)
            except ExtractionReview as exc:
                self.store.put("source_health", "SCAN_INCOMPLETE")
                self.store.put("source_error", str(exc)[:100])
                if pending_request:
                    self.store.put("failed_scan_request_id", requested_scan)
                self.store.put("last_health_attempt", 0)
            except Exception as exc:
                capacity = isinstance(exc, RuntimeError) and str(exc) == "OUTBOX_CAPACITY"
                self.store.put("source_health", "OUTBOX_BLOCKED" if capacity else "SOURCE_UNAVAILABLE")
                # SQLSTATE only; never include driver text, queries, names or credentials.
                import re

                sqlstate = str(exc.args[0]) if exc.args else ""
                error = (
                    "SQLSTATE_" + sqlstate if re.fullmatch(r"[A-Z0-9]{5}", sqlstate) else "SOURCE_READ_FAILED"
                )
                self.store.put("source_error", "OUTBOX_CAPACITY" if capacity else error)
                failures = self.store.get("source_failures", 0) + 1
                self.store.put("source_failures", failures)
                self.store.put("source_retry_at", clock + min(60, 5 * 2 ** min(failures, 4)))
                if pending_request:
                    self.store.put("failed_scan_request_id", requested_scan)
                self.store.put("last_health_attempt", 0)
            finally:
                self.store.put("last_capture_seconds", round(time.monotonic() - started, 3))
                self.store.put("last_capture_queries", reader.query_count if reader else 0)
                # Wait after completion too: a slow/failing database must not be hammered.
                self.store.put(
                    "last_fast_attempt" if fast_scan else "last_real_attempt",
                    clock + time.monotonic() - started,
                )
                if connection is not None:
                    connection.close()
        # Prevent the base engine's artificial generator; delivery/retry is shared.
        self.store.put("last_scan", clock)
        super().tick(clock)
        # Drain a bounded burst in order, without a mandatory one-second gap per bill.
        # Never skip a failed head or mint replacement envelopes.
        deadline = time.monotonic() + 2
        for _ in range(9):
            head = self.store.head()
            if (
                self.store.get("mode") != "RUNNING"
                or not head
                or head["retry_at"] > clock
                or time.monotonic() >= deadline
            ):
                break
            previous = self.store.get("last_acknowledged_sequence", 0)
            super().tick(clock)
            if self.store.get("last_acknowledged_sequence", 0) == previous:
                break
        sequence = self.store.get("scan_request_sequence")
        handled = self.store.get("handled_scan_request_id")
        if (
            handled
            and sequence is not None
            and self.store.get("last_acknowledged_sequence", 0) >= sequence
            and self.store.get("completed_scan_request_id") != handled
        ):
            self.store.put("completed_scan_request_id", handled)
            self.store.put("last_health_attempt", 0)
            self.health(clock)

    def health(self, now, status=None):
        # Base health includes only delivery health. Enrich without changing source freshness.
        original = self.transport
        engine = self

        class HealthAdapter:
            def post(self, path, body, credential=None):
                if path == "health":
                    data = json.loads(body)
                    data.update(
                        last_successful_source_read=engine.store.get("last_source_observation"),
                        coverage={
                            k: v
                            for k, v in engine.store.get("real_checkpoint", {}).items()
                            if k
                            in {
                                "turn",
                                "directory_after",
                                "day",
                                "scope",
                                "recent_day",
                                "fast_day",
                                "fast_scope",
                                "complete_history_claim",
                            }
                        },
                        scan_request_ack=engine.store.get("completed_scan_request_id"),
                        scan_request_sequence=engine.store.get("scan_request_sequence"),
                        scan_request_failed=engine.store.get("failed_scan_request_id"),
                        source_error=engine.store.get("source_error"),
                        connector_version=__version__,
                        last_fast_source_read=engine.store.get("last_fast_source_read"),
                    )
                    body = encoded(data)
                return (original or RealTransport(engine.store.get("api"))).post(path, body, credential)

        self.transport = HealthAdapter()
        try:
            super().health(now, status)
        finally:
            self.transport = original
