"""Local-only discovery reader. It deliberately cannot produce an Observation envelope.

No production source is wired into the service. SELECT-only credentials and vendor
save/amount/lifecycle approval remain release gates, not assumptions made by this reader.
"""

import hashlib
import json
import time
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

HEAD_COLUMNS = (
    "InvoiceNo",
    "FYear",
    "InvoiceType",
    "FirmCode",
    "InvoiceDate",
    "Time",
    "TotalAmt",
    "DiscAmt",
    "IDisc",
    "GSTAmt",
    "IGSTAmt",
    "TaxAdditional",
    "NetAmt",
    "RoundAmt",
    "ExchangeAmt",
    "AdvAmt",
    "CoupenDisc",
    "LPDiscAmt",
    "CardPayCharges",
    "SLNo",
    "ESLNo",
    "UserID",
)
LINE_COLUMNS = (
    "InvoiceNo",
    "FYear",
    "InvoiceType",
    "FirmCode",
    "InvoiceDate",
    "Num",
    "SrNo",
    "BarCodeID",
    "ItemName",
    "Qty",
    "Mrp",
    "SaleRate",
    "Amount",
    "GST",
    "GSTAmt",
    "IGSTAmt",
    "NetAmt",
    "SLNo",
    "HLNo",
)
KEY_WHERE = "InvoiceNo=? AND FYear=? AND InvoiceType=? AND FirmCode=?"
HEADER_SQL = (
    "SELECT TOP (2) "
    + ",".join(HEAD_COLUMNS)
    + " FROM dbo.Invoice WHERE "
    + KEY_WHERE
    + " AND InvoiceDate>=? AND InvoiceDate<?"
)
LINES_SQL = "SELECT TOP (201) " + ",".join(LINE_COLUMNS) + " FROM dbo.InvoiceDetails WHERE " + KEY_WHERE
SCHEMA_SQL = """SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME IN ('Invoice','InvoiceDetails','Salesman')"""
SALESPERSON_SQL = "SELECT TOP (2) SLNo,SLName FROM dbo.Salesman WHERE SLNo=?"
SALESPERSON_PAGE_SQL = "SELECT TOP (?) SLNo,SLName FROM dbo.Salesman WHERE SLNo>? ORDER BY SLNo"
# Paging is a planning primitive, not a full historical coverage claim. No tender filter.
KEYS_SQL = """SELECT TOP (?) InvoiceNo,FYear,InvoiceType,FirmCode
FROM dbo.Invoice WHERE InvoiceType=? AND FirmCode=? AND InvoiceDate>=? AND InvoiceDate<?
AND (InvoiceNo>? OR (InvoiceNo=? AND FYear>?)) ORDER BY InvoiceNo,FYear"""


class ExtractionReview(Exception):
    pass


@dataclass(frozen=True)
class LocalRadioSoftSnapshot:
    key: tuple
    header: dict
    lines: tuple
    digest: str
    source_kind: str = "REAL_LOCAL_ONLY"
    eligible_for_upload: bool = False
    mapping_status: str = "UNVALIDATED"
    save_boundary: str = "STABLE_REREAD_ONLY_NOT_FINALITY"
    lifecycle: str = "CURRENT_ROW_OBSERVED_NOT_CANCELLATION_CONTRACT"


def canonical_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (float, Decimal)):
        # Preserve observation; money rules are not inferred. Avoid arithmetic on SQL real.
        if not Decimal(str(value)).is_finite():
            raise ExtractionReview("NONFINITE_SOURCE_NUMBER")
        return str(value)
    return value


