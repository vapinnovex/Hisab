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
    "DUE_COLLECTION": "due_collections",
}
SALE_TYPES = {"CASH_SALE", "DIGITAL_SALE", "CREDIT_SALE"}
MONEY_KEYS = {
    *TOTALS.values(),
    "digital_other_in",
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
    "legacy_credit_sales",
    "paid_amount",
    "remaining_amount",
    "cash_due_collections",
    "digital_due_collections",
    "entry_credit_sales",
    "same_day_cash_collections",
    "same_day_digital_collections",
}


def paise(value):
    return int(Decimal(value) * 100)


def legacy_credit_balance(day):
    if day.get("credit_tracking") or day.get("mode", "ENTRIES") == "ENTRIES":
        return 0
    for snapshot in reversed(day.get("closing_snapshots", [])):
        if snapshot.get("credit_sales") is None:
            continue
        recorded = sum(
            entry["amount"] if entry["type"] == "CREDIT_SALE" else -entry["amount"]
            for entry in snapshot.get("transactions", [])
            if not entry["deleted"]
            and (
                entry["type"] == "CREDIT_SALE"
                or (entry["type"] == "DUE_COLLECTION" and entry["due_date"] == day["date"])
            )
        )
        return max(0, snapshot["credit_sales"] - recorded)
    return 0


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
    day.setdefault("legacy_credit_sales", legacy_credit_balance(day))
    return day


def calculate(day):
    hydrate(day)
    for field in TOTALS.values():
        day[field] = 0
    for field in ["cash_expenses", "digital_expenses", "cash_supplier_payments", "digital_supplier_payments"]:
        day[field] = 0
    day["digital_other_in"] = 0
    for entry in day["transactions"]:
        if entry["deleted"]:
            continue
        if entry["type"] == "OTHER_CASH_IN" and entry.get("payment_method") == "DIGITAL":
            day["digital_other_in"] += entry["amount"]
            continue
        day[TOTALS[entry["type"]]] += entry["amount"]
        if entry["type"] in {"EXPENSE", "SUPPLIER_PAYMENT"}:
            prefix = "digital" if entry.get("payment_method", "CASH") == "DIGITAL" else "cash"
            suffix = "expenses" if entry["type"] == "EXPENSE" else "supplier_payments"
            day[f"{prefix}_{suffix}"] += entry["amount"]
    day["cash_due_collections"] = 0
    day["digital_due_collections"] = 0
    day["same_day_cash_collections"] = 0
    day["same_day_digital_collections"] = 0
    for entry in day["transactions"]:
        if entry["deleted"] or entry["type"] != "DUE_COLLECTION":
            continue
        if entry["payment_method"] == "CASH":
            day["cash_due_collections"] += entry["amount"]
        else:
            day["digital_due_collections"] += entry["amount"]
        if entry["due_date"] == day["date"]:
            day["credit_sales"] -= entry["amount"]
            field = "cash_sales" if entry["payment_method"] == "CASH" else "digital_sales"
            day[field] += entry["amount"]
            collected = (
                "same_day_cash_collections"
                if entry["payment_method"] == "CASH"
                else "same_day_digital_collections"
            )
            day[collected] += entry["amount"]
        elif entry["payment_method"] == "CASH":
            day["other_cash_in"] += entry["amount"]
    day["entry_credit_sales"] = day["credit_sales"]
    # Closing transfers supplement transfers already recorded during the day.
    day["bank_deposit"] += day["closing_bank_deposit"]
    day["withdrawals"] += day["closing_withdrawal"]
    if day["mode"] != "ENTRIES":
        sales = day.get("reported_sales")
        day["cash_sales"] = sales["cash_sales"] if sales else None
        day["digital_sales"] = sales["digital_sales"] if sales else None
        day["credit_sales"] = (
            sales["credit_sales"] if sales else day["entry_credit_sales"] + day["legacy_credit_sales"]
        )
    day["total_sales"] = (
        day["cash_sales"] + day["digital_sales"] + day["credit_sales"]
        if day["cash_sales"] is not None
        else None
    )
    if day["mode"] == "BILLING" and day.get("reported_sales"):
        day["total_sales"] = day["reported_sales"].get("total_sales", day["total_sales"])
    day["unallocated_sales"] = (
        max(0, (day["total_sales"] or 0) - (day["credit_sales"] or 0)) if day["cash_sales"] is None else 0
    )
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
