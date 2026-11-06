"""Password login, verified owner email recovery and shop-authorised staff setup."""

import hmac
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import get_db, new_id, now
from ..i18n import message
from ..otp import code_hash
from ..password_schemas import (
    EmailInput,
    EmailPassword,
    LoginInput,
    PasswordChange,
    RegisterInput,
    StaffPassword,
)
from ..passwords import hash_password, validate_password, verify_password
from ..schemas import OTPRequest
from ..security import current_identity, shop_access, staff_in_shop
from ..shop_policy import permissions_for
from ..web_session import browser_session
from .auth import (
    NOT_ADDED,
    consume_challenge,
    create_session,
    eligible_staff,
    issue_challenge,
    limit_requests,
)

router = APIRouter(tags=["Password authentication"])


def is_owner(db, user):
    return bool(
        user
        and (
            user.get("owner_registered")
            or db.memberships.find_one({"user_id": user["_id"], "role": "OWNER"})
            or db.sessions.find_one({"user_id": user["_id"], "role": "OWNER"})
        )
    )


def throttle(request, db, key, limit=20):
    peer = request.client.host if request.client else "unknown"
    limit_requests(db, f"password-ip:{peer}", 240, 3600)
    limit_requests(db, f"password:{key}", limit, 900)


def version_query(user):
    return {
        "_id": user["_id"],
        "$expr": {"$eq": [{"$ifNull": ["$auth_version", 0]}, user.get("auth_version", 0)]},
    }


