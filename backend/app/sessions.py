"""Atomic per-account login limits, independent of shop membership."""

from .db import now


def session_group(role):
    return "owner" if role == "OWNER" else "staff"


def session_limit(role):
    return 3 if role == "OWNER" else 1


def legacy_session_ids(db, user, role):
    roles = ["OWNER"] if role == "OWNER" else ["MANAGER", "WORKER"]
    query = {
        "user_id": user["_id"],
        "role": {"$in": roles},
        "revoked": False,
        "slot_managed": {"$ne": True},
        "expires_at": {"$gt": now()},
        "auth_version": user.get("auth_version", 0),
    }
    if not user.get("auth_version", 0):
        query.pop("auth_version")
        query["$or"] = [{"auth_version": 0}, {"auth_version": {"$exists": False}}]
    # Old sessions predate created_at; expiry tracks their issuance order.
    records = db.sessions.find(query).sort([("expires_at", -1), ("_id", -1)]).limit(session_limit(role))
    return list(reversed([record["_id"] for record in records]))
