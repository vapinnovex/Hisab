"""Separate v2 display-only real source contract; no tender/ledger inference."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal, Optional, Union

from pydantic import AwareDatetime, Field, model_validator

from .radiosoft_schemas import BillKey, Contract


class RealScope(Contract):
    shop_id: str = Field(min_length=1, max_length=100)
    owner_id: str = Field(min_length=1, max_length=100)
    source_id: str = Field(min_length=1, max_length=100)
    generation: str = Field(min_length=1, max_length=100)
    database: Literal["RsDB"]
    firm_codes: list[int] = Field(min_length=1, max_length=10)
    invoice_types: list[Literal[0, 1]] = Field(min_length=1, max_length=2)
    tracking_from: date
    capture_from: date
    capture_until: date
    mapping_version: Literal["real-display-v1"] = "real-display-v1"


class Setup(Contract):
    scope: RealScope
    confirm_source_and_scope: Literal[True]
    manager_view: bool = False
    manager_map: bool = False


class RealLine(Contract):
    raw: dict[str, Optional[Union[str, int]]] = Field(max_length=24)
    salesperson_ref: Optional[str] = Field(default=None, max_length=100)
    salesperson_name: str = Field(default="", max_length=100)
    attribution_status: Literal["RESOLVED_LOOKUP", "ABSENT_REFERENCE", "MISSING_OR_BLANK_LOOKUP"]


class RealBill(Contract):
    key: BillKey
    business_date: date
    source_time_raw: str = Field(default="", max_length=100)
    # Signed decimal source value, never converted through float or clamped.
    net_amt: Optional[str] = Field(pattern=r"^-?\d{1,40}(\.\d{1,50})?$")
    raw_header: dict[str, Optional[Union[str, int]]] = Field(max_length=24)
    lines: list[RealLine] = Field(max_length=200)


class Person(Contract):
    ref: str = Field(min_length=1, max_length=100)
    name: str = Field(max_length=100)


class RealObservation(Contract):
    version: Literal[2]
    synthetic: Literal[False]
    mapping_version: Literal["real-display-v1"]
    source_id: str = Field(min_length=1, max_length=100)
    generation: str = Field(min_length=1, max_length=100)
    sequence: int = Field(strict=True, ge=1, le=9007199254740991)
    observed_at: AwareDatetime
    kind: Literal["BILL", "DIRECTORY"]
    bill: Optional[RealBill] = None
    people: list[Person] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def shape(self):
        if (self.kind == "BILL") != (self.bill is not None) or (self.kind == "BILL" and self.people):
            raise ValueError("Invalid real observation kind")
        if len({p.ref for p in self.people}) != len(self.people):
            raise ValueError("Duplicate directory reference")
        if self.bill:
            header = {
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
            }
            line = {
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
            }
            if set(self.bill.raw_header) - header or any(set(x.raw) - line for x in self.bill.lines):
                raise ValueError("Unapproved source columns")
            if self.bill.raw_header.get("NetAmt") is None and self.bill.net_amt is None:
                return self
            try:
                if self.bill.net_amt is None or Decimal(str(self.bill.raw_header.get("NetAmt"))) != Decimal(
                    self.bill.net_amt
                ):
                    raise ValueError("Source payable mismatch")
            except InvalidOperation:
                raise ValueError("Invalid source payable")
        return self


class RealHealth(Contract):
    status: Literal["OK", "SOURCE_UNAVAILABLE", "SCHEMA_MISMATCH", "SCAN_INCOMPLETE", "OUTBOX_BLOCKED"]
    pending_observations: int = Field(ge=0, le=5000)
    last_successful_source_read: Optional[AwareDatetime] = None
    coverage: dict = Field(default_factory=dict, max_length=10)


class Mapping(Contract):
    revision: int = Field(ge=0)
    worker_id: Optional[str] = Field(default=None, max_length=100)
    reason: str = Field(min_length=2, max_length=500)