def replace_password(db, user, body, extra=None, condition=None):
    validate_password(body.password, body.confirm_password, user["mobile"], user.get("email", ""))
    updated = db.users.find_one_and_update(
        {**version_query(user), **(condition or {})},
        {
            "$set": {
                "password_hash": hash_password(body.password),
                "password_reset_required": False,
                "updated_at": now(),
                **(extra or {}),
            },
            "$inc": {"auth_version": 1},
            "$unset": {"password_setup": "", "password_reset_requested_at": "", "session_slots": ""},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(409, "Your account changed. Start again.")
    # Versioning is authoritative; do not revoke sessions issued for the new version concurrently.
    db.sessions.update_many(
        {"user_id": user["_id"], "auth_version": {"$ne": updated["auth_version"]}},
        {"$set": {"revoked": True}},
    )
    return updated


@router.post("/auth/password/options")
def options(body: OTPRequest, request: Request, db=Depends(get_db)):
    throttle(request, db, "options:" + body.mobile, 60)
    user = db.users.find_one({"mobile": body.mobile})
    if body.role != "OWNER" and not eligible_staff(db, body.mobile, body.role):
        if body.role == "WORKER" and db.memberships.find_one(
            {
                "contact_mobile": body.mobile,
                "active": True,
                "login_invite.expires_at": {"$gt": now()},
                "user_id": None,
            }
        ):
            return {"step": "SETUP"}
        raise HTTPException(403, NOT_ADDED)
    owner = is_owner(db, user)
    if body.role == "OWNER" and not user:
        return {"step": "REGISTER"}
    if body.role == "OWNER" and not owner:
        raise HTTPException(403, "This number belongs to a team account. Sign in with your team role.")
    if user.get("password_hash") and not user.get("password_reset_required"):
        return {"step": "PASSWORD"}
    if owner:
        return {"step": "OWNER_RECOVERY" if user.get("email") else "OWNER_MIGRATION"}
    return {"step": "SETUP"}


@router.post("/auth/password/login")
def login(body: LoginInput, request: Request, response: Response, db=Depends(get_db)):
    throttle(request, db, body.mobile)
    user = db.users.find_one({"mobile": body.mobile})
    valid = verify_password(user.get("password_hash") if user else None, body.password)
    if not valid or user.get("password_reset_required"):
        raise HTTPException(401, "Incorrect mobile number or password, or password setup is required.")
    if body.role == "OWNER":
        if not is_owner(db, user):
            raise HTTPException(403, "Owner account required.")
    elif not eligible_staff(db, body.mobile, body.role):
        raise HTTPException(403, NOT_ADDED)
    return browser_session(request, response, create_session(request, db, user, body.role.value))


@router.post("/auth/owner/register/request")
def register_request(body: RegisterInput, request: Request, db=Depends(get_db)):
    if body.role != "OWNER":
        raise HTTPException(403, NOT_ADDED)
    email = str(body.email).lower()
    throttle(request, db, "register:" + body.mobile)
    if db.users.find_one({"$or": [{"mobile": body.mobile}, {"email": email}]}):
        raise HTTPException(409, "An account already uses these details. Sign in or recover your password.")
    return issue_challenge(
        request,
        db,
        email,
        "OWNER_REGISTER",
        {"target_mobile": body.mobile, "name": body.name, "language": body.language.value},
    )


@router.post("/auth/owner/register/confirm")
def register_confirm(body: EmailPassword, request: Request, response: Response, db=Depends(get_db)):
    validate_password(body.password, body.confirm_password)
    challenge = consume_challenge(body, request, db, "OWNER_REGISTER")
    validate_password(body.password, body.confirm_password, challenge["target_mobile"], challenge["mobile"])
    user = {
        "_id": new_id(),
        "mobile": challenge["target_mobile"],
        "email": challenge["mobile"],
        "email_verified": True,
        "owner_registered": True,
        "name": challenge["name"],
        "language": challenge.get("language", "en"),
        "password_hash": hash_password(body.password),
        "created_at": now(),
        "auth_version": 1,
    }
    try:
        db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(409, "An account already uses these details. Sign in or recover your password.")
    return browser_session(request, response, create_session(request, db, user, "OWNER"))


@router.post("/auth/owner/recovery/request")
def recovery_request(body: EmailInput, request: Request, db=Depends(get_db)):
    email = str(body.email).lower()
    throttle(request, db, "recovery:" + email)
    user = db.users.find_one({"email": email})
    if user and is_owner(db, user):
        return issue_challenge(
            request,
            db,
            email,
            "OWNER_RECOVERY",
            {"user_id": user["_id"], "auth_version": user.get("auth_version", 0)},
        )
    config = request.app.state.settings
    return {
        "challenge_id": new_id(),
        "expires_in": config.otp_expire_seconds,
        "resend_after": config.otp_resend_seconds,
    }


@router.post("/auth/owner/recovery/confirm")
def recovery_confirm(body: EmailPassword, request: Request, response: Response, db=Depends(get_db)):
    validate_password(body.password, body.confirm_password)
    challenge = consume_challenge(body, request, db, "OWNER_RECOVERY")
    user = db.users.find_one({"_id": challenge["user_id"], "email": challenge["mobile"]})
    if not user or user.get("auth_version", 0) != challenge["auth_version"]:
        raise HTTPException(400, "Your account changed. Request a new email code.")
    user = replace_password(db, user, body, {"email_verified": True})
    return browser_session(request, response, create_session(request, db, user, "OWNER"))


@router.post("/auth/owner/enroll/request")
def enroll_request(
    body: EmailInput, request: Request, identity=Depends(current_identity), db=Depends(get_db)
):
    # Existing signed-in owners can migrate without losing their shops or session first.
    if identity.role != "OWNER" or identity.user.get("password_hash"):
        raise HTTPException(403, "This setup is only for an existing owner without a password.")
    email = str(body.email).lower()
    if db.users.find_one({"email": email, "_id": {"$ne": identity.user["_id"]}}):
        raise HTTPException(409, "Email already belongs to another account.")
    return issue_challenge(
        request,
        db,
        email,
        "OWNER_ENROLL",
        {"user_id": identity.user["_id"], "auth_version": identity.user.get("auth_version", 0)},
    )


@router.post("/auth/owner/enroll/confirm")
def enroll_confirm(
    body: EmailPassword,
    request: Request,
    response: Response,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    validate_password(body.password, body.confirm_password)
    challenge = consume_challenge(
        body,
        request,
        db,
        "OWNER_ENROLL",
        {"user_id": identity.user["_id"], "auth_version": identity.user.get("auth_version", 0)},
    )
    try:
        user = replace_password(
            db,
            identity.user,
            body,
            {"email": challenge["mobile"], "email_verified": True, "owner_registered": True},
        )
    except DuplicateKeyError:
        raise HTTPException(409, "Email already belongs to another account.")
    return browser_session(request, response, create_session(request, db, user, "OWNER"))


@router.post("/auth/password/change")
def change(
    body: PasswordChange,
    request: Request,
    response: Response,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    throttle(request, db, "change:" + identity.user["_id"])
    if not verify_password(identity.user.get("password_hash"), body.current_password):
        raise HTTPException(400, "Current password is incorrect.")
    user = replace_password(db, identity.user, body)
    return browser_session(request, response, create_session(request, db, user, identity.role))


@router.post("/auth/staff/reset-request")
def staff_request(body: OTPRequest, request: Request, db=Depends(get_db)):
    throttle(request, db, "staff-request:" + body.mobile, 10)
    if body.role == "OWNER" or not eligible_staff(db, body.mobile, body.role):
        raise HTTPException(403, NOT_ADDED)
    user = db.users.find_one({"mobile": body.mobile})
    if is_owner(db, user):
        raise HTTPException(403, "This account also owns a shop. Use owner email recovery.")
    db.users.update_one(
        {"_id": user["_id"], "password_reset_requested_at": {"$exists": False}},
        {"$set": {"password_reset_requested_at": now()}},
    )
    return {
        "message": message(
            request,
            "Request sent. Ask your owner or an authorised manager for your setup code after approval.",
        )
    }


def staff_authority(db, actor, shop, target, user, initial=False):
    if actor["user_id"] == target["user_id"] or is_owner(db, user):
        raise HTTPException(403, "Use your own account settings or owner email recovery.")
    if actor["role"] == "OWNER":
        return
    permission = "add_workers" if initial else "reset_worker_passwords"
    if (
        target["role"] != "WORKER"
        or not permissions_for(actor, shop).get(permission)
        or db.memberships.find_one(
            {"user_id": user["_id"], "active": True, "role": {"$in": ["MANAGER", "ADMIN", "OWNER"]}}
        )
    ):
        raise HTTPException(403, "Your owner must handle this password request.")


@router.post("/shops/{shop_id}/team/{staff_id}/password-access")
def approve_staff(
    shop_id: str, staff_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)
):
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    target = staff_in_shop(db, shop_id, staff_id, active_only=True)
    if not target.get("user_id"):
        return approve_profile_login(db, request, identity, actor, shop, target)
    user = db.users.find_one({"_id": target["user_id"]})
    initial = not user.get("password_hash")
    staff_authority(db, actor, shop, target, user, initial)
    if (
        not initial
        and not user.get("password_reset_requested_at")
        and not user.get("password_reset_required")
    ):
        raise HTTPException(409, "The team member must request a password reset first.")
    throttle(request, db, "approve:" + identity.user["_id"], 60)
    code = secrets.token_hex(6).upper()
    expiry = now() + timedelta(hours=24)
    version = user.get("auth_version", 0) + 1
    grant = {
        "hash": code_hash(request.app.state.settings.jwt_secret, user["_id"], code),
        "expires_at": expiry,
        "shop_id": shop_id,
        "member_id": staff_id,
        "issuer_id": actor["_id"],
        "initial": initial,
        "version": version,
    }
    updated = db.users.find_one_and_update(
        version_query(user),
        {
            "$set": {"password_setup": grant, "password_reset_required": True},
            "$inc": {"auth_version": 1},
            "$unset": {"session_slots": ""},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(409, "The account changed. Refresh and try again.")
    db.sessions.update_many(
        {"user_id": user["_id"], "auth_version": {"$ne": version}}, {"$set": {"revoked": True}}
    )
    return {
        "setup_code": code,
        "expires_at": expiry,
        "message": message(
            request, "Share this code directly with this person. It is shown only now and can be used once."
        ),
    }


@router.post("/shops/{shop_id}/team/{staff_id}/password-deny")
def deny_staff(
    shop_id: str, staff_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)
):
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    target = staff_in_shop(db, shop_id, staff_id, active_only=True)
    user = db.users.find_one({"_id": target["user_id"]})
    staff_authority(db, actor, shop, target, user)
    if user.get("password_reset_required"):
        raise HTTPException(409, "Reset already approved. Issue a new setup code if needed.")
    db.users.update_one(version_query(user), {"$unset": {"password_reset_requested_at": ""}})
    return {"message": message(request, "Request declined. Existing password remains unchanged.")}


@router.post("/auth/staff/password/setup")
def staff_setup(body: StaffPassword, request: Request, response: Response, db=Depends(get_db)):
    throttle(request, db, "setup:" + body.mobile, 10)
    invitation = code_hash(
        request.app.state.settings.jwt_secret, "staff-profile", body.setup_code.strip().upper()
    )
    target = db.memberships.find_one({"contact_mobile": body.mobile, "login_invite.hash": invitation})
    if target and body.role == "WORKER":
        user = claim_profile_login(db, request, body, target)
        return browser_session(request, response, create_session(request, db, user, body.role.value))
    if body.role == "OWNER" or not eligible_staff(db, body.mobile, body.role):
        raise HTTPException(403, NOT_ADDED)
    user = db.users.find_one({"mobile": body.mobile})
    grant = user.get("password_setup")
    if (
        not grant
        or grant["expires_at"] <= now()
        or not hmac.compare_digest(
            grant["hash"],
            code_hash(request.app.state.settings.jwt_secret, user["_id"], body.setup_code.strip().upper()),
        )
    ):
        raise HTTPException(400, "Invalid or expired setup code. Ask your owner for a new one.")
    target = staff_in_shop(db, grant["shop_id"], grant["member_id"], active_only=True)
    actor = db.memberships.find_one({"_id": grant["issuer_id"], "shop_id": grant["shop_id"], "active": True})
    shop = db.shops.find_one({"_id": grant["shop_id"]})
    if (
        not actor
        or not shop
        or target["user_id"] != user["_id"]
        or grant["version"] != user.get("auth_version", 0)
    ):
        raise HTTPException(403, "This setup approval is no longer valid.")
    staff_authority(db, actor, shop, target, user, grant["initial"])
    user = replace_password(db, user, body, condition={"password_setup.hash": grant["hash"]})
    return browser_session(request, response, create_session(request, db, user, body.role.value))


def approve_profile_login(db, request, identity, actor, shop, target):
    if target["role"] != "WORKER" or (
        actor["role"] != "OWNER" and not permissions_for(actor, shop)["add_workers"]
    ):
        raise HTTPException(403, "Your owner must handle this password request.")
    if not target.get("contact_mobile"):
        raise HTTPException(409, "Add a contact mobile before setting up login.")
    throttle(request, db, "approve:" + identity.user["_id"], 60)
    code = secrets.token_hex(6).upper()
    expiry = now() + timedelta(hours=24)
    result = db.memberships.update_one(
        {"_id": target["_id"], "user_id": None, "active": True, "revision": target.get("revision", 0)},
        {
            "$set": {
                "login_invite": {
                    "hash": code_hash(request.app.state.settings.jwt_secret, "staff-profile", code),
                    "expires_at": expiry,
                    "issuer_id": actor["_id"],
                }
            },
            "$inc": {"revision": 1},
        },
    )
    if not result.modified_count:
        raise HTTPException(409, "This staff record changed. Refresh before saving again.")
    return {
        "setup_code": code,
        "expires_at": expiry,
        "message": "Share this code directly with this person. Login begins only after they accept it. Existing accounts must prove their current password.",
    }


def claim_profile_login(db, request, body, target):
    grant = target["login_invite"]
    if not target["active"] or grant["expires_at"] <= now():
        raise HTTPException(400, "Invalid or expired setup code. Ask your owner for a new one.")
    actor = db.memberships.find_one({"_id": grant["issuer_id"], "shop_id": target["shop_id"], "active": True})
    shop = db.shops.find_one({"_id": target["shop_id"]})
    if (
        not actor
        or not shop
        or (
            actor["role"] != "OWNER"
            and (actor["role"] not in {"MANAGER", "ADMIN"} or not permissions_for(actor, shop)["add_workers"])
        )
    ):
        raise HTTPException(403, "This setup approval is no longer valid.")
    user = db.users.find_one({"mobile": body.mobile})
    created = False
    if not user:
        validate_password(body.password, body.confirm_password, body.mobile)
        candidate = {
            "_id": new_id(),
            "mobile": body.mobile,
            "created_at": now(),
            "password_hash": hash_password(body.password),
        }
        try:
            db.users.insert_one(candidate)
            user = candidate
            created = True
        except DuplicateKeyError:
            user = db.users.find_one({"mobile": body.mobile})
    claimed = grant.get("claimed_user") == user["_id"]
    if not created:
        has_password = bool(user.get("password_hash"))
        proof_matches = has_password and any(
            verify_password(user["password_hash"], proof)
            for proof in (body.current_password, body.password if claimed else "")
            if proof
        )
        if has_password and not proof_matches:
            raise HTTPException(
                409,
                "An account already uses this number. Enter its current password to accept the staff invitation.",
            )
        validate_password(body.password, body.confirm_password, body.mobile, user.get("email", ""))
    if target.get("user_id") not in (None, user["_id"]):
        raise HTTPException(409, "This staff record changed. Refresh before saving again.")
    try:
        attached = db.memberships.update_one(
            {
                "_id": target["_id"],
                "active": True,
                "contact_mobile": body.mobile,
                "login_invite.hash": grant["hash"],
                "revision": target.get("revision", 0),
                "user_id": target.get("user_id"),
            },
            {
                "$set": {"user_id": user["_id"], "login_invite.claimed_user": user["_id"]},
                "$inc": {"revision": 1},
            },
        )
    except DuplicateKeyError:
        raise HTTPException(
            409, "This account already has a worker profile in this shop. Ask the owner to review it."
        )
    if not attached.modified_count:
        raise HTTPException(409, "This staff record changed. Refresh before saving again.")
    if not created and not (claimed and verify_password(user.get("password_hash"), body.password)):
        user = replace_password(db, user, body)
    return user
