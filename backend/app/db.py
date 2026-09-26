from datetime import datetime, timezone
from uuid import uuid4

from fastapi import Request
from pymongo import ASCENDING


def now():
    return datetime.now(timezone.utc)


def new_id():
    return str(uuid4())


def public(document):
    if document is None:
        return None
    return {("id" if key == "_id" else key): value for key, value in document.items()}


def get_db(request: Request):
    return request.app.state.db


def create_indexes(db):
    db.hishob_days.create_index([("shop_id", 1), ("date", 1)], unique=True)
    db.hishob_days.create_index([("shop_id", 1), ("status", 1), ("date", -1)])
    db.users.create_index("mobile", unique=True)
    db.users.create_index("email", unique=True, partialFilterExpression={"email": {"$type": "string"}})
    db.shops.create_index("created_by")
    db.memberships.create_index(
        [("shop_id", ASCENDING), ("user_id", ASCENDING), ("role", ASCENDING)], unique=True
    )
    db.memberships.create_index([("user_id", ASCENDING), ("active", ASCENDING)])
    db.memberships.create_index([("shop_id", ASCENDING), ("role", ASCENDING), ("active", ASCENDING)])
    db.worker_profiles.create_index("membership_id", unique=True)
    db.attendance.create_index(
        [("shop_id", ASCENDING), ("worker_id", ASCENDING), ("date", ASCENDING)], unique=True
    )
    # One open shift per worker, including overnight shifts.
    db.attendance.create_index(
        [("shop_id", ASCENDING), ("worker_id", ASCENDING)],
        unique=True,
        partialFilterExpression={"is_open": True},
        name="one_open_shift",
    )
    db.attendance.create_index([("shop_id", ASCENDING), ("date", ASCENDING)])
    db.otp_challenges.create_index("expires_at", expireAfterSeconds=0)
    db.otp_limits.create_index("expires_at", expireAfterSeconds=0)
    db.sessions.create_index("expires_at", expireAfterSeconds=0)
    db.sessions.create_index([("user_id", 1), ("role", 1), ("revoked", 1), ("expires_at", -1)])
