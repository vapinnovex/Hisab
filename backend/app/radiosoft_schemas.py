"""Version 1 synthetic contract. Unknown fields (including source tenders) are rejected."""

from datetime import date
from typing import Literal, Optional

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PilotSettings(Contract):
    revision: int = Field(ge=0)
    mode: Literal["OFF", "PREVIEW"]
    manager_view: bool = False
    manager_collect: bool = False
    manager_correct: bool = False


class PairRequest(Contract):
    code: str = Field(min_length=32, max_length=100, repr=False)
    credential: str = Field(min_length=43, max_length=100, pattern=r"^[A-Za-z0-9_-]+$", repr=False)


class BillKey(Contract):
    invoice_no: str = Field(pattern=r"^[1-9][0-9]{0,17}$")
    fyear: str = Field(min_length=1, max_length=100)
    invoice_type: Literal[0, 1]
    firm_code: int = Field(strict=True, ge=0)


class Amounts(Contract):
    # Decimal strings preserve SQL-real observations without binary arithmetic here.
    net_amt: str = Field(pattern=r"^\d{1,10}(\.\d{1,8})?$")
    card_pay_charges: str = Field(default="0", pattern=r"^\d{1,10}(\.\d{1,8})?$")
    round_amt: str = Field(default="0", pattern=r"^-?\d{1,10}(\.\d{1,8})?$")
    exchange_amt: str = Field(default="0", pattern=r"^\d{1,10}(\.\d{1,8})?$")
    advance_amt: str = Field(default="0", pattern=r"^\d{1,10}(\.\d{1,8})?$")
    coupon_discount: str = Field(default="0", pattern=r"^\d{1,10}(\.\d{1,8})?$")
    loyalty_discount: str = Field(default="0", pattern=r"^\d{1,10}(\.\d{1,8})?$")


class Line(Contract):
    description: str = Field(max_length=200)
    quantity: str = Field(pattern=r"^\d{1,8}(\.\d{1,8})?$")
    amount: str = Field(pattern=r"^-?\d{1,10}(\.\d{1,8})?$")
    salesperson_ref: str = Field(default="", max_length=100)
    salesperson_name: str = Field(default="", max_length=100)


class Observation(Contract):
    version: Literal[1]
    synthetic: Literal[True]
    source_id: str = Field(min_length=1, max_length=100)
    generation: str = Field(min_length=1, max_length=100)
    sequence: int = Field(strict=True, ge=1, le=9_007_199_254_740_991)
    observed_at: AwareDatetime
    mapping_version: Literal["synthetic-net-v1"]
    key: BillKey
    business_date: date
    source_time_raw: str = Field(default="", max_length=40)
    amounts: Amounts
    lines: list[Line] = Field(max_length=200)
    source_status: Literal["CURRENT", "MISSING_REVIEW", "CANCELLED"] = "CURRENT"
    lifecycle_evidence: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def lifecycle(self):
        if self.source_status != "CURRENT" and not self.lifecycle_evidence.strip():
            raise ValueError("Lifecycle review requires explicit synthetic evidence")
        return self


class Health(Contract):
    status: Literal["OK", "SOURCE_UNAVAILABLE", "SCHEMA_MISMATCH", "SCAN_INCOMPLETE", "OUTBOX_BLOCKED"]
    pending_observations: int = Field(strict=True, ge=0, le=10_000_000)


class Allocation(Contract):
    method: Literal["CASH", "UPI", "CARD", "UNSPECIFIED"]
    amount_paise: int = Field(strict=True, gt=0, le=1_000_000_000_000)


class CollectionAction(Contract):
    request_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    revision: int = Field(ge=1)
    action: Literal[
        "RECEIVE", "MARK_PAID", "RECLASSIFY", "REVERSE", "WAIVE", "REVERSE_WAIVER", "SETTLE", "NOTE"
    ]
    allocations: list[Allocation] = Field(default_factory=list, max_length=4)
    collection_id: Optional[str] = Field(default=None, max_length=100)
    reason: str = Field(default="", max_length=500)
    amount_paise: Optional[int] = Field(default=None, strict=True, gt=0, le=1_000_000_000_000)
    adjustment_id: Optional[str] = Field(default=None, max_length=100)
    remainder: Optional[Literal["PENDING", "CREDIT", "DISCOUNT"]] = None
    customer_name: str = Field(default="", max_length=100)
    note: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def shape(self):
        correction = self.action in {"RECLASSIFY", "REVERSE"}
        if correction != bool(self.collection_id):
            raise ValueError("Corrections must identify an existing collection")
        if correction and len(self.reason.strip()) < 2:
            raise ValueError("An audit reason is required")
        if (self.action == "WAIVE") != (self.amount_paise is not None):
            raise ValueError("Provide an adjustment amount only for a waiver")
        if (self.action == "REVERSE_WAIVER") != bool(self.adjustment_id):
            raise ValueError("Waiver reversal must identify an existing adjustment")
        if self.action in {"WAIVE", "REVERSE_WAIVER"} and len(self.reason.strip()) < 2:
            raise ValueError("An audit reason is required")
        if self.action != "SETTLE" and (self.action in {"RECEIVE", "RECLASSIFY"}) != bool(self.allocations):
            raise ValueError("Provide allocations only for a receipt or reclassification")
        if (self.action == "SETTLE") != (self.remainder is not None):
            raise ValueError("A settlement must specify how to handle the remainder")
        if self.action not in {"SETTLE", "NOTE"} and (self.customer_name or self.note):
            raise ValueError("Customer details and notes belong to settlements or notes")
        if self.remainder == "CREDIT" and len(self.customer_name.strip()) < 2:
            raise ValueError("Customer credit requires a customer name or reference")
        if self.action == "NOTE" and len(self.note.strip()) < 2:
            raise ValueError("Enter a note of at least two characters")
        if len({a.method for a in self.allocations}) != len(self.allocations):
            raise ValueError("Combine allocations for the same method")
        if self.action == "RECLASSIFY" and any(a.method == "UNSPECIFIED" for a in self.allocations):
            raise ValueError("Assign known methods when reclassifying")
        return self


class DailyEvidence(Contract):
    request_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    date: date
    scope: Literal["ALL_PILOT_COLLECTIONS"]
    source: str = Field(min_length=2, max_length=200)
    upi_paise: int = Field(strict=True, ge=0, le=1_000_000_000_000)
    card_paise: int = Field(strict=True, ge=0, le=1_000_000_000_000)
    note: str = Field(default="", max_length=500)
