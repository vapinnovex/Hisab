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
    settings = request.app.state.settings
    # Use the actual peer address; only trust proxy headers from configured proxies.
    peer = request.client.host if request.client else "unknown"
    limit_requests(db, f"ip:{peer}", 60, 3600)
    limit_requests(db, f"mobile:{body.mobile}", 10, 3600)
    if body.role != "OWNER" and not eligible_staff(db, body.mobile, body.role):
        raise HTTPException(403, NOT_ADDED)
    timestamp = now()
    try:
        db.otp_limits.find_one_and_update(
            {"_id": f"cooldown:{body.mobile}", "next_at": {"$lte": timestamp}},
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
        "mobile": body.mobile,
        "role": body.role.value,
        "code_hash": code_hash(settings.jwt_secret, challenge_id, code),
        "attempts": 0,
        "consumed": False,
        "expires_at": timestamp + timedelta(seconds=settings.otp_expire_seconds),
    }
    db.otp_challenges.insert_one(challenge)
    try:
        request.app.state.otp_provider.send(body.mobile, code)
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
    settings = request.app.state.settings
    peer = request.client.host if request.client else "unknown"
    limit_requests(db, f"verify:{peer}", 120, 3600)
    challenge = db.otp_challenges.find_one_and_update(
        {
            "_id": body.challenge_id,
            "consumed": False,
            "expires_at": {"$gt": now()},
            "attempts": {"$lt": settings.otp_max_attempts},
        },
        {"$inc": {"attempts": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not challenge or not hmac.compare_digest(
        challenge["code_hash"], code_hash(settings.jwt_secret, body.challenge_id, body.code)
    ):
        raise HTTPException(400, "Invalid or expired OTP. Request a new code if needed.")
    if challenge["role"] != "OWNER" and not eligible_staff(db, challenge["mobile"], challenge["role"]):
        raise HTTPException(403, NOT_ADDED)
    claimed = db.otp_challenges.update_one(
        {"_id": body.challenge_id, "consumed": False, "expires_at": {"$gt": now()}},
        {"$set": {"consumed": True}},
    )
    if not claimed.modified_count:
        raise HTTPException(400, "This OTP has already been used")
    user = db.users.find_one_and_update(
        {"mobile": challenge["mobile"]},
        {"$setOnInsert": {"_id": new_id(), "created_at": now()}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    session_id = new_id()
    timestamp = now()
    expiry = timestamp + timedelta(minutes=settings.jwt_expire_minutes)
    db.sessions.insert_one(
        {
            "_id": session_id,
            "user_id": user["_id"],
            "role": challenge["role"],
            "revoked": False,
            "expires_at": expiry,
        }
    )
    token = jwt.encode(
        {
            "sub": user["_id"],
            "portal": challenge["role"],
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
    return {"user": public(identity.user), "role": identity.role, "memberships": memberships}


@router.post("/logout", status_code=204)
def logout(identity=Depends(current_identity), db=Depends(get_db)):
    db.sessions.update_one({"_id": identity.session_id}, {"$set": {"revoked": True}})
