"""Owner control plane and a separate, cookie-only attendance device identity."""

import base64
import hashlib
import io
import secrets
from datetime import timedelta
from html import escape
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urlsplit
from uuid import UUID

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import get_db, new_id, now, public
from ..face_engine import MODEL_VERSION, rank, seal, unseal
from ..face_store import device_in, enabled, event, mutate, state
from ..schemas import Input
from ..security import current_identity, shop_access, staff_in_shop
from ..shop_policy import settings_for
from ..web_session import cookie_secure
from .attendance import record_arrival, record_departure, shop_today
from .shops import worker_view

router = APIRouter(tags=["Face attendance"])
COOKIE = "hishob_station"
COOKIE_PATH = "/api/face-station"
STATIC = Path(__file__).resolve().parents[1] / "station"


class FaceSettings(Input):
    revision: int = Field(ge=0)
    enabled: bool
    manager_can_enroll_workers: bool
    allow_manager_attendance: bool
    supervised_use_acknowledged: bool = False


class Pair(Input):
    code: str = Field(min_length=12, max_length=24)
    name: str = Field(min_length=2, max_length=60)


class Disconnect(Input):
    device_id: str = Field(min_length=1, max_length=100)


class StationLink(Input):
    url: str = Field(min_length=1, max_length=2048)


class Rename(Input):
    name: str = Field(min_length=2, max_length=60)


class Grant(Input):
    member_id: str = Field(min_length=1, max_length=100)
    device_id: str = Field(min_length=1, max_length=100)
    employee_informed: Literal[True]


class Frames(Input):
    frames: list[str] = Field(min_length=3, max_length=3)

    @staticmethod
    def check_size(frames):
        if any(len(frame) > 400_000 for frame in frames):
            raise HTTPException(413, "Camera images are too large. Please try again.")


