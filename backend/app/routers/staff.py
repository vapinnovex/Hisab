"""Private staff history derived from the canonical cashbook; no payroll calculation."""

from datetime import date
from hashlib import sha256
from typing import Optional

from bson import BSON
from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from ..cashbook import calculate, paise
from ..db import get_db, now
from ..dues import due_key, receipts_for
from ..financial_schemas import DuePayment, ReasonInput
from ..security import current_identity, shop_access, staff_in_shop
from ..shop_policy import permissions_for
from ..staff import can_manage, initial_reference, reference_for
from ..staff_schemas import ReferenceUpdate, StaffNote, StaffPayment
from .dues import collect_due
from .hishob import actor, audit, business_today, check_open, get_day, save, serialize
from .shops import worker_view

router = APIRouter(prefix="/shops/{shop_id}/staff", tags=["Staff payment book"])


def access(db, shop_id, staff_id, identity):
    member, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN", "WORKER"})
    target = member if staff_id == "me" else staff_in_shop(db, shop_id, staff_id)
    if target["role"] == "OWNER" or (member["role"] == "WORKER" and target["_id"] != member["_id"]):
        raise HTTPException(403, "You do not have permission to access this staff record.")
    return member, shop, target


def flags(member, shop, target):
    permissions = permissions_for(member, shop)
    manages = can_manage(member, shop, target)
    return {
        "can_view_payments": manages or member["_id"] == target["_id"],
        "can_manage_reference": manages,
        "can_record_payment": manages and permissions["add_hishob_transactions"],
        "can_add_note": member["role"] == "OWNER"
        or (
            member["role"] in {"MANAGER", "ADMIN"}
            and target["role"] == "WORKER"
            and member["user_id"] != target["user_id"]
            and (permissions["edit_workers"] or manages)
        ),
        "can_correct": member["role"] == "OWNER",
    }


def require(flag):
    if not flag:
        raise HTTPException(403, "You do not have permission to access this staff record.")


