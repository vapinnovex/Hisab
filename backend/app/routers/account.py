"""Owner identity updates preserve user IDs, memberships and attendance."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import get_db, new_id, now, public
from ..password_schemas import EmailChange, MobileChange
from ..passwords import user_view, verify_password
from ..schemas import LanguageUpdate, OTPVerify, OwnerProfileUpdate
from ..security import current_identity, require_owner
from ..web_session import browser_session
from .auth import consume_challenge, create_session, issue_challenge, limit_requests
from .password_auth import version_query

router = APIRouter(prefix="/auth", tags=["Account"])


@router.patch("/profile")
def update_profile(body: OwnerProfileUpdate, identity=Depends(require_owner), db=Depends(get_db)):
    user = db.users.find_one_and_update(
        {"_id": identity.user["_id"]},
        {"$set": {"name": body.name, "updated_at": now()}},
        return_document=ReturnDocument.AFTER,
    )
    return user_view(user)


@router.patch("/language")
def update_language(body: LanguageUpdate, identity=Depends(current_identity), db=Depends(get_db)):
    user = db.users.find_one_and_update(
        {"_id": identity.user["_id"]},
        {"$set": {"language": body.language.value if body.language else None, "updated_at": now()}},
        return_document=ReturnDocument.AFTER,
    )
    return user_view(user)


@router.post("/email-change/request")
def request_email_change(
    body: EmailChange, request: Request, identity=Depends(require_owner), db=Depends(get_db)
):
    limit_requests(db, f"email-change:{identity.user['_id']}", 10, 3600)
    if not verify_password(identity.user.get("password_hash"), body.current_password):
        raise HTTPException(400, "Current password is incorrect.")
    if not identity.user.get("email_verified"):
        raise HTTPException(409, "Set up your recovery email first.")
    email = str(body.email).lower()
    if email == identity.user.get("email"):
        raise HTTPException(409, "Choose a different email address.")
    if db.users.find_one({"email": email, "_id": {"$ne": identity.user["_id"]}}):
        raise HTTPException(409, "Email already belongs to another account.")
    return issue_challenge(
        request,
        db,
        email,
        "CHANGE_EMAIL",
        {
            "user_id": identity.user["_id"],
            "session_id": identity.session_id,
            "auth_version": identity.user.get("auth_version", 0),
            "new_email": email,
        },
    )


@router.post("/email-change/confirm")
def confirm_email_change(
    body: OTPVerify, request: Request, response: Response, identity=Depends(require_owner), db=Depends(get_db)
):
    challenge = consume_challenge(
        body,
        request,
        db,
        "CHANGE_EMAIL",
        {
            "user_id": identity.user["_id"],
            "session_id": identity.session_id,
            "auth_version": identity.user.get("auth_version", 0),
        },
    )
    try:
        user = db.users.find_one_and_update(
            version_query(identity.user),
            {
                "$set": {"email": challenge["new_email"], "email_verified": True, "updated_at": now()},
                "$inc": {"auth_version": 1},
                "$unset": {"session_slots": ""},
            },
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(409, "Email already belongs to another account.")
    if not user:
        raise HTTPException(409, "Your account changed. Start again.")
    db.email_change_history.insert_one(
        {
            "_id": new_id(),
            "challenge_id": challenge["_id"],
            "user_id": user["_id"],
            "previous_email": identity.user.get("email"),
            "new_email": user["email"],
            "changed_at": now(),
        }
    )
    db.sessions.update_many(
        {"user_id": user["_id"], "auth_version": {"$ne": user["auth_version"]}}, {"$set": {"revoked": True}}
    )
    return browser_session(request, response, create_session(request, db, user, "OWNER"))


@router.get("/email-change/history")
def email_change_history(identity=Depends(require_owner), db=Depends(get_db)):
    return [
        public(record)
        for record in db.email_change_history.find({"user_id": identity.user["_id"]}).sort("changed_at", -1)
    ]


@router.post("/mobile-change/request")
def request_change(body: MobileChange, request: Request, identity=Depends(require_owner), db=Depends(get_db)):
    limit_requests(db, f"change:{identity.user['_id']}", 10, 3600)
    if not verify_password(identity.user.get("password_hash"), body.password):
        raise HTTPException(400, "Current password is incorrect.")
    if not identity.user.get("email_verified"):
        raise HTTPException(409, "Set up your recovery email first.")
    if body.mobile == identity.user["mobile"] or db.users.find_one({"mobile": body.mobile}):
        raise HTTPException(409, "Choose a different number that is not already in use.")
    return issue_challenge(
        request,
        db,
        identity.user["email"],
        "CHANGE_MOBILE",
        {
            "user_id": identity.user["_id"],
            "session_id": identity.session_id,
            "auth_version": identity.user.get("auth_version", 0),
            "new_mobile": body.mobile,
        },
    )


@router.post("/mobile-change/confirm")
def confirm_change(
    body: OTPVerify, request: Request, response: Response, identity=Depends(require_owner), db=Depends(get_db)
):
    challenge = consume_challenge(
        body,
        request,
        db,
        "CHANGE_MOBILE",
        {
            "user_id": identity.user["_id"],
            "session_id": identity.session_id,
            "auth_version": identity.user.get("auth_version", 0),
        },
    )
    try:
        user = db.users.find_one_and_update(
            version_query(identity.user),
            {
                "$set": {"mobile": challenge["new_mobile"], "updated_at": now()},
                "$inc": {"auth_version": 1},
                "$unset": {"session_slots": ""},
            },
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(409, "This number already belongs to an account.")
    if not user:
        raise HTTPException(409, "Your account changed. Start again.")
    db.sessions.update_many(
        {"user_id": user["_id"], "auth_version": {"$ne": user["auth_version"]}}, {"$set": {"revoked": True}}
    )
    return browser_session(request, response, create_session(request, db, user, "OWNER"))
