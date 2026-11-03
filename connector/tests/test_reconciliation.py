from datetime import date
from types import SimpleNamespace

import pytest

from hishob_connector.extractor import ExtractionReview
from hishob_connector.reconciliation import LocalReconciler


class FakeReader:
    firms = {0}
    start_date = date(2020, 1, 1)
    end_date = date(2027, 1, 1)

    def __init__(self):
        self.digest = "initial-item-and-staff-digest"
        self.error = None
        self.pages = []

    def inspect_bill(self, *key):
        if self.error:
            raise self.error
        return SimpleNamespace(digest=self.digest)

    def keys_page(self, kind, firm, start, end, after, limit):
        self.pages.append((start, end, after))
        return (
            []
            if after[0]
            else [{"InvoiceNo": 1, "FYear": "VERBATIM ", "InvoiceType": kind, "FirmCode": firm}]
        )


def test_resumable_page_and_old_target_changes(tmp_path, vault):
    reader = FakeReader()
    journal = LocalReconciler(tmp_path / "local", vault, reader, "synthetic-local-test", initialize=True)
    today = date(2026, 11, 2)
    assert journal.step(now=100, today=today) == "SCAN_PAGE"
    assert journal.state["pending"] and journal.state["after"] == [1, "VERBATIM "]
    reopened = LocalReconciler(tmp_path / "local", vault, reader, "synthetic-local-test")
    assert reopened.step(now=101, today=today) == "NEW_CURRENT"
    assert reopened.state["pending"] == []
    reader.digest = "salesperson-only-change"
    reopened.target((1, "VERBATIM ", 0, 0))
    assert reopened.step(now=102, today=today) == "CHANGED_CURRENT"
    for n in range(30):
        reopened.step(now=110 + n, today=today)
    assert reopened.state["completed_wider_sweeps"] > 0
    assert any(start == "2020-01-01" for start, _, _ in reader.pages)
    assert "NOT_COMPLETE_EVENT_HISTORY" in reopened.state["coverage"]


def test_failed_partial_scan_retains_work_and_missing_requires_independent_confirmation(tmp_path, vault):
    reader = FakeReader()
    journal = LocalReconciler(tmp_path / "local", vault, reader, "fake-source", initialize=True)
    key = (1, "VERBATIM ", 0, 0)
    journal.target(key)
    reader.error = TimeoutError("never export driver detail")
    with pytest.raises(TimeoutError):
        journal.step(now=100)
    assert journal.state["pending"] == [list(key)]
    assert journal.state["missing_candidates"] == {} and journal.state["coverage"] == "INCOMPLETE"
    assert journal.state["last_error"] == "QUERY_FAILED" and journal.step(now=101) == "BACKOFF"
    reader.error = ExtractionReview("KEY_ABSENT_OR_OUTSIDE_DATES_REVIEW_ONLY_NOT_CANCELLED")
    assert journal.step(now=110) == "ABSENCE_CANDIDATE"
    journal.target(key)
    assert journal.step(now=150) == "MISSING_OR_DATE_MOVED_REVIEW_ONLY"
    assert journal.state["known"] == {}
    with pytest.raises(RuntimeError):
        LocalReconciler(tmp_path / "local", vault, reader, "other-source")
