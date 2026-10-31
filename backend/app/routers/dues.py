"""Customer credit register and auditable, atomic payment receipts."""

import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from ..cashbook import calculate, paise
from ..db import get_db, now
from ..dues import due_key, receipts_for, reserve_receipt
from ..financial_schemas import DuePayment
from ..security import current_identity
from .hishob import access, actor, audit, business_today, check_open, get_day, save, serialize

router = APIRouter(prefix="/shops/{shop_id}/hishob", tags=["Customer dues"])


@router.get("/dues")
def list_dues(
    shop_id: str,
    status: Literal["ALL", "OPEN", "PAID"] = "OPEN",
    q: str = Query(default="", max_length=100),
    page: int = Query(default=1, ge=1),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    access(db, shop_id, identity)
    match = {"transactions.type": "CREDIT_SALE", "transactions.deleted": False}
    if q.strip():
        match["$or"] = [
            {f"transactions.{f}": {"$regex": re.escape(q.strip()), "$options": "i"}}
            for f in ["customer_name", "description"]
        ]
    stages = [
        {"$match": {"shop_id": shop_id, "transactions.type": "CREDIT_SALE"}},
        {"$project": {"date": 1, "transactions": 1}},
        {"$unwind": "$transactions"},
        {"$match": match},
        {"$set": {"due_key": {"$concat": ["$_id", ":", "$transactions.id"]}}},
        {
            "$lookup": {
                "from": "hishob_days",
                "localField": "due_key",
                "foreignField": "due_keys",
                "as": "payment_days",
                "pipeline": [{"$match": {"shop_id": shop_id}}, {"$project": {"transactions": 1}}],
            }
        },
        {
            "$set": {
                "payments": {
                    "$filter": {
                        "input": {
                            "$reduce": {
                                "input": "$payment_days",
                                "initialValue": [],
                                "in": {"$concatArrays": ["$$value", "$$this.transactions"]},
                            }
                        },
                        "as": "receipt",
                        "cond": {
                            "$and": [
                                {"$eq": ["$$receipt.type", "DUE_COLLECTION"]},
                                {"$eq": ["$$receipt.due_key", "$due_key"]},
                            ]
                        },
                    }
                }
            }
        },
        {"$set": {"paid_amount": {"$sum": "$payments.amount"}}},
        {"$set": {"remaining_amount": {"$subtract": ["$transactions.amount", "$paid_amount"]}}},
    ]
    if status != "ALL":
        stages.append({"$match": {"remaining_amount": {"$gt": 0} if status == "OPEN" else 0}})
    stages += [
        {"$sort": {"date": -1, "transactions.created_at": -1, "transactions.id": 1}},
        {
            "$facet": {
                "items": [
                    {"$skip": (page - 1) * 30},
                    {"$limit": 30},
                    {
                        "$project": {
                            "_id": 0,
                            "source_day_id": "$_id",
                            "entry_id": "$transactions.id",
                            "date": 1,
                            "customer_name": {"$ifNull": ["$transactions.customer_name", ""]},
                            "description": "$transactions.description",
                            "amount": "$transactions.amount",
                            "paid_amount": 1,
                            "remaining_amount": 1,
                            "payments": 1,
                        }
                    },
                ],
                "summary": [
                    {
                        "$group": {
                            "_id": None,
                            "total": {"$sum": 1},
                            "amount": {"$sum": "$transactions.amount"},
                            "paid_amount": {"$sum": "$paid_amount"},
                            "remaining_amount": {"$sum": "$remaining_amount"},
                        }
                    }
                ],
            }
        },
    ]
    result = next(db.hishob_days.aggregate(stages, maxTimeMS=10000, allowDiskUse=True))
    summary = (
        result["summary"][0]
        if result["summary"]
        else {"total": 0, "amount": 0, "paid_amount": 0, "remaining_amount": 0}
    )
    summary.pop("_id", None)
    return serialize({"items": result["items"], "summary": summary, "has_more": page * 30 < summary["total"]})


@router.post("/days/{day_id}/due-payments", status_code=201)
def collect_due(
    shop_id: str, day_id: str, body: DuePayment, identity=Depends(current_identity), db=Depends(get_db)
):
    member, shop = access(db, shop_id, identity, "add_hishob_transactions")
    day = get_day(db, shop_id, day_id)
    key = due_key(body.source_day_id, body.entry_id)
    amount = paise(body.amount)
    original = {"due_key": key, "amount": amount, "payment_method": body.payment_method, "note": body.note}
    existing = next((t for t in day["transactions"] if t["id"] == body.request_id), None)
    if existing:
        if (
            existing["type"] != "DUE_COLLECTION"
            or existing["original"] != original
            or existing["created_by"]["user_id"] != identity.user["_id"]
        ):
            raise HTTPException(409, "This payment reference was already used.")
        return serialize(day)
    check_open(day, body.revision)
    if day["date"] != str(business_today(shop)):
        raise HTTPException(422, "Collect payments in today’s open Hishob, using the actual date of receipt.")
    source = get_day(db, shop_id, body.source_day_id)
    credit = next(
        (
            t
            for t in source["transactions"]
            if t["id"] == body.entry_id and t["type"] == "CREDIT_SALE" and not t["deleted"]
        ),
        None,
    )
    if not credit or source["date"] > day["date"]:
        raise HTTPException(404, "Unpaid sale not found in this shop.")
    receipts = receipts_for(db, shop_id, key)
    remaining = credit["amount"] - sum(t["amount"] for t in receipts)
    if amount <= 0 or amount > remaining:
        raise HTTPException(422, "Enter a payment greater than zero and no more than the remaining due.")
    sequence = len(receipts) + 1
    reserve_receipt(day, key, sequence)
    who = actor(identity, member)
    entry = {
        "id": body.request_id,
        "shop_id": shop_id,
        "hishob_id": day_id,
        "date": day["date"],
        "type": "DUE_COLLECTION",
        "amount": amount,
        "payment_method": body.payment_method,
        "due_key": key,
        "due_date": source["date"],
        "receipt_sequence": sequence,
        "customer_name": credit.get("customer_name", ""),
        "category": "Customer payment",
        "description": f"Payment: {credit.get('customer_name') or credit['description']}",
        "note": body.note,
        "original": original,
        "created_by": who,
        "created_at": now(),
        "updated_at": now(),
        "deleted": False,
    }
    if credit.get("staff_id"):
        entry.update(
            staff_id=credit["staff_id"],
            staff_name=credit.get("staff_name", ""),
            staff_kind="PURCHASE_PAYMENT",
        )
    day["transactions"].append(entry)
    calculate(day)
    audit(day, "COLLECT_DUE", who, None, entry)
    return save(db, day, body.revision)
