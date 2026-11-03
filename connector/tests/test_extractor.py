"""Supplied schema metadata plus artificial rows; no SQL connection is opened."""

import copy
import json
from pathlib import Path

import pytest

from hishob_connector.extractor import (
    HEAD_COLUMNS,
    HEADER_SQL,
    KEYS_SQL,
    LINE_COLUMNS,
    LINES_SQL,
    SALESPERSON_PAGE_SQL,
    SALESPERSON_SQL,
    SCHEMA_SQL,
    ExtractionReview,
    Reader,
)


class FakeConnection:
    def __init__(self):
        evidence = json.loads(
            (
                Path(__file__).resolve().parents[2]
                / "docs/radiosoft-source-evidence-2026-10-29/radiosoft-schema-evidence.json"
            ).read_text()
        )
        self.schema = [
            {"TABLE_NAME": c["table_name"], "COLUMN_NAME": c["column_name"], "DATA_TYPE": c["data_type"]}
            for c in evidence["columns"]
        ]
        self.header = {c: 0 for c in HEAD_COLUMNS}
        self.header.update(
            InvoiceNo=1, FYear="2026 - 2027 ", InvoiceType=0, FirmCode=0, NetAmt=1000.0, UserID=88
        )
        line = {c: 0 for c in LINE_COLUMNS}
        self.lines = [
            {**line, "SLNo": 7, "Amount": 250.0},
            {**line, "SLNo": 7, "Amount": 250.0},
            {**line, "SLNo": 8, "Amount": 500.0},
        ]
        self.people = {7: "Synthetic seven", 8: "Synthetic eight"}
        self.fail = None
        self.calls = []
        self.mutate = None
        self.closed_cursors = 0

    def cursor(self):
        parent = self

        class Cursor:
            def execute(self, sql, params):
                parent.calls.append((sql, params))
                if parent.fail == sql:
                    raise TimeoutError("Simulated incomplete query")
                if sql == SCHEMA_SQL:
                    rows = parent.schema
                elif sql == HEADER_SQL:
                    if parent.mutate:
                        parent.mutate(parent)
                    rows = [] if parent.header is None else [parent.header]
                elif sql == LINES_SQL:
                    rows = parent.lines
                elif sql == SALESPERSON_SQL:
                    rows = (
                        [{"SLNo": params[0], "SLName": parent.people[params[0]]}]
                        if params[0] in parent.people
                        else []
                    )
                elif sql == SALESPERSON_PAGE_SQL:
                    rows = [
                        {"SLNo": k, "SLName": v} for k, v in sorted(parent.people.items()) if k > params[1]
                    ][: params[0]]
                elif sql == KEYS_SQL:
                    rows = []
                else:
                    raise AssertionError(sql)
                self.names = list(rows[0]) if rows else []
                self.description = [(name,) for name in self.names]
                self.rows = [tuple(copy.deepcopy(row[name]) for name in self.names) for row in rows]

            def __iter__(self):
                return iter(self.rows)

            def close(self):
                parent.closed_cursors += 1

        return Cursor()


def read(connection):
    return Reader(connection, [0], "2026-01-01", "2027-01-01", throttle_seconds=0).inspect_bill(
        1, "2026 - 2027 ", 0, 0
    )


def test_evidence_schema_and_salesperson_number_name_without_duplicate_total():
    db = FakeConnection()
    Reader(db, [0]).verify_schema()
    result = read(db)
    assert result.header["NetAmt"] == "1000.0"
    assert result.header["UserID"] == 88
    assert len(result.lines) == 3 and result.key[1] == "2026 - 2027 "
    assert {x["salesperson_ref"] for x in result.lines} == {"7", "8"}
    assert {x["salesperson_name"] for x in result.lines} == {"Synthetic seven", "Synthetic eight"}
    assert result.eligible_for_upload is False and result.mapping_status == "UNVALIDATED"
    page = Reader(db, [0]).salespeople_page(limit=1)
    assert page == [{"SLNo": 7, "SLName": "Synthetic seven"}]
    assert Reader(db, [0]).salespeople_page(after=7) == [{"SLNo": 8, "SLName": "Synthetic eight"}]
    assert db.closed_cursors == len(db.calls)


def test_multiset_duplicate_line_order_and_salesperson_only_change():
    db = FakeConnection()
    original = read(db)
    db.lines.reverse()
    assert read(db).digest == original.digest
    db.people[7] = "Synthetic renamed seven"
    renamed = read(db)
    assert renamed.digest != original.digest
    db.lines[-1]["SLNo"] = 8
    reassigned = read(db)
    assert reassigned.digest != renamed.digest
    db.lines.pop()
    assert read(db).digest != reassigned.digest


def test_missing_reference_is_preserved_not_guessed():
    db = FakeConnection()
    del db.people[7]
    result = read(db)
    missing = [x for x in result.lines if x["SLNo"] == 7]
    assert len(missing) == 2
    assert all(
        x["salesperson_ref"] == "7"
        and x["salesperson_name"] == ""
        and x["attribution_status"] == "MISSING_OR_BLANK_LOOKUP"
        for x in missing
    )


def test_local_reader_result_cannot_enter_synthetic_outbox(store):
    from test_store import bound

    bound(store)
    snapshot = read(FakeConnection())
    with pytest.raises(TypeError, match="local SQL results cannot"):
        store.enqueue_scan(snapshot, "2026-11-02T10:00:00Z")
    assert snapshot.source_kind == "REAL_LOCAL_ONLY" and snapshot.eligible_for_upload is False
    assert store.count() == store.get("sequence") == store.get("scan_checkpoint") == 0


@pytest.mark.parametrize(
    "failure,code",
    [
        ("absent", "KEY_ABSENT"),
        ("empty", "EMPTY_LINES"),
        ("oversize", "OVERSIZE_BILL"),
        ("unstable", "UNSTABLE"),
        ("schema", "SCHEMA"),
    ],
)
def test_unresolved_cases_never_become_cancellations_or_partial_bills(failure, code):
    db = FakeConnection()
    if failure == "absent":
        db.header = None
    if failure == "empty":
        db.lines = []
    if failure == "oversize":
        db.lines *= 67
    if failure == "unstable":
        db.mutate = lambda d: d.header.update(NetAmt=d.header["NetAmt"] + 1)
    if failure == "schema":
        db.schema = [c for c in db.schema if c["COLUMN_NAME"] != "NetAmt"]
    with pytest.raises(ExtractionReview, match=code):
        Reader(db, [0]).verify_schema()
        read(db)


def test_failed_query_and_unapproved_scope_never_mean_missing():
    db = FakeConnection()
    db.fail = LINES_SQL
    with pytest.raises(TimeoutError):
        read(db)
    assert db.closed_cursors == len(db.calls)
    reader = Reader(db, [0], "2026-01-01", "2027-01-01", throttle_seconds=0)
    with pytest.raises(ExtractionReview):
        reader.inspect_bill(1, "year", 0, 1)
    with pytest.raises(ValueError):
        reader.query("DELETE FROM dbo.Invoice")
    with pytest.raises(ExtractionReview):
        reader.keys_page(2, 0, "2026-01-01", "2027-01-01")
    reader.keys_page(0, 0, "2026-01-01", "2027-01-01", after=(42, "year verbatim"))
    assert db.calls[-1][1] == (50, 0, 0, "2026-01-01", "2027-01-01", 42, 42, "year verbatim")