class Scan(Frames):
    request_id: UUID
    action: Literal["IN", "OUT"]


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def throttle(db, key, limit=20, seconds=60):
    bucket = int(now().timestamp()) // seconds
    identity = digest(f"{key}:{bucket}")
    try:
        result = db.face_limits.find_one_and_update(
            {"_id": identity},
            {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": now() + timedelta(seconds=seconds * 2)}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(429, "Too many attempts. Wait a minute and try again.")
    if result["count"] > limit:
        raise HTTPException(429, "Too many attempts. Wait a minute and try again.")


def manager_access(db, shop_id, identity, member_id=None):
    actor, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    doc = state(db, shop_id)
    if member_id:
        target = staff_in_shop(db, shop_id, member_id, active_only=True)
        if actor["role"] != "OWNER" and (
            not doc["manager_can_enroll_workers"]
            or target["role"] != "WORKER"
            or target["user_id"] == actor["user_id"]
        ):
            raise HTTPException(403, "Only the owner or an authorized manager can enroll this employee.")
    return actor, shop, doc


def require_owner(db, shop_id, identity):
    return shop_access(shop_id, db, identity, {"OWNER"})


def engine(request):
    return request.app.state.face_engine


def device_auth(request: Request, db=Depends(get_db)):
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Connect this attendance device using an owner’s pairing code.")
    hashed = digest(token)
    doc = db.face_shops.find_one({"devices.token_hash": hashed})
    device = next((d for d in doc["devices"] if d.get("token_hash") == hashed), None) if doc else None
    if not device or device["status"] == "REVOKED" or device["expires_at"] <= now():
        raise HTTPException(
            401, "Device access has expired or was revoked. Ask the owner to connect it again."
        )
    return doc, device


def active_device(request, db):
    doc, device = device_auth(request, db)
    if request.headers.get("X-Hishob-Shop") != doc["_id"]:
        raise HTTPException(409, "Open the station link for the paired shop before scanning.")
    enabled(doc)
    device_in(doc, device["id"])
    return doc, device


def grant_access(db, grant, doc):
    """Recheck the authorizer's live role and the employee's identity, including after capture."""
    if not grant or grant["expires_at"] <= now():
        raise HTTPException(410, "Enrollment expired. Ask your owner or manager to start again.")
    enabled(doc)
    device_in(doc, grant["device_id"])
    target = staff_in_shop(db, doc["_id"], grant["member_id"], active_only=True)
    actor = db.memberships.find_one({"_id": grant["actor_membership"], "shop_id": doc["_id"], "active": True})
    if (
        not actor
        or actor["user_id"] != grant["actor_user_id"]
        or target["user_id"] != grant["member_user_id"]
    ):
        raise HTTPException(403, "Enrollment access changed. Start again from the main app.")
    if actor["role"] != "OWNER" and (
        not doc["manager_can_enroll_workers"]
        or target["role"] != "WORKER"
        or actor["user_id"] == target["user_id"]
        or actor["role"] not in {"MANAGER", "ADMIN"}
    ):
        raise HTTPException(403, "Enrollment permission was removed.")
    return target


@router.get("/shops/{shop_id}/face")
def overview(shop_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)):
    actor, shop, doc = manager_access(db, shop_id, identity)
    owner = actor["role"] == "OWNER"
    try:
        engine(request).ready()
        ready, problem = True, ""
    except HTTPException as exc:
        ready, problem = False, exc.detail
    profiles = doc["profiles"]
    members = []
    for member in db.memberships.find({"shop_id": shop_id, "role": {"$in": ["WORKER", "MANAGER", "ADMIN"]}}):
        profile = profiles.get(member["_id"])
        enrolled = bool(
            profile and profile["user_id"] == member["user_id"] and profile["model"] == MODEL_VERSION
        )
        members.append(
            {
                "id": member["_id"],
                "name": worker_view(db, member)["name"],
                "role": member["role"],
                "enrolled": enrolled,
                "has_template": bool(profile),
                "active": member["active"],
                "can_enroll": member["active"]
                and (
                    owner
                    or (
                        doc["manager_can_enroll_workers"]
                        and member["role"] == "WORKER"
                        and member["user_id"] != actor["user_id"]
                    )
                ),
                "eligible": member["role"] == "WORKER" or doc["allow_manager_attendance"],
            }
        )
    grants = []
    for grant in db.face_enrollments.find({"shop_id": shop_id, "expires_at": {"$gt": now()}}):
        if owner or grant["actor_membership"] == actor["_id"]:
            grants.append({k: grant[k] for k in ["_id", "member_id", "device_id", "status", "expires_at"]})
    actor_names = {d["id"]: d["name"] for d in doc["devices"]}
    recent_events = list(reversed(doc["events"][-50:]))
    for entry in recent_events:
        actor_id = entry["by"]
        if actor_id not in actor_names:
            user = db.users.find_one({"_id": actor_id})
            membership = db.memberships.find_one({"shop_id": shop_id, "user_id": actor_id})
            profile = (
                db.worker_profiles.find_one({"membership_id": membership["_id"]}) if membership else None
            )
            actor_names[actor_id] = (
                (profile or {}).get("name") or (user or {}).get("name") or (membership or {}).get("role", "")
            )
        entry["actor_name"] = actor_names[actor_id]
    return {
        "revision": doc["revision"],
        "enabled": doc["enabled"],
        "manager_can_enroll_workers": doc["manager_can_enroll_workers"],
        "allow_manager_attendance": doc["allow_manager_attendance"],
        "ready": ready,
        "problem": problem,
        "owner": owner,
        "members": members,
        "devices": [
            {
                k: d.get(k)
                for k in ["id", "name", "status", "confirmation", "last_seen", "expires_at", "camera"]
            }
            for d in doc["devices"]
            if d["status"] != "REVOKED" and d["expires_at"] > now()
        ],
        "enrollments": [public(g) for g in grants],
        "events": recent_events,
        "station_path": "/api/face-station/",
    }


@router.put("/shops/{shop_id}/face/settings")
def update_settings(
    shop_id: str, body: FaceSettings, request: Request, identity=Depends(current_identity), db=Depends(get_db)
):
    require_owner(db, shop_id, identity)
    if body.enabled:
        if not body.supervised_use_acknowledged:
            raise HTTPException(422, "Confirm supervised use before enabling face attendance.")
        engine(request).ready()

    def change(doc):
        if doc["revision"] != body.revision:
            raise HTTPException(409, "Face settings changed. Refresh and try again.")
        doc.update(body.model_dump(exclude={"revision"}))
        event(
            doc,
            identity.user["_id"],
            "SETTINGS_CHANGED",
            enabled=body.enabled,
            manager_can_enroll_workers=body.manager_can_enroll_workers,
            allow_manager_attendance=body.allow_manager_attendance,
        )
        if not body.enabled:
            doc["pairing"] = None
            for device in doc["devices"]:
                device.pop("enrollment_id", None)

    mutate(db, shop_id, change)
    if not body.enabled:
        db.face_enrollments.delete_many({"shop_id": shop_id})
    return {"saved": True}


@router.post("/shops/{shop_id}/face/pairing")
def pairing_code(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    require_owner(db, shop_id, identity)
    throttle(db, f"pair-create:{shop_id}", 5)
    code = secrets.token_hex(6).upper()
    expires = now() + timedelta(minutes=5)

    def change(doc):
        enabled(doc)
        if any(d["status"] in {"ACTIVE", "PENDING"} and d["expires_at"] > now() for d in doc["devices"]):
            raise HTTPException(409, "Revoke the existing device before connecting a replacement.")
        doc["pairing"] = {"code_hash": digest(code), "expires_at": expires}
        event(doc, identity.user["_id"], "PAIRING_CREATED")

    mutate(db, shop_id, change)
    return {"code": code, "expires_at": expires}


@router.post("/face-station/pair")
def pair_device(body: Pair, request: Request, response: Response, db=Depends(get_db)):
    throttle(db, f"pair-ip:{request.client.host if request.client else 'unknown'}", 10)
    code_hash = digest(body.code.replace("-", "").replace(" ", "").upper())
    doc = db.face_shops.find_one({"pairing.code_hash": code_hash})
    if not doc:
        raise HTTPException(400, "Pairing code is invalid or expired.")
    expected_shop = request.headers.get("X-Hishob-Shop")
    if expected_shop and expected_shop != doc["_id"]:
        raise HTTPException(
            409, "This pairing code belongs to another shop. Use the code for the shop you opened."
        )
    try:
        device_auth(request, db)
    except HTTPException as exc:
        if exc.status_code != 401:
            raise
    else:
        raise HTTPException(409, "Disconnect the current station before pairing another shop.")
    token, device_id = secrets.token_urlsafe(32), new_id()
    confirmation = secrets.token_hex(3).upper()

    def change(current):
        enabled(current)
        pair = current["pairing"]
        if not pair or pair["code_hash"] != code_hash or pair["expires_at"] <= now():
            raise HTTPException(400, "Pairing code is invalid or expired.")
        current["pairing"] = None
        current["devices"].append(
            {
                "id": device_id,
                "token_hash": digest(token),
                "name": body.name,
                "status": "PENDING",
                "confirmation": confirmation,
                "created_at": now(),
                "expires_at": now() + timedelta(minutes=5),
                "last_seen": now(),
                "camera": "UNKNOWN",
            }
        )
        event(current, device_id, "DEVICE_REQUESTED", device_name=body.name)

    mutate(db, doc["_id"], change)
    response.set_cookie(
        COOKIE,
        token,
        max_age=30 * 86400,
        httponly=True,
        secure=cookie_secure(request),
        samesite="strict",
        path=COOKIE_PATH,
    )
    return {"confirmation": confirmation, "status": "PENDING", "shop_id": doc["_id"]}


@router.post("/face-station/disconnect")
def disconnect_station(body: Disconnect, request: Request, response: Response, db=Depends(get_db)):
    # Explicit device logout, including when opening a different shop's link.
    # Compare the displayed device so an old tab cannot revoke a newly paired station.
    doc, device = device_auth(request, db)
    if body.device_id != device["id"]:
        raise HTTPException(409, "The connected station changed. Refresh before disconnecting.")

    def change(current):
        live = device_in(current, device["id"], active=False)
        live.update(status="REVOKED")
        live.pop("token_hash", None)
        live.pop("enrollment_id", None)
        event(current, device["id"], "DEVICE_DISCONNECTED", device_name=live["name"])

    mutate(db, doc["_id"], change)
    db.face_enrollments.delete_many({"shop_id": doc["_id"], "device_id": device["id"]})
    response.delete_cookie(
        COOKIE, path=COOKIE_PATH, httponly=True, secure=cookie_secure(request), samesite="strict"
    )
    return {"saved": True}


@router.post("/shops/{shop_id}/face/devices/{device_id}/approve")
def approve_device(shop_id: str, device_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    require_owner(db, shop_id, identity)

    def change(doc):
        enabled(doc)
        device = device_in(doc, device_id, active=False)
        if device["status"] != "PENDING" or device["expires_at"] <= now():
            raise HTTPException(409, "Pairing request expired or was already handled.")
        device.update(status="ACTIVE", expires_at=now() + timedelta(days=30))
        event(doc, identity.user["_id"], "DEVICE_APPROVED", device_name=device["name"])

    mutate(db, shop_id, change)
    return {"saved": True}


@router.post("/shops/{shop_id}/face/devices/{device_id}/revoke")
def revoke_device(shop_id: str, device_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    require_owner(db, shop_id, identity)

    def change(doc):
        device = device_in(doc, device_id, active=False)
        device.update(status="REVOKED")
        device.pop("token_hash", None)
        device.pop("enrollment_id", None)
        event(doc, identity.user["_id"], "DEVICE_REVOKED", device_name=device["name"])

    mutate(db, shop_id, change)
    db.face_enrollments.delete_many({"shop_id": shop_id, "device_id": device_id})
    return {"saved": True}


@router.patch("/shops/{shop_id}/face/devices/{device_id}")
def rename_device(
    shop_id: str, device_id: str, body: Rename, identity=Depends(current_identity), db=Depends(get_db)
):
    require_owner(db, shop_id, identity)

    def change(doc):
        device = device_in(doc, device_id)
        device["name"] = body.name
        event(doc, identity.user["_id"], "DEVICE_RENAMED", device_name=body.name)

    mutate(db, shop_id, change)
    return {"saved": True}


@router.post("/shops/{shop_id}/face/enrollments")
def start_enrollment(shop_id: str, body: Grant, identity=Depends(current_identity), db=Depends(get_db)):
    actor, _, _ = manager_access(db, shop_id, identity, body.member_id)
    member = staff_in_shop(db, shop_id, body.member_id, active_only=True)
    grant = {
        "_id": new_id(),
        "shop_id": shop_id,
        **body.model_dump(),
        "member_user_id": member["user_id"],
        "actor_membership": actor["_id"],
        "actor_user_id": actor["user_id"],
        "status": "WAITING",
        "expires_at": now() + timedelta(minutes=5),
    }
    db.face_enrollments.insert_one(grant)

    def change(doc):
        grant_access(db, grant, doc)
        device = device_in(doc, body.device_id)
        existing = db.face_enrollments.find_one(
            {"_id": device.get("enrollment_id"), "expires_at": {"$gt": now()}}
        )
        if existing:
            raise HTTPException(409, "Finish or cancel the current enrollment first.")
        device["enrollment_id"] = grant["_id"]
        event(doc, identity.user["_id"], "ENROLLMENT_STARTED", member_id=body.member_id)

    try:
        mutate(db, shop_id, change)
    except Exception:
        db.face_enrollments.delete_one({"_id": grant["_id"]})
        raise
    return {"id": grant["_id"], "expires_at": grant["expires_at"]}


@router.post("/face-station/enrollments/{grant_id}/capture")
def capture(grant_id: str, body: Frames, request: Request, db=Depends(get_db)):
    doc, device = active_device(request, db)
    throttle(db, f"capture:{device['id']}", 10)
    grant = db.face_enrollments.find_one({"_id": grant_id, "shop_id": doc["_id"], "device_id": device["id"]})
    grant_access(db, grant, doc)
    if device.get("enrollment_id") != grant_id:
        raise HTTPException(403, "This enrollment is no longer authorized.")
    if grant["status"] == "READY":
        return {"status": "READY"}
    Frames.check_size(body.frames)
    vectors = engine(request).extract(body.frames)
    doc, device = active_device(request, db)
    grant_access(db, grant, doc)
    if device.get("enrollment_id") != grant_id:
        raise HTTPException(403, "This enrollment is no longer authorized.")
    result = db.face_enrollments.update_one(
        {"_id": grant_id, "status": "WAITING", "expires_at": {"$gt": now()}},
        {
            "$set": {
                "status": "READY",
                "template": seal(request.app.state.settings, vectors),
                "model": MODEL_VERSION,
            }
        },
    )
    if not result.modified_count:
        raise HTTPException(409, "Enrollment changed. Refresh the station.")
    return {"status": "READY"}


@router.post("/shops/{shop_id}/face/enrollments/{grant_id}/{operation}")
def finish_enrollment(
    shop_id: str,
    grant_id: str,
    operation: Literal["confirm", "cancel"],
    request: Request,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    actor, _, _ = manager_access(db, shop_id, identity)
    grant = db.face_enrollments.find_one({"_id": grant_id, "shop_id": shop_id})
    if not grant:
        current = state(db, shop_id)
        saved = next((p for p in current["profiles"].values() if p.get("grant_id") == grant_id), None)
        if (
            operation == "confirm"
            and saved
            and (actor["role"] == "OWNER" or saved["approved_by"] == identity.user["_id"])
        ):
            return {"saved": True}
        raise HTTPException(410, "Enrollment expired or was already handled. Refresh the list.")
    if actor["role"] != "OWNER" and actor["_id"] != grant["actor_membership"]:
        raise HTTPException(403, "Only the approving manager or owner can finish this enrollment.")

    def change(doc):
        device = device_in(doc, grant["device_id"], active=False)
        if device.get("enrollment_id") != grant_id:
            raise HTTPException(409, "Enrollment was already handled.")
        if operation == "confirm":
            target = grant_access(db, grant, doc)
            manager_access(db, shop_id, identity, grant["member_id"])
            if grant["status"] != "READY":
                raise HTTPException(409, "Capture the face samples on the station first.")
            others = {k: p for k, p in doc["profiles"].items() if k != grant["member_id"]}
            scores = rank(
                unseal(request.app.state.settings, grant["template"]), others, request.app.state.settings
            )
            if scores and scores[0][0] >= request.app.state.settings.face_match_threshold:
                raise HTTPException(
                    409,
                    "This face resembles another enrollment. Review existing employees before continuing.",
                )
            if len(doc["profiles"]) >= 200 and grant["member_id"] not in doc["profiles"]:
                raise HTTPException(409, "This pilot supports up to 200 enrolled employees per shop.")
            doc["profiles"][grant["member_id"]] = {
                "template": grant["template"],
                "model": MODEL_VERSION,
                "user_id": target["user_id"],
                "enrolled_at": now(),
                "approved_by": identity.user["_id"],
                "grant_id": grant_id,
            }
        device.pop("enrollment_id", None)
        event(
            doc,
            identity.user["_id"],
            "FACE_ENROLLED" if operation == "confirm" else "ENROLLMENT_CANCELLED",
            member_id=grant["member_id"],
        )

    mutate(db, shop_id, change)
    db.face_enrollments.delete_one({"_id": grant_id})
    return {"saved": True}


@router.post("/shops/{shop_id}/face/members/{member_id}/remove")
def remove_face(shop_id: str, member_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    require_owner(db, shop_id, identity)

    def change(doc):
        doc["profiles"].pop(member_id, None)
        for device in doc["devices"]:
            grant = db.face_enrollments.find_one({"_id": device.get("enrollment_id"), "member_id": member_id})
            if grant:
                device.pop("enrollment_id", None)
        event(doc, identity.user["_id"], "FACE_REMOVED", member_id=member_id)

    mutate(db, shop_id, change)
    db.face_enrollments.delete_many({"shop_id": shop_id, "member_id": member_id})
    return {"saved": True}


@router.get("/face-station/status")
def station_status(
    request: Request,
    response: Response,
    camera: Literal["READY", "BLOCKED", "UNKNOWN"] = "UNKNOWN",
    db=Depends(get_db),
):
    doc, device = device_auth(request, db)
    shop = db.shops.find_one({"_id": doc["_id"]})
    if not shop:
        raise HTTPException(401, "Shop no longer available.")
    # Sliding cookie/device expiry; heartbeat writes at most once per minute.
    if (
        request.headers.get("X-Hishob-Shop") == doc["_id"]
        and device["status"] == "ACTIVE"
        and (device["last_seen"] < now() - timedelta(minutes=1) or device.get("camera") != camera)
    ):

        def change(current):
            live = device_in(current, device["id"])
            live.update(last_seen=now(), camera=camera, expires_at=now() + timedelta(days=30))

        mutate(db, doc["_id"], change)
        response.set_cookie(
            COOKIE,
            request.cookies[COOKIE],
            max_age=30 * 86400,
            httponly=True,
            secure=cookie_secure(request),
            samesite="strict",
            path=COOKIE_PATH,
        )
    grant = None
    if doc["enabled"] and device["status"] == "ACTIVE":
        candidate = db.face_enrollments.find_one(
            {"_id": device.get("enrollment_id"), "expires_at": {"$gt": now()}}
        )
        if candidate:
            try:
                member = grant_access(db, candidate, doc)
                grant = {
                    "id": candidate["_id"],
                    "name": worker_view(db, member)["name"],
                    "status": candidate["status"],
                    "expires_at": candidate["expires_at"],
                }
            except HTTPException:
                pass
    # OUT remains available when an old shift is open after switching to check-in only.
    has_open = db.attendance.find_one({"shop_id": doc["_id"], "is_open": True}, {"_id": 1}) is not None
    return {
        "shop_id": shop["_id"],
        "device_id": device["id"],
        "shop_name": shop["name"],
        "timezone": shop["timezone"],
        "device_name": device["name"],
        "status": device["status"],
        "confirmation": device["confirmation"],
        "enabled": doc["enabled"],
        "enrollment": grant,
        "allow_out": settings_for(shop)["attendance_mode"] == "CHECK_IN_OUT" or has_open,
    }


@router.post("/face-station/scan")
def scan(body: Scan, request: Request, db=Depends(get_db)):
    doc, device = active_device(request, db)
    throttle(db, f"scan:{device['id']}", 30)
    Frames.check_size(body.frames)
    payload_hash = digest(body.action + ":" + ":".join(body.frames))
    request_id = f"{device['id']}:{body.request_id}"
    existing = db.attendance.find_one({"shop_id": doc["_id"], "face_receipts.request_id": request_id})
    if existing:
        receipt = next(r for r in existing["face_receipts"] if r["request_id"] == request_id)
        if receipt["action"] != body.action or receipt.get("payload_hash") != payload_hash:
            raise HTTPException(409, "Use a new scan for a different attendance action.")
        return receipt["result"]
    vectors = engine(request).extract(body.frames)
    # Recheck live device, settings and memberships after potentially slow inference.
    doc, device = active_device(request, db)
    members = {
        m["_id"]: m
        for m in db.memberships.find(
            {"shop_id": doc["_id"], "active": True, "role": {"$in": ["WORKER", "MANAGER", "ADMIN"]}}
        )
    }
    profiles = {
        k: p for k, p in doc["profiles"].items() if k in members and p["user_id"] == members[k]["user_id"]
    }
    scores = rank(vectors, profiles, request.app.state.settings)
    config = request.app.state.settings
    if (
        not scores
        or scores[0][0] < config.face_match_threshold
        or (len(scores) > 1 and scores[0][0] - scores[1][0] < config.face_match_margin)
    ):
        raise HTTPException(
            422, "Face not recognized clearly. Try again or ask your owner to record attendance."
        )
    member = members[scores[0][1]]
    if member["role"] != "WORKER" and not doc["allow_manager_attendance"]:
        raise HTTPException(403, "The owner has not enabled face attendance for managers.")
    shop = db.shops.find_one({"_id": doc["_id"]})
    name = worker_view(db, member)["name"]
    timestamp = now()
    result = {
        "shop_id": shop["_id"],
        "shop_name": shop["name"],
        "name": name,
        "action": body.action,
        "recorded_at": timestamp.isoformat(),
        "already_recorded": False,
    }
    receipt = {
        "request_id": request_id,
        "device_id": device["id"],
        "action": body.action,
        "result": result,
        "payload_hash": payload_hash,
    }
    # Atomic attendance write includes its retry receipt. No separate success log can be lost.
    try:
        if body.action == "IN":
            record_arrival(db, shop, member, device["id"], "FACE", receipt)
        else:
            record_departure(db, shop, member, device["id"], "FACE", receipt)
    except DuplicateKeyError:
        raise HTTPException(409, "This scan request was already used. Start a new scan.")
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        record = db.attendance.find_one(
            {"shop_id": shop["_id"], "worker_id": member["_id"], "face_receipts.request_id": request_id}
        )
        if record:
            saved = next(r for r in record["face_receipts"] if r["request_id"] == request_id)
            if saved.get("payload_hash") != payload_hash:
                raise HTTPException(409, "Use a new request for a different scan.")
            return saved["result"]
        record = db.attendance.find_one(
            {"shop_id": shop["_id"], "worker_id": member["_id"], "date": str(shop_today(shop))}
        )
        field = "check_in" if body.action == "IN" else "check_out"
        if record and record.get(field) and record["status"] == "PRESENT":
            return {**result, "already_recorded": True, "recorded_at": record[field].isoformat()}
        raise
    return result


@router.get("/face-station/")
def station_page(shop: Optional[str] = None, db=Depends(get_db)):
    html = (STATIC / "index.html").read_text()
    if shop:
        selected = db.shops.find_one({"_id": shop}, {"name": 1})
        if not selected:
            raise HTTPException(404, "Shop no longer available.")
        html = html.replace("Your workday starts here.", escape(selected["name"]))
    return Response(
        html,
        media_type="text/html",
        headers={
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
            "Permissions-Policy": "camera=(self), microphone=()",
            "X-Frame-Options": "DENY",
        },
    )


@router.get("/face-station/station.js")
def station_script():
    return FileResponse(STATIC / "station.js", media_type="text/javascript")


@router.get("/face-station/station.css")
def station_style():
    return FileResponse(STATIC / "station.css", media_type="text/css")


@router.post("/shops/{shop_id}/face/remove-all")
def remove_all_faces(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    require_owner(db, shop_id, identity)

    def change(doc):
        doc["profiles"] = {}
        for device in doc["devices"]:
            device.pop("enrollment_id", None)
        event(doc, identity.user["_id"], "ALL_FACES_REMOVED")

    mutate(db, shop_id, change)
    db.face_enrollments.delete_many({"shop_id": shop_id})
    return {"saved": True}


@router.post("/shops/{shop_id}/face/station-qr")
def station_qr(
    shop_id: str, body: StationLink, request: Request, identity=Depends(current_identity), db=Depends(get_db)
):
    manager_access(db, shop_id, identity)
    settings = request.app.state.settings
    try:
        parsed = urlsplit(body.url)
    except ValueError:
        raise HTTPException(422, "Use the attendance station address from this app.")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    trusted = [*settings.cors_origins, str(request.base_url).rstrip("/")]
    if (
        parsed.scheme not in {"http", "https"}
        or origin not in trusted
        or parsed.path != "/api/face-station/"
        or parsed.query != f"shop={shop_id}"
        or parsed.fragment
        or parsed.username
        or parsed.password
        or body.url != origin + f"/api/face-station/?shop={shop_id}"
    ):
        raise HTTPException(422, "Use the attendance station address from this app.")
    if settings.app_env not in {"development", "test"} and parsed.scheme != "https":
        raise HTTPException(422, "The attendance station needs an HTTPS address.")
    throttle(db, f"station-qr:{shop_id}:{identity.user['_id']}", 10)
    image = qrcode.make(body.url, box_size=8, border=4)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return {"image": "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()}
