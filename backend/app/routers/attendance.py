import calendar
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import get_db, new_id, now, public
from ..schemas import AttendanceStatus, AttendanceUpdate
from ..security import current_identity, shop_access, worker_in_shop
from ..shop_policy import permissions_for, require_permission, settings_for
from .shops import worker_view

router = APIRouter(prefix="/shops/{shop_id}", tags=["Attendance"])


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
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    day = str(shop_today(shop))
    records = {r["worker_id"]: public(r) for r in db.attendance.find({"shop_id": shop_id, "date": day})}
    rows = []
    for member in db.memberships.find({"shop_id": shop_id, "role": "WORKER"}):
        if member["active"] or member["_id"] in records:
            rows.append(
                {
                    "worker": worker_view(db, member),
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
        "timezone": shop["timezone"],
        "rows": rows,
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
    _, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    member = worker_in_shop(db, shop_id, worker_id)
    return history(db, shop, worker_id, month, member["created_at"])


@router.put("/workers/{worker_id}/attendance")
def update_attendance(
    shop_id: str,
    worker_id: str,
    body: AttendanceUpdate,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    require_permission(actor, shop, "manage_attendance")
    member = worker_in_shop(db, shop_id, worker_id)
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
    audit = {"at": now(), "by": identity.user["_id"], "status": body.status.value, "note": body.note}
    # Keep a bounded edit trail in the same atomic document update.
    update = {
        "$set": changes,
        "$setOnInsert": defaults,
        "$push": {"edits": {"$each": [audit], "$slice": -100}},
    }
    try:
        record = db.attendance.find_one_and_update(
            key, update, upsert=True, return_document=ReturnDocument.AFTER
        )
    except DuplicateKeyError:
        record = db.attendance.find_one_and_update(key, update, return_document=ReturnDocument.AFTER)
    return public(record)


@router.get("/me/attendance/today")
def my_today(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    member, shop = shop_access(shop_id, db, identity, {"WORKER"})
    require_permission(member, shop, "view_own_attendance")
    day = str(shop_today(shop))
    record = db.attendance.find_one({"shop_id": shop_id, "worker_id": member["_id"], "date": day})
    active_shift = db.attendance.find_one({"shop_id": shop_id, "worker_id": member["_id"], "is_open": True})
    return {
        "date": day,
        "timezone": shop["timezone"],
        "attendance": public(record) if record else blank(shop_id, member["_id"], day),
        "active_shift": public(active_shift),
        "settings": settings_for(shop),
    }


@router.get("/me/attendance")
def my_history(
    shop_id: str,
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    member, shop = shop_access(shop_id, db, identity, {"WORKER"})
    require_permission(member, shop, "view_own_attendance")
    return history(db, shop, member["_id"], month, member["created_at"])


@router.post("/me/attendance/check-in")
@router.post("/me/attendance/check-out")
def self_marking_disabled(identity=Depends(current_identity)):
    # Keep an explicit rejection for old mobile clients, too.
    raise HTTPException(
        403, "Attendance is recorded by your shop owner or manager. Workers cannot mark attendance."
    )


@router.post("/workers/{worker_id}/attendance/check-in")
def check_in(shop_id: str, worker_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    require_permission(actor, shop, "manage_attendance")
    member = worker_in_shop(db, shop_id, worker_id, active_only=True)
    timestamp = now()
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
    audit = {"at": timestamp, "by": identity.user["_id"], "role": identity.role, "action": "CHECK_IN"}
    try:
        record = db.attendance.find_one_and_update(
            key,
            {
                "$set": {
                    "check_in": timestamp,
                    "status": "PRESENT",
                    "is_open": mode == "CHECK_IN_OUT",
                    "source": identity.role,
                    "updated_at": timestamp,
                    "updated_by": identity.user["_id"],
                    "attendance_mode": mode,
                },
                "$setOnInsert": {"_id": new_id(), "check_out": None, "note": "", "created_at": timestamp},
                "$push": {"edits": {"$each": [audit], "$slice": -100}},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(409, "Attendance is already recorded, or an earlier shift is open.")
    return public(record)


@router.post("/workers/{worker_id}/attendance/check-out")
def check_out(shop_id: str, worker_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    require_permission(actor, shop, "manage_attendance")
    worker_in_shop(db, shop_id, worker_id)
    timestamp = now()
    # Existing open shifts retain their original policy when a shop switches to in-only.
    record = db.attendance.find_one_and_update(
        {
            "shop_id": shop_id,
            "worker_id": worker_id,
            "is_open": True,
            "check_in": {"$ne": None},
            "check_out": None,
        },
        {
            "$set": {
                "check_out": timestamp,
                "is_open": False,
                "updated_at": timestamp,
                "updated_by": identity.user["_id"],
                "source": identity.role,
            },
            "$push": {
                "edits": {
                    "$each": [
                        {
                            "at": timestamp,
                            "by": identity.user["_id"],
                            "role": identity.role,
                            "action": "CHECK_OUT",
                        }
                    ],
                    "$slice": -100,
                }
            },
        },
        return_document=ReturnDocument.AFTER,
    )
    if not record:
        raise HTTPException(409, "No open shift. Check-out is only needed for an in-and-out shift.")
    return public(record)
