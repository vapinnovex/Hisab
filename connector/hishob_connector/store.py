"""SQLite FULL transactions bind observations, sequences, checkpoints and acknowledgements."""

import hashlib
import json
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from .contract import MAX_SEQUENCE, encoded, local_api, validate_observation, validate_pair


class Store:
    def __init__(self, directory, vault):
        self.directory = Path(directory)
        self.vault = vault
        self.path = self.directory / "state.sqlite3"
        if not self.path.exists() or not (self.directory / "identity.dpapi").exists():
            raise RuntimeError("State missing: initialize once; never silently reset sequencing")
        self.db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA busy_timeout=5000")
        if self.db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("State corrupt; preserve files for recovery")
        anchor = self.vault.open((self.directory / "identity.dpapi").read_bytes()).decode()
        if self.get("identity") != anchor or self.get("store_version") != 1:
            raise RuntimeError("State identity/schema mismatch; recovery required")

    @classmethod
    def initialize(cls, directory, vault):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        if any(directory.iterdir()):
            raise RuntimeError("Initialization requires a new empty protected state directory")
        identity = secrets.token_hex(16)
        anchor = directory / "identity.dpapi"
        with anchor.open("xb") as f:
            f.write(vault.seal(identity.encode()))
            f.flush()
            import os

            os.fsync(f.fileno())
        db = sqlite3.connect(directory / "state.sqlite3")
        db.executescript("""
            PRAGMA journal_mode=DELETE;
            PRAGMA synchronous=FULL;
            CREATE TABLE kv(key TEXT PRIMARY KEY, value BLOB NOT NULL);
            CREATE TABLE outbox(sequence INTEGER PRIMARY KEY, body BLOB NOT NULL,
              digest TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
              retry_at REAL NOT NULL DEFAULT 0);
            CREATE TABLE receipts(sequence INTEGER PRIMARY KEY, accepted_at TEXT NOT NULL,
              bill_id TEXT NOT NULL, digest TEXT NOT NULL);
        """)
        for key, value in {
            "identity": identity,
            "store_version": 1,
            "sequence": 0,
            "scan_checkpoint": 0,
            "mode": "UNPAIRED",
            "scenario": "baseline",
        }.items():
            db.execute("INSERT INTO kv VALUES(?,?)", (key, vault.seal(encoded(value))))
        db.commit()
        db.close()
        return cls(directory, vault)

    def close(self):
        self.db.close()

    @contextmanager
    def transaction(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def get(self, key, default=None):
        row = self.db.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return default if row is None else json.loads(self.vault.open(row[0]))

    def put(self, key, value):
        self.db.execute("INSERT OR REPLACE INTO kv VALUES(?,?)", (key, self.vault.seal(encoded(value))))

    def queue_pair(self, api, code):
        api = local_api(api)
        if not isinstance(code, str) or not 32 <= len(code) <= 100:
            raise ValueError("Enter the five-minute pairing code")
        with self.transaction():
            old_api = self.get("api")
            if old_api and api != old_api:
                raise ValueError("Backend is bound to this state; explicit migration required")
            if self.get("pending_pair"):
                raise ValueError("Pairing already pending: retry the existing proof or cancel it first")
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

    def cancel_pair(self):
        with self.transaction():
            self.put("pending_pair", None)
            # Do not fall back to an old token; the server may have consumed the new proof.
            self.put("mode", "REPAIR_REQUIRED")

    def finish_pair(self, pending_id, response):
        response = validate_pair(response)
        with self.transaction():
            pending = self.get("pending_pair")
            if not pending or pending["id"] != pending_id:
                return False
            previous = self.get("binding")
            if previous and previous != response:
                self.put("mode", "BINDING_MISMATCH")
                self.put("error", "SCOPE_CHANGED_RECOVERY_REQUIRED")
                return False
            self.put("binding", response)
            self.put("credential", pending["body"]["credential"])
            self.put("pending_pair", None)
            self.put("mode", "RUNNING")
            self.put("error", None)
            return True

    def enqueue_scan(self, scan, observed_at):
        from .synthetic import SyntheticScan

        if not isinstance(scan, SyntheticScan):
            raise TypeError("Only the built-in synthetic generator can enqueue; local SQL results cannot")
        snapshots = scan.snapshots
        with self.transaction():
            if self.get("mode") != "RUNNING" or self.get("pending_pair"):
                return False
            if self.count() + len(snapshots) > 5000:
                raise RuntimeError("OUTBOX_CAPACITY")
            sequence = self.get("sequence")
            binding = self.get("binding")
            for snapshot in snapshots:
                sequence += 1
                if sequence > MAX_SEQUENCE:
                    raise RuntimeError("SEQUENCE_EXHAUSTED")
                if snapshot.get("synthetic") is not True:
                    raise ValueError("Source provenance must already be synthetic")
                body = {
                    **snapshot,
                    "version": 1,
                    "sequence": sequence,
                    "generation": binding["generation"],
                    "source_id": binding["source_id"],
                    "observed_at": observed_at,
                }
                validate_observation(body)
                payload = encoded(body)
                self.db.execute(
                    "INSERT INTO outbox(sequence,body,digest) VALUES(?,?,?)",
                    (sequence, self.vault.seal(payload), hashlib.sha256(payload).hexdigest()),
                )
            self.put("sequence", sequence)
            self.put("scan_checkpoint", self.get("scan_checkpoint", 0) + 1)
            self.put("last_source_observation", observed_at)
            self.put("last_scan", time.time())
            return True

    def head(self):
        row = self.db.execute("SELECT * FROM outbox ORDER BY sequence LIMIT 1").fetchone()
        if row is None:
            return None
        row = dict(row)
        row["body"] = self.vault.open(row["body"])
        if hashlib.sha256(row["body"]).hexdigest() != row["digest"]:
            raise RuntimeError("Outbox digest mismatch")
        return row

    def count(self):
        return self.db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]

    def acknowledge(self, sequence, response):
        from datetime import datetime

        if (
            not isinstance(response, dict)
            or type(response.get("sequence")) is not int
            or response["sequence"] != sequence
            or type(response.get("replayed")) is not bool
            or not isinstance(response.get("bill_id"), str)
            or not response["bill_id"]
            or not isinstance(response.get("accepted_at"), str)
        ):
            raise ValueError("Invalid acknowledgement")
        accepted = datetime.fromisoformat(response["accepted_at"].replace("Z", "+00:00"))
        if accepted.tzinfo is None:
            raise ValueError("Acknowledgement timestamp must include timezone")
        with self.transaction():
            head = self.head()
            if not head or head["sequence"] != sequence:
                raise ValueError("Acknowledgement is not for queue head")
            self.db.execute(
                "INSERT INTO receipts VALUES(?,?,?,?)",
                (sequence, response["accepted_at"], response["bill_id"], head["digest"]),
            )
            self.put("last_acknowledged_sequence", sequence)
            self.put("last_successful_sync", response["accepted_at"])
            self.put("last_delivered_source_observation", json.loads(head["body"])["observed_at"])
            self.db.execute("DELETE FROM outbox WHERE sequence=?", (sequence,))
            # Receipts are transport diagnostics, never financial/source audit.
            self.db.execute("DELETE FROM receipts WHERE sequence < ?", (sequence - 10000,))

    def status(self):
        from .security import service_state

        keys = (
            "mode",
            "error",
            "last_worker_tick",
            "last_source_observation",
            "last_successful_sync",
            "last_delivered_source_observation",
            "last_contact",
            "last_acknowledged_sequence",
            "sequence",
            "scan_checkpoint",
            "binding",
            "source_health",
            "scenario",
        )
        result = {k: self.get(k) for k in keys}
        result["pending_observations"] = self.count()
        result["scm_service_state"] = service_state()
        result["worker_alive"] = time.time() - (result["last_worker_tick"] or 0) < 45
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)

        def age(value):
            return (
                None
                if not value
                else (now - datetime.fromisoformat(value.replace("Z", "+00:00"))).total_seconds()
            )

        ages = [age(result[k]) for k in ("last_successful_sync", "last_delivered_source_observation")]
        result["acknowledged_sync_age_seconds"], result["delivered_observation_age_seconds"] = ages
        result["capture_age_seconds"] = age(result["last_source_observation"])
        result["stale"] = any(x is None or x > 120 or x < -300 for x in ages)
        result["historical_coverage"] = "UNVALIDATED; real SQL scheduling is disabled"
        return result
