"""Daily cash book: entries, totals, audit and snapshots commit as one Mongo document."""

import re
from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from bson import BSON
from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from ..db import get_db, new_id, now
from ..financial_schemas import (
    CloseInput,
    DayCreate,
    OpeningUpdate,
    ReasonInput,
    TransactionCreate,
    TransactionEdit,
    TransactionType,
)
from ..security import current_identity, shop_access
from ..shop_policy import permissions_for, require_permission

router = APIRouter(prefix="/shops/{shop_id}/hishob", tags=["Daily Hishob"])
TOTALS = {
    "CASH_SALE": "cash_sales",
    "OTHER_CASH_IN": "other_cash_in",
    "EXPENSE": "expenses_total",
    "SUPPLIER_PAYMENT": "supplier_payments",
    "BANK_DEPOSIT": "bank_deposit",
    "WITHDRAWAL": "withdrawals",
}
MONEY_KEYS = {
    *TOTALS.values(),
    "opening_cash",
    "amount",
    "expected_closing_cash",
    "actual_closing_cash",
    "difference",
}


def paise(value):
    return int(Decimal(value) * 100)


def serialize(value, key=None):
    if isinstance(value, datetime):
        return value.replace(microsecond=(value.microsecond // 1000) * 1000)
    if key in MONEY_KEYS and isinstance(value, int):
        return format(Decimal(value) / 100, ".2f")
    if isinstance(value, dict):
        return {("id" if k == "_id" else k): serialize(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [serialize(item) for item in value]
    return value


def access(db, shop_id, identity, permission="view_hishob"):
    member, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    require_permission(member, shop, permission)
    return member, shop


def actor(identity, member):
    return {
        "user_id": identity.user["_id"],
        "name": identity.user.get("name") or member.get("name") or identity.user["mobile"],
        "role": identity.role,
    }


def business_today(shop):
    return now().astimezone(ZoneInfo(shop["timezone"])).date()


def get_day(db, shop_id, day_id):
    day = db.hishob_days.find_one({"_id": day_id, "shop_id": shop_id})
    if not day:
        raise HTTPException(404, "Hishob day not found in this shop.")
    return day


def prior_closed(db, shop_id, day):
    return db.hishob_days.find_one(
        {"shop_id": shop_id, "date": {"$lt": str(day)}, "status": "CLOSED"}, sort=[("date", -1)]
    )


def calculate(day):
    for field in TOTALS.values():
        day[field] = 0
    for entry in day["transactions"]:
        if not entry["deleted"]:
            day[TOTALS[entry["type"]]] += entry["amount"]
    day["expected_closing_cash"] = (
        day["opening_cash"]
        + day["cash_sales"]
        + day["other_cash_in"]
        - day["expenses_total"]
        - day["supplier_payments"]
        - day["bank_deposit"]
        - day["withdrawals"]
    )


def check_open(day, revision):
    if day["status"] != "OPEN":
        raise HTTPException(409, "This day is closed. The owner must reopen it before making changes.")
    if day["revision"] != revision:
        raise HTTPException(409, "This day changed on another device. Refresh and try again.")


def audit(day, action, who, before, after, reason=""):
    day["audit"].append(
        {
            "id": new_id(),
            "action": action,
            "actor": who,
            "at": now(),
            "previous": deepcopy(before),
            "new": deepcopy(after),
            "reason": reason,
        }
    )


def save(db, day, revision):
    day["updated_at"] = now()
    day["revision"] = revision + 1
    # Reject growth before Mongo's 16 MB limit; financial history is never truncated.
    if len(BSON.encode(day)) > 12_000_000:
        raise HTTPException(
            409, "This day has reached its storage limit. Contact support before adding more entries."
        )
    result = db.hishob_days.replace_one(
        {"_id": day["_id"], "shop_id": day["shop_id"], "revision": revision}, day
    )
    if not result.modified_count:
        raise HTTPException(409, "This day changed on another device. Refresh and try again.")
    return serialize(day)


@router.get("/today")
def today(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    member, shop = access(db, shop_id, identity)
    day = business_today(shop)
    current = db.hishob_days.find_one({"shop_id": shop_id, "date": str(day)})
    previous = prior_closed(db, shop_id, day)
    return {
        "date": str(day),
        "timezone": shop["timezone"],
        "day": serialize(current),
        "suggested_opening_cash": serialize(previous["actual_closing_cash"], "opening_cash")
        if previous
        else None,
        "previous_closed_date": previous["date"] if previous else None,
        "permissions": permissions_for(member, shop),
    }


@router.post("/days", status_code=201)
def create_day(shop_id: str, body: DayCreate, identity=Depends(current_identity), db=Depends(get_db)):
    member, shop = access(db, shop_id, identity, "add_hishob_transactions")
    target = body.date or business_today(shop)
    if (
        target > business_today(shop)
        or target < shop["created_at"].astimezone(ZoneInfo(shop["timezone"])).date()
    ):
        raise HTTPException(422, "Choose a date between shop creation and today.")
    previous = prior_closed(db, shop_id, target)
    suggested = previous["actual_closing_cash"] if previous else None
    if body.opening_cash is None and suggested is None:
        raise HTTPException(422, "Enter opening cash for your first Hishob day.")
    opening = paise(body.opening_cash) if body.opening_cash is not None else suggested
    if suggested is not None and opening != suggested and len(body.reason) < 2:
        raise HTTPException(422, "Add a reason for changing the carried opening cash.")
    timestamp = now()
    day = {
        "_id": new_id(),
        "shop_id": shop_id,
        "date": str(target),
        "timezone": shop["timezone"],
        "opening_cash": opening,
        "opening_source": {
            "day_id": previous["_id"],
            "date": previous["date"],
            "revision": previous["revision"],
            "actual_closing_cash": suggested,
        }
        if previous
        else None,
        "status": "OPEN",
        "notes": "",
        "difference_note": "",
        "actual_closing_cash": None,
        "difference": None,
        "closed_by": None,
        "closed_at": None,
        "created_at": timestamp,
        "updated_at": timestamp,
        "revision": 1,
        "transactions": [],
        "audit": [],
        "closing_snapshots": [],
    }
    calculate(day)
    audit(
        day,
        "OPEN_DAY",
        actor(identity, member),
        None,
        {"opening_cash": opening, "opening_source": day["opening_source"]},
        body.reason,
    )
    try:
        db.hishob_days.insert_one(day)
    except DuplicateKeyError:
        raise HTTPException(409, "This business date already has a Hishob. Open the existing day.")
    return serialize(day)


@router.get("/days")
def list_days(
    shop_id: str,
    from_date: date = Query(),
    to_date: date = Query(),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    access(db, shop_id, identity)
    if from_date > to_date or (to_date - from_date).days > 366:
        raise HTTPException(422, "Choose a date range of at most 366 days.")
    records = db.hishob_days.find(
        {"shop_id": shop_id, "date": {"$gte": str(from_date), "$lte": str(to_date)}},
        {"transactions": 0, "audit": 0, "closing_snapshots": 0},
    ).sort("date", -1)
    return [serialize(day) for day in records]


@router.get("/transactions")
def search_transactions(
    shop_id: str,
    q: str = Query(default="", max_length=100),
    transaction_type: Optional[TransactionType] = Query(default=None, alias="type"),
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    entry_status: Literal["ACTIVE", "ALL", "DELETED"] = Query(default="ACTIVE"),
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=30, ge=1, le=100),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    access(db, shop_id, identity)
    if (from_date is None) != (to_date is None):
        raise HTTPException(422, "Choose both a start and end date, or search all dates.")
    match = {"shop_id": shop_id}
    if from_date is not None:
        if from_date > to_date or (to_date - from_date).days > 366:
            raise HTTPException(422, "Choose a date range of at most 366 days.")
        match["date"] = {"$gte": str(from_date), "$lte": str(to_date)}
    entries = {}
    if entry_status != "ALL":
        entries["transactions.deleted"] = entry_status == "DELETED"
    if transaction_type:
        entries["transactions.type"] = transaction_type.value
    if q.strip():
        # A literal substring search: user input can never become a regex expression.
        entries["$or"] = [
            {f"transactions.{field}": {"$regex": re.escape(q.strip()), "$options": "i"}}
            for field in ["description", "category", "created_by.name"]
        ]
    incoming = {"$in": ["$transactions.type", ["CASH_SALE", "OTHER_CASH_IN"]]}
    active = {"$eq": ["$transactions.deleted", False]}
    result = next(
        db.hishob_days.aggregate(
            [
                # Reuses the shop/date index; excludes audit and snapshots before unwinding.
                {"$match": match},
                {"$project": {"date": 1, "status": 1, "transactions": 1}},
                {"$unwind": "$transactions"},
                {"$match": entries},
                {"$sort": {"date": -1, "transactions.created_at": -1, "transactions.id": -1}},
                {
                    "$facet": {
                        "items": [
                            {"$skip": (page - 1) * page_size},
                            {"$limit": page_size},
                            {
                                "$project": {
                                    "_id": 0,
                                    "day_id": "$_id",
                                    "date": 1,
                                    "day_status": "$status",
                                    "entry": "$transactions",
                                }
                            },
                        ],
                        "summary": [
                            {
                                "$group": {
                                    "_id": None,
                                    "total": {"$sum": 1},
                                    "cash_in": {
                                        "$sum": {
                                            "$cond": [{"$and": [active, incoming]}, "$transactions.amount", 0]
                                        }
                                    },
                                    "cash_out": {
                                        "$sum": {
                                            "$cond": [
                                                {"$and": [active, {"$not": [incoming]}]},
                                                "$transactions.amount",
                                                0,
                                            ]
                                        }
                                    },
                                }
                            }
                        ],
                    }
                },
            ],
            allowDiskUse=True,
            maxTimeMS=10000,
        )
    )
    summary = result["summary"][0] if result["summary"] else {"total": 0, "cash_in": 0, "cash_out": 0}
    return {
        "items": serialize(result["items"]),
        "total": summary["total"],
        "cash_in": serialize(summary["cash_in"], "amount"),
        "cash_out": serialize(summary["cash_out"], "amount"),
        "page": page,
        "page_size": page_size,
        "has_more": page * page_size < summary["total"],
    }


@router.get("/days/{day_id}")
def day_details(shop_id: str, day_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    access(db, shop_id, identity)
    return serialize(get_day(db, shop_id, day_id))


@router.patch("/days/{day_id}/opening")
def update_opening(
    shop_id: str, day_id: str, body: OpeningUpdate, identity=Depends(current_identity), db=Depends(get_db)
):
    member, _ = access(db, shop_id, identity, "add_hishob_transactions")
    day = get_day(db, shop_id, day_id)
    check_open(day, body.revision)
    before = {"opening_cash": day["opening_cash"]}
    day["opening_cash"] = paise(body.opening_cash)
    calculate(day)
    audit(
        day,
        "CHANGE_OPENING",
        actor(identity, member),
        before,
        {"opening_cash": day["opening_cash"]},
        body.reason,
    )
    return save(db, day, body.revision)


def transaction_values(body):
    amount = paise(body.amount)
    if amount <= 0:
        raise HTTPException(422, "Enter an amount greater than zero.")
    return {
        "type": body.type.value,
        "amount": amount,
        "category": body.category,
        "description": body.description,
    }


@router.post("/days/{day_id}/transactions", status_code=201)
def add_transaction(
    shop_id: str, day_id: str, body: TransactionCreate, identity=Depends(current_identity), db=Depends(get_db)
):
    member, _ = access(db, shop_id, identity, "add_hishob_transactions")
    day = get_day(db, shop_id, day_id)
    values = transaction_values(body)
    existing = next((t for t in day["transactions"] if t["id"] == body.request_id), None)
    if existing:
        if existing["original"] != values or existing["created_by"]["user_id"] != identity.user["_id"]:
            raise HTTPException(409, "This transaction reference was already used.")
        return serialize(day)
    check_open(day, body.revision)
    who = actor(identity, member)
    entry = {
        "id": body.request_id,
        "shop_id": shop_id,
        "hishob_id": day_id,
        "date": day["date"],
        **values,
        "original": values,
        "created_by": who,
        "created_at": now(),
        "updated_at": now(),
        "deleted": False,
    }
    day["transactions"].append(entry)
    calculate(day)
    audit(day, "ADD_TRANSACTION", who, None, entry)
    return save(db, day, body.revision)


@router.patch("/days/{day_id}/transactions/{transaction_id}")
def edit_transaction(
    shop_id: str,
    day_id: str,
    transaction_id: str,
    body: TransactionEdit,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    member, _ = access(db, shop_id, identity, "edit_hishob_transactions")
    day = get_day(db, shop_id, day_id)
    check_open(day, body.revision)
    entry = next((t for t in day["transactions"] if t["id"] == transaction_id and not t["deleted"]), None)
    if not entry:
        raise HTTPException(404, "Active transaction not found.")
    before = deepcopy(entry)
    entry.update(transaction_values(body), updated_at=now(), updated_by=actor(identity, member))
    calculate(day)
    audit(day, "EDIT_TRANSACTION", actor(identity, member), before, entry, body.reason)
    return save(db, day, body.revision)


@router.post("/days/{day_id}/transactions/{transaction_id}/delete")
def delete_transaction(
    shop_id: str,
    day_id: str,
    transaction_id: str,
    body: ReasonInput,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    member, _ = access(db, shop_id, identity, "edit_hishob_transactions")
    day = get_day(db, shop_id, day_id)
    check_open(day, body.revision)
    entry = next((t for t in day["transactions"] if t["id"] == transaction_id and not t["deleted"]), None)
    if not entry:
        raise HTTPException(404, "Active transaction not found.")
    before = deepcopy(entry)
    entry.update(deleted=True, deleted_at=now(), deleted_by=actor(identity, member), updated_at=now())
    calculate(day)
    audit(day, "DELETE_TRANSACTION", actor(identity, member), before, entry, body.reason)
    return save(db, day, body.revision)


@router.post("/days/{day_id}/close")
def close_day(
    shop_id: str, day_id: str, body: CloseInput, identity=Depends(current_identity), db=Depends(get_db)
):
    member, _ = access(db, shop_id, identity, "close_hishob")
    day = get_day(db, shop_id, day_id)
    check_open(day, body.revision)
    calculate(day)
    actual = paise(body.actual_closing_cash)
    difference = actual - day["expected_closing_cash"]
    if difference and len(body.difference_note) < 2:
        raise HTTPException(422, "Add a difference note before closing with a shortage or extra cash.")
    before = {"status": "OPEN", "actual_closing_cash": None, "difference": None}
    day.update(
        status="CLOSED",
        actual_closing_cash=actual,
        difference=difference,
        notes=body.notes,
        difference_note=body.difference_note,
        closed_by=actor(identity, member),
        closed_at=now(),
    )
    snapshot = {
        key: deepcopy(value) for key, value in day.items() if key not in {"_id", "audit", "closing_snapshots"}
    }
    snapshot.update(revision=body.revision + 1, snapshot_id=new_id(), updated_at=day["closed_at"])
    day["closing_snapshots"].append(snapshot)
    audit(
        day,
        "CLOSE_DAY",
        actor(identity, member),
        before,
        {
            "status": "CLOSED",
            "expected_closing_cash": day["expected_closing_cash"],
            "actual_closing_cash": actual,
            "difference": difference,
        },
        body.difference_note,
    )
    return save(db, day, body.revision)


@router.post("/days/{day_id}/reopen")
def reopen_day(
    shop_id: str, day_id: str, body: ReasonInput, identity=Depends(current_identity), db=Depends(get_db)
):
    member, _ = access(db, shop_id, identity, "reopen_hishob")
    day = get_day(db, shop_id, day_id)
    if day["status"] != "CLOSED" or day["revision"] != body.revision:
        raise HTTPException(409, "This closing changed. Refresh and try again.")
    before = {
        key: day[key]
        for key in [
            "status",
            "actual_closing_cash",
            "difference",
            "difference_note",
            "closed_by",
            "closed_at",
        ]
    }
    day.update(
        status="OPEN",
        actual_closing_cash=None,
        difference=None,
        difference_note="",
        closed_by=None,
        closed_at=None,
    )
    audit(day, "REOPEN_DAY", actor(identity, member), before, {"status": "OPEN"}, body.reason)
    return save(db, day, body.revision)