class Reader:
    def __init__(self, connection, approved_firms, start_date=None, end_date=None, throttle_seconds=0.05):
        self.connection = connection
        self.firms = frozenset(approved_firms)
        self.start_date = date.fromisoformat(start_date) if start_date else None
        self.end_date = date.fromisoformat(end_date) if end_date else None
        self.throttle_seconds = max(0, throttle_seconds)
        self.query_count = 0
        self.max_query_seconds = 0

    def query(self, sql, params=()):
        if sql not in {HEADER_SQL, LINES_SQL, SCHEMA_SQL, KEYS_SQL, SALESPERSON_SQL, SALESPERSON_PAGE_SQL}:
            raise ValueError("Only reviewed SELECT templates are allowed")
        cursor = self.connection.cursor()
        time.sleep(self.throttle_seconds)
        started = time.monotonic()
        try:
            cursor.execute(sql, params)
            names = [x[0] for x in cursor.description]
            return [{key: canonical_value(value) for key, value in zip(names, row)} for row in cursor]
        finally:
            self.query_count += 1
            self.max_query_seconds = max(self.max_query_seconds, time.monotonic() - started)
            cursor.close()

    def verify_schema(self):
        columns = {(r["TABLE_NAME"], r["COLUMN_NAME"]): r["DATA_TYPE"] for r in self.query(SCHEMA_SQL)}
        for table, expected in (
            ("Invoice", HEAD_COLUMNS),
            ("InvoiceDetails", LINE_COLUMNS),
            ("Salesman", ("SLNo", "SLName")),
        ):
            if any((table, column) not in columns for column in expected):
                raise ExtractionReview("SCHEMA_MISSING_COLUMNS")
        expected_types = {
            ("Invoice", "InvoiceNo"): "int",
            ("Invoice", "FYear"): "varchar",
            ("Invoice", "NetAmt"): "real",
            ("InvoiceDetails", "BarCodeID"): "float",
            ("InvoiceDetails", "SLNo"): "int",
            ("Salesman", "SLNo"): "int",
            ("Salesman", "SLName"): "nvarchar",
        }
        if any(columns[k] != value for k, value in expected_types.items()):
            raise ExtractionReview("SCHEMA_MISMATCH")

    def keys_page(self, invoice_type, firm, start, end, after=(0, ""), limit=50):
        if invoice_type not in (0, 1) or firm not in self.firms or not 1 <= limit <= 100:
            raise ExtractionReview("UNAPPROVED_SCOPE")
        self.check_dates(start, end)
        return self.query(KEYS_SQL, (limit, invoice_type, firm, start, end, after[0], after[0], after[1]))

    def check_dates(self, start, end):
        if (
            not self.start_date
            or not self.end_date
            or not self.start_date
            <= date.fromisoformat(str(start))
            < date.fromisoformat(str(end))
            <= self.end_date
        ):
            raise ExtractionReview("UNAPPROVED_DATE_SCOPE")

    def salespeople_page(self, after=-2147483649, limit=50):
        """Installation-scoped assigned number + name only; no contacts/payroll/commission.

        This is local inspection data. There is no directory upload endpoint in v1.
        StopMark is not filtered: active/inactive semantics are not established.
        """
        if type(after) is not int or not 1 <= limit <= 100:
            raise ExtractionReview("INVALID_DIRECTORY_PAGE")
        return self.query(SALESPERSON_PAGE_SQL, (limit, after))

    def salesperson(self, reference):
        if reference is None or reference == 0:
            return {
                "salesperson_ref": "" if reference is None else str(reference),
                "salesperson_name": "",
                "attribution_status": "UNASSIGNED_OR_SENTINEL_UNVERIFIED",
            }
        rows = self.query(SALESPERSON_SQL, (reference,))
        if len(rows) > 1:
            raise ExtractionReview("SALESPERSON_REFERENCE_NOT_UNIQUE")
        name = rows[0]["SLName"] if rows else None
        if name is not None and not isinstance(name, str):
            raise ExtractionReview("SALESPERSON_NAME_TYPE_MISMATCH")
        return {
            "salesperson_ref": str(reference),
            "salesperson_name": name or "",
            "attribution_status": "RESOLVED_LOOKUP" if name else "MISSING_OR_BLANK_LOOKUP",
        }

    def _read(self, key):
        headers = self.query(HEADER_SQL, (*key, str(self.start_date), str(self.end_date)))
        if not headers:
            raise ExtractionReview("KEY_ABSENT_OR_OUTSIDE_DATES_REVIEW_ONLY_NOT_CANCELLED")
        if len(headers) != 1:
            raise ExtractionReview("HEADER_NOT_UNIQUE")
        lines = self.query(LINES_SQL, key)
        if not lines:
            raise ExtractionReview("EMPTY_LINES_SAVE_BOUNDARY_UNKNOWN")
        if len(lines) > 200:
            raise ExtractionReview("OVERSIZE_BILL_NEVER_TRUNCATE")
        # Never join a header total through this one-to-many lookup. Cache only within
        # one read; the second read also revalidates names so renames change the digest.
        people = {ref: self.salesperson(ref) for ref in {row["SLNo"] for row in lines}}
        lines = [{**row, **people[row["SLNo"]]} for row in lines]
        # Sort canonical rows as a multiset: duplicates retained; order does not matter.
        lines = sorted(lines, key=lambda r: json.dumps(r, sort_keys=True, ensure_ascii=False))
        raw = json.dumps([headers[0], lines], sort_keys=True, ensure_ascii=False).encode()
        return headers[0], tuple(lines), hashlib.sha256(raw).hexdigest()

    def inspect_bill(self, invoice_no, fyear, invoice_type, firm):
        if invoice_no <= 0 or invoice_type not in (0, 1) or firm not in self.firms:
            raise ExtractionReview("UNAPPROVED_BILL")
        self.check_dates(self.start_date, self.end_date)
        key = (invoice_no, fyear, invoice_type, firm)
        first, second = self._read(key), self._read(key)
        if first[2] != second[2]:
            raise ExtractionReview("UNSTABLE_HEADER_OR_ITEMS_RETRY_LATER")
        return LocalRadioSoftSnapshot(key, *second)


