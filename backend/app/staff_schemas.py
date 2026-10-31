from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

MONEY = r"^(0|[1-9]\d{0,8})(\.\d{1,2})?$"


class StaffInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ReferenceSalary(StaffInput):
    amount: str = Field(pattern=MONEY)
    basis: Literal["MONTHLY", "DAILY"] = "MONTHLY"


class ReferenceUpdate(StaffInput):
    revision: int = Field(ge=0)
    request_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    salary: Optional[ReferenceSalary] = None
    reason: str = Field(min_length=2, max_length=300)


class StaffPayment(StaffInput):
    day_id: str = Field(min_length=1, max_length=100)
    revision: int = Field(ge=1)
    request_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    kind: Literal["SALARY", "ADVANCE", "OTHER_GIVEN", "RECEIVED", "PURCHASE"]
    amount: str = Field(pattern=MONEY)
    payment_method: Literal["CASH", "DIGITAL"] = "CASH"
    note: str = Field(min_length=2, max_length=300)


class StaffNote(StaffInput):
    request_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    date: date
    note: str = Field(min_length=2, max_length=1000)
