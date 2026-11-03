"""One sender, durable exact envelopes, no resynthesis on delivery failure."""

import random
import time
from datetime import datetime, timezone

from .contract import encoded
from .synthetic import scan
from .transport import DeliveryError, HttpTransport


def delay(attempt):
    return min(300, (2 ** min(attempt, 8)) * random.uniform(0.8, 1.2))


class Engine:
    def __init__(self, store, transport=None):
        self.store = store
        self.transport = transport

    def post(self, path, body, credential=None):
        transport = self.transport or HttpTransport(self.store.get("api"))
        return transport.post(path, body, credential)

    def blocked(self, mode, error, expected_mode="RUNNING"):
        with self.store.transaction():
            # An owner may have queued re-pairing while a request was in flight.
            if self.store.get("mode") == expected_mode:
                self.store.put("mode", mode)
                self.store.put("error", error)

    def pair(self, pending, now):
        if pending["retry_at"] > now:
            return
        try:
            response = self.post("pair", encoded(pending["body"]))
            self.store.finish_pair(pending["id"], response)
        except DeliveryError as exc:
            with self.store.transaction():
                current = self.store.get("pending_pair")
                if not current or current["id"] != pending["id"]:
                    return
                if exc.status == 0 or exc.status in {408, 429} or exc.status >= 500:
                    pending["attempts"] += 1
                    pending["retry_at"] = now + delay(pending["attempts"])
                    self.store.put("pending_pair", pending)
                    self.store.put(
                        "error",
                        f"PAIRING_BACKEND_UNAVAILABLE_HTTP_{exc.status}"
                        + (":" + exc.category if exc.category else ""),
                    )
                else:
                    # Expiry after an uncertain response requires a newly issued owner code.
                    self.store.put("mode", "REPAIR_REQUIRED")
                    self.store.put("error", f"PAIRING_HTTP_{exc.status}")
        except (ValueError, TypeError, KeyError):
            self.blocked("INCOMPATIBLE", "INVALID_PAIR_RESPONSE", "PAIRING")

    def tick(self, now=None):
        now = time.time() if now is None else now
        self.store.put("last_worker_tick", now)
        if self.store.get("mode") == "PAIRING":
            pending = self.store.get("pending_pair")
            if pending:
                self.pair(pending, now)
            return
        if self.store.get("mode") == "OUTBOX_BLOCKED":
            self.health(now, "OUTBOX_BLOCKED")
            return
        if self.store.get("mode") != "RUNNING":
            return
        # A durable checkpoint advances only when all generated observations are committed.
        if now - self.store.get("last_scan", 0) >= 30:
            try:
                generated = scan(
                    self.store.get("identity"),
                    self.store.get("binding"),
                    self.store.get("scenario", "baseline"),
                )
                self.store.enqueue_scan(generated, datetime.fromtimestamp(now, timezone.utc).isoformat())
                self.store.put("source_health", "OK")
            except OSError:
                self.store.put("source_health", "SOURCE_UNAVAILABLE")
                self.store.put("last_scan", now)
            except RuntimeError as exc:
                if str(exc) != "OUTBOX_CAPACITY":
                    raise
                self.store.put("source_health", "OUTBOX_BLOCKED")
                self.store.put("last_scan", now)
        head = self.store.head()
        if head and head["retry_at"] <= now:
            try:
                response = self.post("observations", head["body"], self.store.get("credential"))
                self.store.acknowledge(head["sequence"], response)
                self.store.put("error", None)
            except DeliveryError as exc:
                if exc.status in {401, 403}:
                    self.blocked("REVOKED_OR_DISABLED", f"AUTH_HTTP_{exc.status}")
                    return
                attempts = head["attempts"] + 1
                # 409 may be a concurrent bill CAS. Retry exact bytes briefly; stale or
                # superseded data cannot be repaired by minting a newer sequence.
                transient = exc.status == 0 or exc.status in {408, 429} or exc.status >= 500
                if transient or (exc.status == 409 and attempts <= 3):
                    self.store.db.execute(
                        "UPDATE outbox SET attempts=?,retry_at=? WHERE sequence=?",
                        (attempts, now + delay(attempts), head["sequence"]),
                    )
                    self.store.put(
                        "error",
                        (
                            f"BACKEND_UNAVAILABLE_HTTP_{exc.status}"
                            + (":" + exc.category if exc.category else "")
                        )
                        if transient
                        else "CONFLICT_RETRY",
                    )
                else:
                    self.blocked("OUTBOX_BLOCKED", f"OBSERVATION_HTTP_{exc.status}_REVIEW_REQUIRED")
                    return
            except (ValueError, TypeError, KeyError):
                self.blocked("OUTBOX_BLOCKED", "INVALID_ACK_RETAINED")
                return
        if self.store.get("mode") != "RUNNING":
            return
        self.health(now)

    def health(self, now, status=None):
        # Health never updates last_successful_sync or original source-observed time.
        if now - self.store.get("last_health_attempt", 0) >= 30:
            self.store.put("last_health_attempt", now)
            expected_mode = self.store.get("mode")
            try:
                result = self.post(
                    "health",
                    encoded(
                        {
                            "status": status or self.store.get("source_health", "SCAN_INCOMPLETE"),
                            "pending_observations": self.store.count(),
                        }
                    ),
                    self.store.get("credential"),
                )
                if result != {"received": True}:
                    self.blocked("INCOMPATIBLE", "INVALID_HEALTH_ACK", expected_mode)
                    return
                self.store.put("last_contact", datetime.fromtimestamp(now, timezone.utc).isoformat())
            except DeliveryError as exc:
                if exc.status in {401, 403}:
                    self.blocked("REVOKED_OR_DISABLED", f"AUTH_HTTP_{exc.status}", expected_mode)
                elif 400 <= exc.status < 500 and exc.status not in {408, 429}:
                    self.blocked("INCOMPATIBLE", f"HEALTH_HTTP_{exc.status}", expected_mode)
                else:
                    self.store.put("error", "BACKEND_UNAVAILABLE")

    def run(self, stop):
        while not stop.is_set():
            self.tick()
            stop.wait(1)
