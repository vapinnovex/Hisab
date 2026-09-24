from datetime import date
from enum import Enum
from typing import Optional

from pydantic import Field

from .schemas import Input

# Wire values are decimal strings. Stored/calculated values are integer paise.
MONEY_PATTERN = r"^(0|[1-9]\d{0,8})(\.\d{1,2})?$"


class TransactionType(str, Enum):
    CASH_SALE = "CASH_SALE"
    OTHER_CASH_IN = "OTHER_CASH_IN"
    EXPENSE = "EXPENSE"
    SUPPLIER_PAYMENT = "SUPPLIER_PAYMENT"
    BANK_DEPOSIT = "BANK_DEPOSIT"
    WITHDRAWAL = "WITHDRAWAL"


class DayCreate(Input):
    date: Optional[date] = None
    opening_cash: Optional[str] = Field(default=None, pattern=MONEY_PATTERN)
    reason: str = Field(default="", max_length=500)


class Versioned(Input):
    revision: int = Field(ge=1)


class OpeningUpdate(Versioned):
    opening_cash: str = Field(pattern=MONEY_PATTERN)
    reason: str = Field(min_length=2, max_length=500)


class TransactionInput(Versioned):
    type: TransactionType
    amount: str = Field(pattern=MONEY_PATTERN)
    category: str = Field(default="", max_length=80)
    description: str = Field(min_length=1, max_length=300)


class TransactionCreate(TransactionInput):
    request_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")


class TransactionEdit(TransactionInput):
    reason: str = Field(min_length=2, max_length=500)


class ReasonInput(Versioned):
    reason: str = Field(min_length=2, max_length=500)


class CloseInput(Versioned):
    actual_closing_cash: str = Field(pattern=MONEY_PATTERN)
    notes: str = Field(default="", max_length=1000)
    difference_note: str = Field(default="", max_length=500)