def open_local_readonly(server, database, driver="SQL Server Native Client 10.0"):
    """Explicit future local probe use only. Never called from service/network modules."""
    import re

    import pyodbc

    if not re.fullmatch(r"(?:\.|localhost)\\[A-Za-z0-9_]+", server):
        raise ValueError("Only a named local SQL instance is supported")
    if not re.fullmatch(r"[A-Za-z0-9_]+", database) or driver not in {
        "SQL Server Native Client 10.0",
        "ODBC Driver 18 for SQL Server",
    }:
        raise ValueError("Unapproved database/driver")
    # No password arguments or config-file secrets. Read-only mode is a hint; actual
    # SELECT-only grants must be independently approved and tested by the administrator.
    connection = pyodbc.connect(
        f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};Trusted_Connection=yes;",
        timeout=5,
        autocommit=True,
        attrs_before={101: 1},
    )
    connection.timeout = 10
    try:
        cursor = connection.cursor()
        try:
            cursor.execute("""SELECT IS_SRVROLEMEMBER('sysadmin'),IS_SRVROLEMEMBER('securityadmin'),
                IS_SRVROLEMEMBER('serveradmin'),IS_SRVROLEMEMBER('setupadmin'),
                IS_SRVROLEMEMBER('processadmin'),IS_SRVROLEMEMBER('diskadmin'),IS_SRVROLEMEMBER('bulkadmin'),
                IS_MEMBER('db_owner'),IS_MEMBER('db_securityadmin'),IS_MEMBER('db_ddladmin'),
                IS_MEMBER('db_datawriter'),IS_MEMBER('db_accessadmin'),IS_MEMBER('db_backupoperator')""")
            if any(x is None or x == 1 for x in cursor.fetchone()):
                raise ExtractionReview("PRIVILEGED_OR_UNKNOWN_IDENTITY_REFUSED")
            cursor.execute("SELECT permission_name FROM sys.fn_my_permissions(NULL,'DATABASE')")
            if any(
                row[0] not in {"CONNECT", "SELECT", "VIEW DEFINITION", "VIEW DATABASE STATE"}
                for row in cursor
            ):
                raise ExtractionReview("NON_READONLY_DATABASE_PERMISSION_REFUSED")
            for object_name in ("dbo.Invoice", "dbo.InvoiceDetails", "dbo.Salesman"):
                cursor.execute("SELECT permission_name FROM sys.fn_my_permissions(?,'OBJECT')", object_name)
                permissions = {row[0] for row in cursor}
                if "SELECT" not in permissions or permissions - {"SELECT", "VIEW DEFINITION"}:
                    raise ExtractionReview("SELECT_ONLY_OBJECT_GRANTS_REQUIRED")
        finally:
            cursor.close()
    except BaseException:
        connection.close()
        raise
    return connection