@router.get("/{staff_id}")
def profile(shop_id: str, staff_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    member, shop, target = access(db, shop_id, staff_id, identity)
    rights = flags(member, shop, target)
    return {
        "worker": worker_view(db, target),
        **rights,
        "reference": reference_for(target) if rights["can_view_payments"] else None,
    }


@router.put("/{staff_id}/reference")
def update_reference(
    shop_id: str, staff_id: str, body: ReferenceUpdate, identity=Depends(current_identity), db=Depends(get_db)
):
    member, shop, target = access(db, shop_id, staff_id, identity)
    require(can_manage(member, shop, target))
    previous = reference_for(target)
    payload = body.model_dump(mode="json", exclude={"revision", "request_id"})
    who = actor(identity, member)
    existing = next((h for h in previous["history"] if h["id"] == body.request_id), None)
    if existing:
        if existing["payload"] != payload or existing["actor"]["user_id"] != who["user_id"]:
            raise HTTPException(409, "This transaction reference was already used.")
        return {"revision": previous["revision"]}
    if body.salary:
        initial_reference(body.salary)
    updated = {
        "revision": previous["revision"] + 1,
        "salary": payload["salary"],
        "history": [
            *previous["history"],
            {
                "id": body.request_id,
                "at": now(),
                "actor": who,
                "payload": payload,
                "previous": previous["salary"],
            },
        ],
    }
    if len(BSON.encode(updated)) > 1_000_000:
        raise HTTPException(409, "This staff record has reached its storage limit. Contact support.")
    query = (
        {"pay_reference.revision": body.revision}
        if "pay_reference" in target
        else {"pay_reference": {"$exists": False}}
    )
    if (
        body.revision != previous["revision"]
        or not db.memberships.update_one(
            {"_id": target["_id"], **query}, {"$set": {"pay_reference": updated}}
        ).modified_count
    ):
        raise HTTPException(409, "This staff record changed. Refresh before saving again.")
    return {"revision": updated["revision"]}


@router.get("/{staff_id}/history")
def history(
    shop_id: str,
    staff_id: str,
    page: int = Query(default=1, ge=1, le=10000),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    member, shop, target = access(db, shop_id, staff_id, identity)
    rights = flags(member, shop, target)
    require(rights["can_view_payments"] or rights["can_add_note"])
    staff = target["_id"]
    # Project only this person's entry. Never return other staff, balances or day audits.
    pipeline = (
        [
            {"$match": {"shop_id": shop_id, "transactions.staff_id": staff}},
            {"$unwind": "$transactions"},
            {"$match": {"transactions.staff_id": staff}},
            {
                "$project": {
                    "_id": 0,
                    "id": "$transactions.id",
                    "day_id": "$_id",
                    "date": 1,
                    "day_revision": "$revision",
                    "day_status": "$status",
                    "kind": "$transactions.staff_kind",
                    "amount": "$transactions.amount",
                    "payment_method": "$transactions.payment_method",
                    "note": "$transactions.note",
                    "created_at": "$transactions.created_at",
                    "actor_name": "$transactions.created_by.name",
                    "deleted": "$transactions.deleted",
                    "cancellation": "$transactions.cancellation",
                }
            },
        ]
        if rights["can_view_payments"]
        else [{"$match": {"_id": {"$exists": False}}}]
    )
    pipeline += [
        {
            "$unionWith": {
                "coll": "staff_notes",
                "pipeline": [
                    {"$match": {"shop_id": shop_id, "staff_id": staff}},
                    {
                        "$project": {
                            "_id": 0,
                            "id": "$_id",
                            "date": 1,
                            "kind": {"$literal": "NOTE"},
                            "note": 1,
                            "created_at": 1,
                            "actor_name": "$actor.name",
                            "deleted": 1,
                            "cancellation": 1,
                        }
                    },
                ],
            }
        },
        {"$sort": {"date": -1, "created_at": -1, "id": -1}},
        {"$skip": (page - 1) * 30},
        {"$limit": 31},
    ]
    records = list(db.hishob_days.aggregate(pipeline, maxTimeMS=10000))
    for entry in records[:30]:
        if entry.get("kind") == "PURCHASE" and not entry["deleted"]:
            receipts = receipts_for(db, shop_id, due_key(entry["day_id"], entry["id"]))
            entry["remaining_amount"] = entry["amount"] - sum(t["amount"] for t in receipts)
    legacy = []
    if page == 1 and rights["can_view_payments"]:
        for entry in target.get("salary", {}).get("entries", []):
            legacy.append(
                {
                    key: entry.get(key)
                    for key in (
                        "id",
                        "date",
                        "kind",
                        "amount",
                        "note",
                        "payment_method",
                        "actor_name",
                        "void",
                    )
                }
            )
    return serialize({"items": records[:30], "has_more": len(records) > 30, "legacy": legacy})


@router.get("/{staff_id}/day")
def payment_day(
    shop_id: str,
    staff_id: str,
    for_date: Optional[date] = None,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    member, shop, target = access(db, shop_id, staff_id, identity)
    require(flags(member, shop, target)["can_record_payment"])
    day = db.hishob_days.find_one({"shop_id": shop_id, "date": str(for_date or business_today(shop))})
    return {
        "day": {"id": day["_id"], "revision": day["revision"], "status": day["status"], "date": day["date"]}
        if day
        else None
    }


@router.post("/{staff_id}/payments", status_code=201)
def add_payment(
    shop_id: str, staff_id: str, body: StaffPayment, identity=Depends(current_identity), db=Depends(get_db)
):
    member, shop, target = access(db, shop_id, staff_id, identity)
    require(flags(member, shop, target)["can_record_payment"])
    day = get_day(db, shop_id, body.day_id)
    amount = paise(body.amount)
    if amount <= 0:
        raise HTTPException(422, "Enter an amount greater than zero.")
    if body.kind == "PURCHASE" and body.payment_method != "CASH":
        raise HTTPException(422, "An unpaid purchase has no payment method. Leave it as cash.")
    values = body.model_dump(exclude={"revision", "request_id"})
    values["staff_id"] = target["_id"]
    # A unique key across day documents also guards an uncertain save retried on another day.
    key = sha256(f"{shop_id}:{body.request_id}".encode()).hexdigest()
    recorded = db.hishob_days.find_one({"shop_id": shop_id, "staff_request_keys": key})
    if recorded:
        entry = next(t for t in recorded["transactions"] if t.get("staff_request_key") == key)
        if entry["original"] != values or entry["created_by"]["user_id"] != identity.user["_id"]:
            raise HTTPException(409, "This transaction reference was already used.")
        return {"id": entry["id"], "day_id": recorded["_id"]}
    if any(t["id"] == body.request_id for t in day["transactions"]):
        raise HTTPException(409, "This transaction reference was already used.")
    check_open(day, body.revision)
    if day["date"] > str(business_today(shop)):
        raise HTTPException(422, "Choose a date between shop creation and today.")
    name = worker_view(db, target)["name"]
    entry = {
        "id": body.request_id,
        "shop_id": shop_id,
        "hishob_id": day["_id"],
        "date": day["date"],
        "type": "CREDIT_SALE"
        if body.kind == "PURCHASE"
        else "OTHER_CASH_IN"
        if body.kind == "RECEIVED"
        else "EXPENSE",
        "amount": amount,
        "payment_method": body.payment_method,
        "staff_id": target["_id"],
        "staff_name": name,
        "staff_kind": body.kind,
        "staff_request_key": key,
        "customer_name": name if body.kind == "PURCHASE" else "",
        "category": "Staff payment",
        "description": f"{name}: {body.note}",
        "note": body.note,
        "original": values,
        "created_by": actor(identity, member),
        "created_at": now(),
        "updated_at": now(),
        "deleted": False,
    }
    day["transactions"].append(entry)
    day.setdefault("staff_request_keys", []).append(key)
    calculate(day)
    audit(day, "ADD_TRANSACTION", actor(identity, member), None, entry)
    save(db, day, body.revision)
    return {"id": entry["id"], "day_id": day["_id"]}


@router.post("/{staff_id}/notes", status_code=201)
def add_note(
    shop_id: str, staff_id: str, body: StaffNote, identity=Depends(current_identity), db=Depends(get_db)
):
    member, shop, target = access(db, shop_id, staff_id, identity)
    require(flags(member, shop, target)["can_add_note"])
    if body.date > business_today(shop) or body.date.year < 2000:
        raise HTTPException(422, "Choose a note date between 2000 and today.")
    key = sha256(f"{shop_id}:{target['_id']}:{body.request_id}".encode()).hexdigest()
    document = {
        "_id": key,
        "shop_id": shop_id,
        "staff_id": target["_id"],
        "date": str(body.date),
        "note": body.note,
        "actor": actor(identity, member),
        "created_at": now(),
        "deleted": False,
    }
    try:
        db.staff_notes.insert_one(document)
    except DuplicateKeyError:
        previous = db.staff_notes.find_one({"_id": key})
        if (previous["date"], previous["note"], previous["actor"]["user_id"]) != (
            document["date"],
            document["note"],
            identity.user["_id"],
        ):
            raise HTTPException(409, "This transaction reference was already used.")
    return {"id": key}


@router.post("/{staff_id}/notes/{note_id}/cancel")
def cancel_note(
    shop_id: str,
    staff_id: str,
    note_id: str,
    body: ReasonInput,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    member, shop, target = access(db, shop_id, staff_id, identity)
    require(flags(member, shop, target)["can_correct"])
    query = {"_id": note_id, "shop_id": shop_id, "staff_id": target["_id"]}
    note = db.staff_notes.find_one(query)
    if not note:
        raise HTTPException(404, "Staff note not found.")
    db.staff_notes.update_one(
        {**query, "deleted": False},
        {
            "$set": {
                "deleted": True,
                "cancellation": {"actor": actor(identity, member), "at": now(), "reason": body.reason},
            }
        },
    )
    return {"id": note_id}


@router.post("/{staff_id}/days/{day_id}/purchase-payments", status_code=201)
def purchase_payment(
    shop_id: str,
    staff_id: str,
    day_id: str,
    body: DuePayment,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    member, shop, target = access(db, shop_id, staff_id, identity)
    require(flags(member, shop, target)["can_record_payment"])
    source = get_day(db, shop_id, body.source_day_id)
    require(
        any(
            t["id"] == body.entry_id and t.get("staff_id") == target["_id"] and t["type"] == "CREDIT_SALE"
            for t in source["transactions"]
        )
    )
    collect_due(shop_id, day_id, body, identity, db)
    return {"id": body.request_id, "day_id": day_id}


@router.get("/{staff_id}/receipts/{request_id}")
def saved_receipt(
    shop_id: str, staff_id: str, request_id: str, identity=Depends(current_identity), db=Depends(get_db)
):
    member, shop, target = access(db, shop_id, staff_id, identity)
    rights = flags(member, shop, target)
    require(rights["can_view_payments"] or rights["can_add_note"])
    staff = target["_id"]
    payment = rights["can_view_payments"] and db.hishob_days.find_one(
        {"shop_id": shop_id, "transactions": {"$elemMatch": {"staff_id": staff, "id": request_id}}},
        {"_id": 1},
    )
    key = sha256(f"{shop_id}:{staff}:{request_id}".encode()).hexdigest()
    note = db.staff_notes.find_one({"_id": key, "shop_id": shop_id, "staff_id": staff}, {"_id": 1})
    return {"saved": bool(payment or note)}
