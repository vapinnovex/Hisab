"""Owner identity updates preserve user IDs, memberships and attendance."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import get_db, now, public
from ..schemas import MobileInput, OTPVerify, OwnerProfileUpdate
from ..security import require_owner
from .auth import consume_challenge, create_session, issue_challenge, limit_requests

router = APIRouter(prefix="/auth", tags=["Account"])


@router.patch("/profile")
def update_profile(body: OwnerProfileUpdate, identity=Depends(require_owner), db=Depends(get_db)):
    user = db.users.find_one_and_update(
        {"_id": identity.user["_id"]},
        {"$set": {"name": body.name, "updated_at": now()}},
        return_document=ReturnDocument.AFTER,
    )
    return public({key: value for key, value in user.items() if key != "session_slots"})


def scope(identity):
    return {
        "user_id": identity.user["_id"],
        "session_id": identity.session_id,
        "old_mobile": identity.user["mobile"],
        "auth_version": identity.user.get("auth_version", 0),
    }


def available(db, mobile):
    if db.users.find_one({"mobile": mobile}):
        raise HTTPException(409, "This number already belongs to an account. Choose another number.")


@router.post("/mobile-change/request")
def request_change(body: MobileInput, request: Request, identity=Depends(require_owner), db=Depends(get_db)):
    limit_requests(db, f"change:{identity.user['_id']}", 10, 3600)
    if body.mobile == identity.user["mobile"]:
        raise HTTPException(422, "Enter a different mobile number.")
    available(db, body.mobile)
    return issue_challenge(
        request,
        db,
        identity.user["mobile"],
        "CHANGE_CURRENT",
        {
            **scope(identity),
            "new_mobile": body.mobile,
        },
    )


@router.post("/mobile-change/verify-current")
def verify_current(body: OTPVerify, request: Request, identity=Depends(require_owner), db=Depends(get_db)):
    challenge = consume_challenge(body, request, db, "CHANGE_CURRENT", scope(identity))
    available(db, challenge["new_mobile"])
    return issue_challenge(
        request,
        db,
        challenge["new_mobile"],
        "CHANGE_NEW",
        {
            **scope(identity),
            "new_mobile": challenge["new_mobile"],
        },
    )


@router.post("/mobile-change/confirm")
def confirm_change(body: OTPVerify, request: Request, identity=Depends(require_owner), db=Depends(get_db)):
    challenge = consume_challenge(body, request, db, "CHANGE_NEW", scope(identity))
    try:
        # One atomic identity change. Version checks invalidate concurrent/older sessions.
        user = db.users.find_one_and_update(
            {
                "_id": identity.user["_id"],
                "mobile": challenge["old_mobile"],
                "$expr": {"$eq": [{"$ifNull": ["$auth_version", 0]}, challenge["auth_version"]]},
            },
            {"$set": {"mobile": challenge["new_mobile"], "updated_at": now()}, "$inc": {"auth_version": 1}},
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(409, "This number already belongs to an account. Choose another number.")
    if not user:
        raise HTTPException(409, "Your account changed. Please start again.")
    db.sessions.update_many({"user_id": user["_id"]}, {"$set": {"revoked": True}})
    return create_session(request, db, user, "OWNER")
