import hmac
import secrets
from datetime import timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import get_db, new_id, now, public
from ..otp import code_hash
from ..schemas import OTPRequest, OTPVerify
from ..security import current_identity
from ..sessions import legacy_session_ids, session_group, session_limit
from ..shop_policy import permissions_for, shop_view

router = APIRouter(prefix="/auth", tags=["Authentication"])
NOT_ADDED = "You haven’t been added to any shop yet. Ask your shop owner to add you."


def eligible_staff(db, mobile, role):
    user = db.users.find_one({"mobile": mobile})
    return user and db.memberships.find_one(
        {
            "user_id": user["_id"],
            "role": {"$in": ["MANAGER", "ADMIN"] if role == "MANAGER" else ["WORKER"]},
            "active": True,
        }
    )


def limit_requests(db, key, limit, seconds):
    timestamp = now()
    bucket = int(timestamp.timestamp()) // seconds
    record = db.otp_limits.find_one_and_update(
        {"_id": f"{key}:{bucket}"},
        {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": timestamp + timedelta(seconds=seconds * 2)}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if record["count"] > limit:
        raise HTTPException(
            429, "Too many attempts. Please try again later.", headers={"Retry-After": str(seconds)}
        )


@router.post("/otp/request")
def request_otp(body: OTPRequest, request: Request, db=Depends(get_db)):
    # Use the actual peer address; only trust proxy headers from configured proxies.
    peer = request.client.host if request.client else "unknown"
    limit_requests(db, f"ip:{peer}", 60, 3600)
    limit_requests(db, f"mobile:{body.mobile}", 10, 3600)
    if body.role != "OWNER" and not eligible_staff(db, body.mobile, body.role):
        raise HTTPException(403, NOT_ADDED)
    user = db.users.find_one({"mobile": body.mobile})
    return issue_challenge(
        request,
        db,
        body.mobile,
        "LOGIN",
        {
            "role": body.role.value,
            "user_id": user["_id"] if user else None,
            "auth_version": user.get("auth_version", 0) if user else 0,
        },
    )


def issue_challenge(request, db, mobile, purpose, metadata):
    settings = request.app.state.settings
    peer = request.client.host if request.client else "unknown"
    limit_requests(db, f"send:{peer}", 60, 3600)
    limit_requests(db, f"send-mobile:{mobile}", 10, 3600)
    timestamp = now()
    try:
        db.otp_limits.find_one_and_update(
            {"_id": f"cooldown:{mobile}", "next_at": {"$lte": timestamp}},
            {
                "$set": {
                    "next_at": timestamp + timedelta(seconds=settings.otp_resend_seconds),
                    "expires_at": timestamp + timedelta(seconds=settings.otp_expire_seconds),
                }
            },
            upsert=True,
        )
    except DuplicateKeyError:
        raise HTTPException(
            429,
            "Please wait before requesting another OTP.",
            headers={"Retry-After": str(settings.otp_resend_seconds)},
        )
    challenge_id = new_id()
    code = settings.dev_otp if settings.otp_provider == "dev" else f"{secrets.randbelow(1000000):06d}"
    challenge = {
        "_id": challenge_id,
        "mobile": mobile,
        "purpose": purpose,
        **metadata,
        "code_hash": code_hash(settings.jwt_secret, challenge_id, code),
        "attempts": 0,
        "consumed": False,
        "expires_at": timestamp + timedelta(seconds=settings.otp_expire_seconds),
    }
    db.otp_challenges.insert_one(challenge)
    try:
        request.app.state.otp_provider.send(mobile, code)
    except Exception:
        db.otp_challenges.delete_one({"_id": challenge_id})
        raise HTTPException(503, "Unable to send OTP. Please try again later.")
    response = {
        "challenge_id": challenge_id,
        "expires_in": settings.otp_expire_seconds,
        "resend_after": settings.otp_resend_seconds,
    }
    if settings.otp_provider == "dev":
        response["dev_otp"] = code
    return response


@router.post("/otp/verify")
def verify_otp(body: OTPVerify, request: Request, db=Depends(get_db)):
    challenge = consume_challenge(body, request, db, "LOGIN")
    existing = db.users.find_one({"mobile": challenge["mobile"]})
    if (existing["_id"] if existing else None) != challenge.get("user_id") or (
        existing and existing.get("auth_version", 0) != challenge.get("auth_version", 0)
    ):
        raise HTTPException(400, "Your account changed. Please request a new OTP.")
    if challenge["role"] != "OWNER" and not eligible_staff(db, challenge["mobile"], challenge["role"]):
        raise HTTPException(403, NOT_ADDED)
    user = existing
    if user is None:
        user = {"_id": new_id(), "mobile": challenge["mobile"], "created_at": now()}
        try:
            db.users.insert_one(user)
        except DuplicateKeyError:
            raise HTTPException(400, "Your account changed. Please request a new OTP.")
    return create_session(request, db, user, challenge["role"])


def create_session(request, db, user, role):
    settings = request.app.state.settings
    session_id = new_id()
    timestamp = now()
    expiry = timestamp + timedelta(minutes=settings.jwt_expire_minutes)
    group = session_group(role)
    limit = session_limit(role)
    legacy = legacy_session_ids(db, user, role) if group not in user.get("session_slots", {}) else []
    known = user.get("session_slots", {}).get(group, legacy)
    live = {
        record["_id"]
        for record in db.sessions.find(
            {
                "_id": {"$in": known},
                "revoked": False,
                "expires_at": {"$gt": timestamp},
            },
            {"_id": 1},
        )
    }
    stale = [key for key in known if key not in live]
    db.sessions.insert_one(
        {
            "_id": session_id,
            "user_id": user["_id"],
            "role": role,
            "auth_version": user.get("auth_version", 0),
            "revoked": False,
            "created_at": timestamp,
            "slot_managed": True,
            "expires_at": expiry,
        }
    )
    # The bounded array is the authority. Concurrent verifications serialize on this
    # single MongoDB document; cleanup order can never reactivate an evicted token.
    field = f"session_slots.{group}"
    previous = db.users.find_one_and_update(
        {
            "_id": user["_id"],
            "$expr": {"$eq": [{"$ifNull": ["$auth_version", 0]}, user.get("auth_version", 0)]},
        },
        [
            {
                "$set": {
                    field: {
                        "$slice": [
                            {
                                "$concatArrays": [
                                    {
                                        "$filter": {
                                            "input": {"$ifNull": [f"${field}", legacy]},
                                            "as": "id",
                                            "cond": {"$not": [{"$in": ["$$id", stale]}]},
                                        }
                                    },
                                    [session_id],
                                ]
                            },
                            -limit,
                        ]
                    }
                }
            }
        ],
        return_document=ReturnDocument.BEFORE,
    )
    if previous is None:
        db.sessions.update_one({"_id": session_id}, {"$set": {"revoked": True}})
        raise HTTPException(401, "Your account changed. Please log in again.")
    old_ids = [key for key in previous.get("session_slots", {}).get(group, legacy) if key not in stale]
    evicted = old_ids[: max(0, len(old_ids) + 1 - limit)]
    if evicted:
        db.sessions.update_many({"_id": {"$in": evicted}}, {"$set": {"revoked": True}})
    token = jwt.encode(
        {
            "sub": user["_id"],
            "portal": role,
            "jti": session_id,
            "iat": timestamp,
            "exp": expiry,
            "aud": "hisab-mobile",
            "iss": "hisab-api",
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    return {"access_token": token, "token_type": "bearer", "expires_at": expiry}


def consume_challenge(body, request, db, purpose, scope=None):
    settings = request.app.state.settings
    peer = request.client.host if request.client else "unknown"
    limit_requests(db, f"verify:{peer}", 120, 3600)
    query = {
        "_id": body.challenge_id,
        "purpose": purpose,
        "consumed": False,
        "expires_at": {"$gt": now()},
        "attempts": {"$lt": settings.otp_max_attempts},
        **(scope or {}),
    }
    challenge = db.otp_challenges.find_one_and_update(
        query,
        {"$inc": {"attempts": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not challenge or not hmac.compare_digest(
        challenge["code_hash"], code_hash(settings.jwt_secret, body.challenge_id, body.code)
    ):
        raise HTTPException(400, "Invalid or expired OTP. Request a new code if needed.")
    claimed = db.otp_challenges.update_one(
        {"_id": body.challenge_id, "consumed": False, "expires_at": {"$gt": now()}},
        {"$set": {"consumed": True}},
    )
    if not claimed.modified_count:
        raise HTTPException(400, "This OTP has already been used")
    return challenge


@router.get("/me")
def me(identity=Depends(current_identity), db=Depends(get_db)):
    roles = ["MANAGER", "ADMIN"] if identity.role == "MANAGER" else [identity.role]
    memberships = []
    for membership in db.memberships.find(
        {"user_id": identity.user["_id"], "active": True, "role": {"$in": roles}}
    ):
        shop = db.shops.find_one({"_id": membership["shop_id"]})
        if shop:
            profile = db.worker_profiles.find_one({"membership_id": membership["_id"]})
            memberships.append(
                {
                    **public(membership),
                    "role": "MANAGER" if membership["role"] == "ADMIN" else membership["role"],
                    "shop": shop_view(shop),
                    "permissions": permissions_for(membership, shop),
                    "worker_name": profile["name"] if profile else membership.get("name"),
                }
            )
    return {
        "user": public({key: value for key, value in identity.user.items() if key != "session_slots"}),
        "role": identity.role,
        "memberships": memberships,
    }


@router.post("/logout", status_code=204)
def logout(identity=Depends(current_identity), db=Depends(get_db)):
    db.sessions.update_one({"_id": identity.session_id}, {"$set": {"revoked": True}})
    db.users.update_one(
        {"_id": identity.user["_id"]},
        {"$pull": {f"session_slots.{session_group(identity.role)}": identity.session_id}},
    )
