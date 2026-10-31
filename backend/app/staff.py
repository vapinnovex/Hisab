"""Staff reference pay is informational. Money lives only in Hishob."""

from fastapi import HTTPException

from .cashbook import paise
from .shop_policy import permissions_for


def can_manage(actor, shop, target):
    return actor["role"] == "OWNER" or (
        target["role"] == "WORKER"
        and actor["user_id"] != target["user_id"]
        and permissions_for(actor, shop)["manage_staff_payments"]
    )


def initial_reference(salary):
    if paise(salary.amount) <= 0:
        raise HTTPException(422, "Salary amount must be greater than zero.")
    return {"revision": 1, "salary": salary.model_dump(), "history": []}


def reference_for(target):
    if "pay_reference" in target:
        return target["pay_reference"]
    # Preserve the most recently agreed amount from the former salary book.
    terms = target.get("salary", {}).get("terms", [])
    return {
        "revision": 0,
        "salary": {key: terms[-1][key] for key in ("amount", "basis")} if terms else None,
        "history": [],
    }
