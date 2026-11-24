"""Local-only resumable content reconciliation primitive, NOT a live upload scheduler.

One bounded page/bill per step. Runs only when explicitly called by a local inspector.
State contains encrypted keys/digests/checkpoints, never bill amounts, items or names.
Synthetic service never imports this module. No cancellation is inferred from absence.
"""

import hashlib
import json
import os
import time
from datetime import date, timedelta
from pathlib import Path

from .extractor import ExtractionReview


class LocalReconciler:
    def __init__(self, directory, vault, reader, scope_id, initialize=False):
        self.directory = Path(directory)
        self.path = self.directory / "local-inspection.dpapi"
        self.vault, self.reader = vault, reader
        self.scope = {
            "source": scope_id,
            "firms": sorted(reader.firms),
            "from": str(reader.start_date),
            "until": str(reader.end_date),
        }
        if initialize:
            self.directory.mkdir(parents=True, exist_ok=True)
            if any(self.directory.iterdir()):
                raise RuntimeError("Local inspection needs a new separate protected directory")
            self.state = {
                "kind": "REAL_LOCAL_ONLY",
                "version": 1,
                "scope": self.scope,
                "lane": 0,
                "scope_index": 0,
                "after": [0, ""],
                "pending": [],
                "known": {},
                "review_cursor": "",
                "missing_candidates": {},
                "coverage": "INCOMPLETE",
                "retry_at": 0,
                "failures": 0,
                "last_error": None,
                "completed_wider_sweeps": 0,
                "window": None,
            }
            self.save()
        else:
            self.state = json.loads(vault.open(self.path.read_bytes()))
            if self.state.get("kind") != "REAL_LOCAL_ONLY" or self.state.get("scope") != self.scope:
                raise RuntimeError("Local source scope changed; review continuity before scanning")

    def save(self):
        temporary = self.directory / "local-inspection.tmp"
        payload = self.vault.seal(json.dumps(self.state, sort_keys=True).encode())
        with temporary.open("wb") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, self.path)

    def key_id(self, key):
        return hashlib.sha256(json.dumps([self.scope, key], sort_keys=True).encode()).hexdigest()

    def target(self, key):
        # Pending target is durable before any source query. Never drop a page checkpoint.
        key = list(key)
        if key[2] not in (0, 1) or key[3] not in self.reader.firms:
            raise ExtractionReview("UNAPPROVED_TARGET")
        if len(self.state["pending"]) >= 200:
            raise ExtractionReview("LOCAL_TARGET_CAPACITY")
        if key not in self.state["pending"]:
            self.state["pending"].append(key)
            self.save()

    def _observe(self, key, now):
        identity = self.key_id(key)
        try:
            snapshot = self.reader.inspect_bill(*key)
        except ExtractionReview as exc:
            if not str(exc).startswith("KEY_ABSENT_OR_OUTSIDE_DATES"):
                raise
            # A failed/partial query never enters this branch. Two successful absent
            # reads, in different steps >=30 seconds apart, yield review, NOT deletion.
            prior = self.state["missing_candidates"].get(identity)
            if prior is None:
                self.state["missing_candidates"][identity] = now
                return "ABSENCE_CANDIDATE"
            if now - prior >= 30:
                return "MISSING_OR_DATE_MOVED_REVIEW_ONLY"
            return "ABSENCE_CANDIDATE"
        previous = self.state["known"].get(identity)
        if previous is None and len(self.state["known"]) >= 100000:
            raise ExtractionReview("LOCAL_COVERAGE_CAPACITY_REVIEW")
        self.state["known"][identity] = {"key": key, "digest": snapshot.digest, "observed_at": now}
        self.state["missing_candidates"].pop(identity, None)
        return (
            "NEW_CURRENT"
            if previous is None
            else "CHANGED_CURRENT"
            if previous["digest"] != snapshot.digest
            else "UNCHANGED_CURRENT"
        )

    def step(self, now=None, today=None):
        now = time.time() if now is None else now
        today = date.today() if today is None else today
        if now < self.state["retry_at"]:
            return "BACKOFF"
        result = "SCAN_PAGE"
        try:
            if self.state["pending"]:
                key = self.state["pending"][0]
                result = self._observe(key, now)
                self.state["pending"].pop(0)
            elif self.state["lane"] == 2:
                # Rotate through known keys, including old bills absent from recent pages.
                keys = sorted(k for k in self.state["known"] if k > self.state["review_cursor"])
                if keys:
                    identity = keys[0]
                    result = self._observe(self.state["known"][identity]["key"], now)
                    self.state["review_cursor"] = identity
                else:
                    self.state["review_cursor"] = ""
                self.state["lane"] = 0
            else:
                scopes = [(firm, kind) for firm in sorted(self.reader.firms) for kind in (0, 1)]
                if not scopes:
                    raise ExtractionReview("EMPTY_APPROVED_SCOPE")
                firm, kind = scopes[self.state["scope_index"]]
                start, end = self.reader.start_date, self.reader.end_date
                if self.state["lane"] == 0:
                    start = max(start, today - timedelta(days=2))
                    end = min(end, today + timedelta(days=1))
                if self.state["window"] is None:
                    self.state["window"] = [str(start), str(end)]
                start, end = self.state["window"]
                page = (
                    []
                    if start >= end
                    else self.reader.keys_page(
                        kind, firm, start, end, after=tuple(self.state["after"]), limit=25
                    )
                )
                if page:
                    self.state["pending"] = [
                        [r[k] for k in ("InvoiceNo", "FYear", "InvoiceType", "FirmCode")] for r in page
                    ]
                    last = page[-1]
                    self.state["after"] = [last["InvoiceNo"], last["FYear"]]
                else:
                    self.state["after"] = [0, ""]
                    self.state["scope_index"] += 1
                    if self.state["scope_index"] == len(scopes):
                        self.state["scope_index"] = 0
                        if self.state["lane"] == 1:
                            self.state["completed_wider_sweeps"] += 1
                        self.state["lane"] += 1
                        self.state["window"] = None
            self.state.update(
                retry_at=0,
                failures=0,
                last_error=None,
                coverage="BEST_EFFORT_CURRENT_STATE_NOT_COMPLETE_EVENT_HISTORY",
            )
        except Exception as exc:
            self.state["failures"] += 1
            self.state["retry_at"] = now + min(300, 2 ** min(self.state["failures"], 8))
            self.state["coverage"] = "INCOMPLETE"
            self.state["last_error"] = str(exc) if isinstance(exc, ExtractionReview) else "QUERY_FAILED"
            self.save()
            raise
        self.save()
        return result
