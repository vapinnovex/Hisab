"""Integer-paise cash reconciliation, independent of transport and storage."""

from decimal import Decimal

TOTALS = {
    "CASH_SALE": "cash_sales",
    "DIGITAL_SALE": "digital_sales",
    "CREDIT_SALE": "credit_sales",
    "OTHER_CASH_IN": "other_cash_in",
    "EXPENSE": "expenses_total",
    "SUPPLIER_PAYMENT": "supplier_payments",
    "BANK_DEPOSIT": "bank_deposit",
    "WITHDRAWAL": "withdrawals",
}
SALE_TYPES = {"CASH_SALE", "DIGITAL_SALE", "CREDIT_SALE"}
MONEY_KEYS = {
    *TOTALS.values(),
    "opening_cash",
    "amount",
    "expected_closing_cash",
    "actual_closing_cash",
    "difference",
    "total_sales",
    "cash_expenses",
    "digital_expenses",
    "cash_supplier_payments",
    "digital_supplier_payments",
    "counted_cash",
    "closing_bank_deposit",
    "closing_withdrawal",
    "recorded_sales",
    "estimated_sales",
    "unallocated_sales",
}


def paise(value):
    return int(Decimal(value) * 100)


def hydrate(day):
    """Old records keep the entry method and their preserved numbers, without a migration."""
    if day is None:
        return None
    day.setdefault("mode", "ENTRIES")
    day.setdefault("billing_input", "SPLIT")
    day.setdefault("unallocated_sales", 0)
    day.setdefault("digital_sales", 0)
    day.setdefault("credit_sales", 0)
    if "total_sales" not in day:
        day["total_sales"] = (
            (day.get("cash_sales") or 0) + (day["digital_sales"] or 0) + (day["credit_sales"] or 0)
        )
    day.setdefault("cash_expenses", day.get("expenses_total", 0))
    day.setdefault("digital_expenses", 0)
    day.setdefault("cash_supplier_payments", day.get("supplier_payments", 0))
    day.setdefault("digital_supplier_payments", 0)
    day.setdefault("closing_bank_deposit", 0)
    day.setdefault("closing_withdrawal", 0)
    day.setdefault("counted_cash", day.get("actual_closing_cash"))
    return day


def calculate(day):
    hydrate(day)
    for field in TOTALS.values():
        day[field] = 0
    for field in ["cash_expenses", "digital_expenses", "cash_supplier_payments", "digital_supplier_payments"]:
        day[field] = 0
    for entry in day["transactions"]:
        if entry["deleted"]:
            continue
        day[TOTALS[entry["type"]]] += entry["amount"]
        if entry["type"] in {"EXPENSE", "SUPPLIER_PAYMENT"}:
            prefix = "digital" if entry.get("payment_method", "CASH") == "DIGITAL" else "cash"
            suffix = "expenses" if entry["type"] == "EXPENSE" else "supplier_payments"
            day[f"{prefix}_{suffix}"] += entry["amount"]
    # Closing transfers supplement transfers already recorded during the day.
    day["bank_deposit"] += day["closing_bank_deposit"]
    day["withdrawals"] += day["closing_withdrawal"]
    if day["mode"] != "ENTRIES":
        sales = day.get("reported_sales")
        day["cash_sales"] = sales["cash_sales"] if sales else None
        day["digital_sales"] = sales["digital_sales"] if sales else None
        day["credit_sales"] = sales["credit_sales"] if sales else None
    day["total_sales"] = (
        day["cash_sales"] + day["digital_sales"] + day["credit_sales"]
        if day["cash_sales"] is not None
        else None
    )
    if day["mode"] == "BILLING" and day.get("reported_sales"):
        day["total_sales"] = day["reported_sales"].get("total_sales", day["total_sales"])
    day["unallocated_sales"] = (day["total_sales"] or 0) if day["cash_sales"] is None else 0
    day["expected_closing_cash"] = (
        day["opening_cash"]
        + day["cash_sales"]
        + day["other_cash_in"]
        - day["cash_expenses"]
        - day["cash_supplier_payments"]
        - day["bank_deposit"]
        - day["withdrawals"]
        if day["mode"] != "COUNTED" and day["cash_sales"] is not None
        else None
    )
