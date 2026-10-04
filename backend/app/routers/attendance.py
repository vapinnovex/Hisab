import calendar
import re
from datetime import date, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import get_db, new_id, now, public
from ..schemas import AttendanceStatus, AttendanceUpdate
from ..security import current_identity, shop_access, staff_in_shop
from ..shop_policy import (
    attendance_permissions,
    permissions_for,
    require_attendance_enabled,
    require_attendance_permission,
    require_permission,
    settings_for,
)
from .shops import worker_view


def attendance_access(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    _, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN", "WORKER"})
    require_attendance_enabled(shop)


router = APIRouter(prefix="/shops/{shop_id}", tags=["Attendance"], dependencies=[Depends(attendance_access)])


def audited_update(db, shop, member, update):
    """Pipeline captures the real pre-update state, even with concurrent writers.

    Events live in the same atomic document as attendance and station receipts.
    Never truncate history. Mongo rejects an oversized write without losing either.
    """
    event = update["$push"]["edits"]["$each"][0]
    actor = db.memberships.find_one({"shop_id": shop["_id"], "user_id": event["by"]})
    actor_user = db.users.find_one({"_id": event["by"]}, {"name": 1}) if event["role"] != "FACE" else None
    person = worker_view(db, member)
    event = {
        **event,
        "id": new_id(),
        "employee_name": person["name"],
        "employee_mobile": person.get("mobile", ""),
        "actor_name": (actor or {}).get("name")
        or (actor_user or {}).get("name")
        or ("Face station" if event["role"] == "FACE" else event["role"]),
    }
    fields = ("status", "check_in", "check_out", "is_open", "source", "note")
    snapshot = {field: {"$ifNull": [f"${field}", None]} for field in fields}
    stages = [{"$set": {"_audit_before": snapshot}}]
    defaults = {
        field: {"$cond": [{"$eq": [{"$type": f"${field}"}, "missing"]}, {"$literal": value}, f"${field}"]}
        for field, value in update.get("$setOnInsert", {}).items()
    }
    if defaults:
        stages.append({"$set": defaults})
    stages.append({"$set": {key: {"$literal": value} for key, value in update["$set"].items()}})
    appended = {
        "edits": {
            "$concatArrays": [
                {"$ifNull": ["$edits", []]},
                [{"$mergeObjects": [{"$literal": event}, {"before": "$_audit_before", "after": snapshot}]}],
            ]
        }
    }
    if "face_receipts" in update["$push"]:
        appended["face_receipts"] = {
            "$concatArrays": [
                {"$ifNull": ["$face_receipts", []]},
                {"$literal": [update["$push"]["face_receipts"]]},
            ]
        }
    return [*stages, {"$set": appended}, {"$unset": "_audit_before"}]


@router.get("/attendance/activity")
def attendance_activity(
    shop_id: str,
    q: str = Query(default="", max_length=100),
    start: Optional[date] = None,
    end: Optional[date] = None,
    source: str = Query(default="ALL", pattern="^(ALL|FACE|MANUAL)$"),
    offset: int = Query(default=0, ge=0, le=100000),
    limit: int = Query(default=30, ge=1, le=100),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    _, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    if start and end and start > end:
        raise HTTPException(422, "Start date must not be after end date")
    match = {"shop_id": shop_id}
    if start or end:
        match["date"] = {**({"$gte": str(start)} if start else {}), **({"$lte": str(end)} if end else {})}
    pipeline = [{"$match": match}, {"$unwind": {"path": "$edits", "includeArrayIndex": "event_index"}}]
    filters = {}
    if source != "ALL":
        filters["edits.role"] = "FACE" if source == "FACE" else {"$ne": "FACE"}
    if q.strip():
        regex = {"$regex": re.escape(q.strip()), "$options": "i"}
        members = list(db.memberships.find({"shop_id": shop_id}))
        staff_ids = [m["_id"] for m in members]
        profiles = list(db.worker_profiles.find({"membership_id": {"$in": staff_ids}, "name": regex}))
        users = list(
            db.users.find(
                {"_id": {"$in": [m["user_id"] for m in members]}, "$or": [{"mobile": regex}, {"name": regex}]}
            )
        )
        user_ids = [u["_id"] for u in users]
        matching = [
            m
            for m in members
            if re.search(re.escape(q.strip()), m.get("name", ""), re.I)
            or m["user_id"] in user_ids
            or m["_id"] in [p["membership_id"] for p in profiles]
        ]
        filters["$or"] = [
            {"worker_id": {"$in": [m["_id"] for m in matching]}},
            {"edits.by": {"$in": [m["user_id"] for m in matching]}},
        ] + [
            {field: regex}
            for field in [
                "date",
                "worker_id",
                "edits.employee_name",
                "edits.employee_mobile",
                "edits.actor_name",
                "edits.by",
                "edits.role",
                "edits.action",
                "edits.status",
                "edits.note",
                "edits.device_id",
                "edits.after.status",
                "edits.after.note",
            ]
        ]
    if filters:
        pipeline.append({"$match": filters})
    pipeline.extend(
        [
            {"$sort": {"edits.at": -1, "_id": -1, "event_index": -1}},
            {"$skip": offset},
            {"$limit": limit + 1},
            {"$project": {"worker_id": 1, "date": 1, "edits": 1, "event_index": 1}},
        ]
    )
    records = list(db.attendance.aggregate(pipeline))
    names = {}
    events = []
    for record in records[:limit]:
        worker_id = record["worker_id"]
        if worker_id not in names:
            member = db.memberships.find_one({"_id": worker_id, "shop_id": shop_id})
            names[worker_id] = worker_view(db, member)["name"] if member else "Former employee"
        event = record["edits"]
        events.append(
            {
                **event,
                "id": event.get("id", f"{record['_id']}:{record['event_index']}"),
                "worker_id": worker_id,
                "employee_name": event.get("employee_name", names[worker_id]),
                "date": record["date"],
                "action": event.get("action", "CORRECTION"),
                "legacy": "before" not in event,
            }
        )
    return {"events": events, "has_more": len(records) > limit, "timezone": shop["timezone"]}


def shop_today(shop):
    return now().astimezone(ZoneInfo(shop["timezone"])).date()


def blank(shop_id, worker_id, day):
    return {
        "id": None,
        "shop_id": shop_id,
        "worker_id": worker_id,
        "date": str(day),
        "status": "NOT_MARKED",
        "check_in": None,
        "check_out": None,
        "is_open": False,
        "source": None,
        "note": "",
    }


def history(db, shop, worker_id, month, joined):
    try:
        start = date.fromisoformat(f"{month}-01")
    except ValueError:
        raise HTTPException(422, "Month must be YYYY-MM")
    end = start + timedelta(days=calendar.monthrange(start.year, start.month)[1] - 1)
    records = {
        r["date"]: public(r)
        for r in db.attendance.find(
            {
                "shop_id": shop["_id"],
                "worker_id": worker_id,
                "date": {"$gte": str(start), "$lte": str(end)},
            }
        )
    }
    first = max(start, joined.astimezone(ZoneInfo(shop["timezone"])).date())
    last = min(end, shop_today(shop))
    days = []
    while first <= last:
        days.append(records.get(str(first), blank(shop["_id"], worker_id, first)))
        first += timedelta(days=1)
    return {
        "month": month,
        "timezone": shop["timezone"],
        "days": days,
        "today": str(shop_today(shop)),
        "joined_on": str(joined.astimezone(ZoneInfo(shop["timezone"])).date()),
        "summary": {
            status.value: sum(day["status"] == status.value for day in days) for status in AttendanceStatus
        },
    }


@router.get("/attendance/today")
def today_attendance(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    return register_for_date(shop_id, None, identity, db)


@router.get("/attendance/register")
def attendance_register(
    shop_id: str,
    day: date = Query(),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    return register_for_date(shop_id, day, identity, db)


def register_for_date(shop_id, requested_day, identity, db):
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    today = shop_today(shop)
    selected_day = requested_day or today
    if selected_day > today:
        raise HTTPException(422, "Attendance cannot be viewed for a future date")
    day = str(selected_day)
    records = {r["worker_id"]: public(r) for r in db.attendance.find({"shop_id": shop_id, "date": day})}
    rows = []
    for member in db.memberships.find({"shop_id": shop_id, "role": {"$in": ["WORKER", "MANAGER", "ADMIN"]}}):
        joined = member["created_at"].astimezone(ZoneInfo(shop["timezone"])).date()
        if (member["active"] and joined <= selected_day) or member["_id"] in records:
            rows.append(
                {
                    "worker": worker_view(db, member),
                    **attendance_permissions(actor, shop, member),
                    "can_mark": selected_day == today
                    and attendance_permissions(actor, shop, member)["can_mark"],
                    "active_shift": public(
                        db.attendance.find_one(
                            {"shop_id": shop_id, "worker_id": member["_id"], "is_open": True}
                        )
                    ),
                    "attendance": records.get(member["_id"], blank(shop_id, member["_id"], day)),
                }
            )
    return {
        "date": day,
        "today": str(today),
        "timezone": shop["timezone"],
        "rows": rows,
        "face_attendance_enabled": shop.get("face_attendance_enabled", False),
        "settings": settings_for(shop),
        "permissions": permissions_for(actor, shop),
    }


@router.get("/workers/{worker_id}/attendance")
def worker_history(
    shop_id: str,
    worker_id: str,
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    member = staff_in_shop(db, shop_id, worker_id)
    return {
        **history(db, shop, worker_id, month, member["created_at"]),
        **attendance_permissions(actor, shop, member),
    }


@router.put("/workers/{worker_id}/attendance")
def update_attendance(
    shop_id: str,
    worker_id: str,
    body: AttendanceUpdate,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    member = staff_in_shop(db, shop_id, worker_id)
    require_attendance_permission(actor, shop, member, "can_edit")
    joined = member["created_at"].astimezone(ZoneInfo(shop["timezone"])).date()
    if body.date > shop_today(shop) or body.date < joined:
        raise HTTPException(422, "Attendance date must be between the worker’s join date and today")
    key = {"shop_id": shop_id, "worker_id": worker_id, "date": str(body.date)}
    reset = body.status == "NOT_MARKED"
    changes = {
        "status": body.status.value,
        "note": body.note,
        "source": identity.role,
        "updated_at": now(),
        "updated_by": identity.user["_id"],
        "is_open": False,
    }
    defaults = {
        "_id": new_id(),
        "created_at": now(),
        "attendance_mode": settings_for(shop)["attendance_mode"],
    }
    if reset:
        changes.update(check_in=None, check_out=None)
    else:
        defaults.update(check_in=None, check_out=None)
    audit = {
        "at": now(),
        "by": identity.user["_id"],
        "role": identity.role,
        "action": "CORRECTION",
        "status": body.status.value,
        "note": body.note,
    }
    # The event and both snapshots commit atomically with the attendance change.
    update = {
        "$set": changes,
        "$setOnInsert": defaults,
        "$push": {"edits": {"$each": [audit]}},
    }
    update = audited_update(db, shop, member, update)
    try:
        record = db.attendance.find_one_and_update(
            key, update, upsert=True, return_document=ReturnDocument.AFTER
        )
    except DuplicateKeyError:
        record = db.attendance.find_one_and_update(key, update, return_document=ReturnDocument.AFTER)
    return public(record)


@router.get("/me/attendance/today")
def my_today(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    member, shop = shop_access(shop_id, db, identity, {"WORKER", "MANAGER", "ADMIN"})
    require_permission(member, shop, "view_own_attendance")
    day = str(shop_today(shop))
    record = db.attendance.find_one({"shop_id": shop_id, "worker_id": member["_id"], "date": day})
    active_shift = db.attendance.find_one({"shop_id": shop_id, "worker_id": member["_id"], "is_open": True})
    return {
        "date": day,
        "timezone": shop["timezone"],
        "attendance": public(record) if record else blank(shop_id, member["_id"], day),
        "active_shift": public(active_shift),
        "permissions": permissions_for(member, shop),
        "face_attendance_enabled": shop.get("face_attendance_enabled", False),
        "settings": settings_for(shop),
    }


@router.get("/me/attendance")
def my_history(
    shop_id: str,
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    member, shop = shop_access(shop_id, db, identity, {"WORKER", "MANAGER", "ADMIN"})
    require_permission(member, shop, "view_own_attendance")
    return history(db, shop, member["_id"], month, member["created_at"])


@router.post("/me/attendance/check-in")
def my_check_in(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    member, shop = shop_access(shop_id, db, identity, {"MANAGER", "ADMIN"})
    require_permission(member, shop, "mark_own_attendance")
    return check_in(shop_id, member["_id"], identity, db)


@router.post("/me/attendance/check-out")
def my_check_out(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    member, shop = shop_access(shop_id, db, identity, {"MANAGER", "ADMIN"})
    require_permission(member, shop, "mark_own_attendance")
    return check_out(shop_id, member["_id"], identity, db)


@router.post("/workers/{worker_id}/attendance/check-in")
def check_in(shop_id: str, worker_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    member = staff_in_shop(db, shop_id, worker_id, active_only=True)
    require_attendance_permission(actor, shop, member, "can_mark")
    return record_arrival(db, shop, member, identity.user["_id"], identity.role)


def record_arrival(db, shop, member, actor_id, source, receipt=None):
    shop_id, worker_id = shop["_id"], member["_id"]
    timestamp = now()
    if receipt:
        # BSON dates retain milliseconds; return exactly the time that will be stored.
        timestamp = timestamp.replace(microsecond=(timestamp.microsecond // 1000) * 1000)
        receipt["result"]["recorded_at"] = timestamp.isoformat()
    mode = settings_for(shop)["attendance_mode"]
    if db.attendance.find_one({"shop_id": shop_id, "worker_id": worker_id, "is_open": True}):
        raise HTTPException(409, "An earlier shift is still open. Record its check-out first.")
    key = {
        "shop_id": shop_id,
        "worker_id": member["_id"],
        "date": str(timestamp.astimezone(ZoneInfo(shop["timezone"])).date()),
        "check_in": None,
        "status": "NOT_MARKED",
    }
    if receipt:
        key["face_receipts.request_id"] = {"$ne": receipt["request_id"]}
    audit = {"at": timestamp, "by": actor_id, "role": source, "action": "CHECK_IN"}
    if receipt:
        audit.update(device_id=receipt["device_id"], request_id=receipt["request_id"])
    try:
        record = db.attendance.find_one_and_update(
            key,
            audited_update(
                db,
                shop,
                member,
                {
                    "$set": {
                        "check_in": timestamp,
                        "status": "PRESENT",
                        "is_open": mode == "CHECK_IN_OUT",
                        "source": source,
                        "updated_at": timestamp,
                        "updated_by": actor_id,
                        "attendance_mode": mode,
                    },
                    "$setOnInsert": {"_id": new_id(), "check_out": None, "note": "", "created_at": timestamp},
                    "$push": {
                        "edits": {"$each": [audit]},
                        **({"face_receipts": receipt} if receipt else {}),
                    },
                },
            ),
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(409, "Attendance is already recorded, or an earlier shift is open.")
    return public(record)


@router.post("/workers/{worker_id}/attendance/check-out")
def check_out(shop_id: str, worker_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    member = staff_in_shop(db, shop_id, worker_id)
    require_attendance_permission(actor, shop, member, "can_mark")
    return record_departure(db, shop, member, identity.user["_id"], identity.role)


def record_departure(db, shop, member, actor_id, source, receipt=None):
    shop_id, worker_id = shop["_id"], member["_id"]
    timestamp = now()
    if receipt:
        # BSON dates retain milliseconds; return exactly the time that will be stored.
        timestamp = timestamp.replace(microsecond=(timestamp.microsecond // 1000) * 1000)
        receipt["result"]["recorded_at"] = timestamp.isoformat()
    # Existing open shifts retain their original policy when a shop switches to in-only.
    record = db.attendance.find_one_and_update(
        {
            "shop_id": shop_id,
            "worker_id": worker_id,
            "is_open": True,
            "check_in": {"$ne": None},
            "check_out": None,
            **({"face_receipts.request_id": {"$ne": receipt["request_id"]}} if receipt else {}),
        },
        audited_update(
            db,
            shop,
            member,
            {
                "$set": {
                    "check_out": timestamp,
                    "is_open": False,
                    "updated_at": timestamp,
                    "updated_by": actor_id,
                    "source": source,
                },
                "$push": {
                    "edits": {
                        "$each": [
                            {
                                "at": timestamp,
                                "by": actor_id,
                                "role": source,
                                "action": "CHECK_OUT",
                                **(
                                    {"device_id": receipt["device_id"], "request_id": receipt["request_id"]}
                                    if receipt
                                    else {}
                                ),
                            }
                        ],
                    },
                    **({"face_receipts": receipt} if receipt else {}),
                },
            },
        ),
        return_document=ReturnDocument.AFTER,
    )
    if not record:
        raise HTTPException(409, "No open shift. Check-out is only needed for an in-and-out shift.")
    return public(record)
