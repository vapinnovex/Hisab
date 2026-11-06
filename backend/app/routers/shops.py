from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import get_db, new_id, now
from ..schemas import (
    ManagerCreate,
    ManagerUpdate,
    ShopCreate,
    ShopSettings,
    ShopSettingsUpdate,
    WorkerCreate,
    WorkerUpdate,
)
from ..security import current_identity, require_owner, shop_access, worker_in_shop
from ..shop_policy import require_permission, settings_for, shop_view
from ..staff import initial_reference

router = APIRouter(prefix="/shops", tags=["Shops and workers"])


def worker_view(db, membership):
    profile = db.worker_profiles.find_one({"membership_id": membership["_id"]})
    user = db.users.find_one({"_id": membership.get("user_id")}) or {}
    return {
        "id": membership["_id"],
        "name": membership.get("name") or (profile["name"] if profile else ""),
        "role": "MANAGER" if membership["role"] == "ADMIN" else membership["role"],
        "mobile": user.get("mobile") or membership.get("contact_mobile") or "",
        "login_enabled": bool(user),
        "revision": membership.get("revision", 0),
        "active": membership["active"],
        "password_ready": bool(user.get("password_hash")),
        "password_reset_requested": bool(user.get("password_reset_requested_at")),
        "password_reset_required": bool(user.get("password_reset_required")),
        "created_at": membership["created_at"],
    }


def ensure_user(db, mobile):
    return db.users.find_one_and_update(
        {"mobile": mobile},
        {"$setOnInsert": {"_id": new_id(), "created_at": now()}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


@router.post("", status_code=201)
def create_shop(body: ShopCreate, identity=Depends(require_owner), db=Depends(get_db)):
    shop = {
        "_id": new_id(),
        **body.model_dump(mode="json"),
        "created_by": identity.user["_id"],
        "created_at": now(),
    }
    shop["settings"] = ShopSettings().model_dump(mode="json")
    db.shops.insert_one(shop)
    try:
        db.memberships.insert_one(
            {
                "_id": new_id(),
                "shop_id": shop["_id"],
                "user_id": identity.user["_id"],
                "role": "OWNER",
                "active": True,
                "created_at": now(),
            }
        )
    except Exception:
        db.shops.delete_one({"_id": shop["_id"]})
        raise
    return shop_view(shop)


@router.get("/{shop_id}/workers")
def list_workers(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    return [
        worker_view(db, m)
        for m in db.memberships.find({"shop_id": shop_id, "role": "WORKER"}).sort("created_at", 1)
    ]


@router.get("/{shop_id}/team")
def list_team(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    # Shared directory is read-only; manager administration remains owner-only.
    shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    return [
        worker_view(db, member)
        for member in db.memberships.find(
            {"shop_id": shop_id, "role": {"$in": ["WORKER", "MANAGER", "ADMIN"]}}
        ).sort("created_at", 1)
    ]


@router.post("/{shop_id}/workers", status_code=201)
def add_worker(shop_id: str, body: WorkerCreate, identity=Depends(current_identity), db=Depends(get_db)):
    membership, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    require_permission(membership, shop, "add_workers")
    salary = None
    if body.salary:
        require_permission(membership, shop, "manage_staff_payments")
        if identity.role != "OWNER" and body.mobile == identity.user["mobile"]:
            raise HTTPException(403, "You do not have permission to access this staff record.")
        salary = initial_reference(body.salary)
    # Existing phone-based creation remains compatible. A phone-less profile has
    # no user/account; later contact edits cannot grant account access.
    user = ensure_user(db, body.mobile) if body.mobile else None
    from ..radiosoft import digest

    payload = body.model_dump(mode="json", exclude={"request_id"})
    membership_id = digest([shop_id, identity.user["_id"], body.request_id]) if body.request_id else new_id()
    old = db.memberships.find_one({"_id": membership_id})
    if old:
        if old.get("creation") != payload:
            raise HTTPException(409, "This creation request was already used. Refresh and retry.")
        return worker_view(db, old)
    record = {
        "_id": membership_id,
        "shop_id": shop_id,
        "user_id": user["_id"] if user else None,
        "role": "WORKER",
        "name": body.name,
        "active": True,
        "created_at": now(),
        "revision": 0,
        "creation": payload,
    }
    if salary:
        record["pay_reference"] = salary
    try:
        db.memberships.insert_one(record)
    except DuplicateKeyError:
        old = db.memberships.find_one({"_id": membership_id})
        if old and old.get("creation") == payload:
            return worker_view(db, old)
        raise HTTPException(409, "Worker already exists. Edit their profile to reactivate them.")
    db.worker_profiles.update_one(
        {"membership_id": membership_id},
        {"$setOnInsert": {"_id": membership_id, "name": body.name, "created_at": now()}},
        upsert=True,
    )
    return worker_view(db, record)


@router.patch("/{shop_id}/workers/{worker_id}")
def edit_worker(
    shop_id: str, worker_id: str, body: WorkerUpdate, identity=Depends(current_identity), db=Depends(get_db)
):
    member, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    require_permission(member, shop, "edit_workers")
    if body.salary is not None:
        raise HTTPException(422, "Use the staff page to change reference salary.")
    target = worker_in_shop(db, shop_id, worker_id)
    current_mobile = worker_view(db, target)["mobile"]
    if target.get("user_id") and (body.mobile or "") != current_mobile:
        raise HTTPException(409, "Change a linked login number through verified account settings.")
    revision = target.get("revision", 0)
    if body.revision is not None and body.revision != revision:
        raise HTTPException(409, "This staff record changed. Refresh before saving again.")
    query = {
        "_id": worker_id,
        "shop_id": shop_id,
        **({"revision": revision} if "revision" in target else {"revision": {"$exists": False}}),
    }
    patch = {"$set": {"name": body.name, "active": body.active, "updated_at": now()}, "$inc": {"revision": 1}}
    if not target.get("user_id"):
        patch["$set"]["contact_mobile"] = body.mobile
        if (body.mobile or "") != current_mobile or not body.active:
            patch["$unset"] = {"login_invite": ""}
    membership = db.memberships.find_one_and_update(query, patch, return_document=ReturnDocument.AFTER)
    if not membership:
        raise HTTPException(409, "This staff record changed. Refresh before saving again.")
    return worker_view(db, membership)


@router.get("/{shop_id}/settings")
def get_shop_settings(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    _, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN", "WORKER"})
    return settings_for(shop)


@router.put("/{shop_id}/settings")
def update_shop_settings(
    shop_id: str, body: ShopSettingsUpdate, identity=Depends(current_identity), db=Depends(get_db)
):
    shop_access(shop_id, db, identity, {"OWNER"})
    settings = body.model_dump(mode="json", exclude={"shop_name", "language"})
    changes = {
        "settings": settings,
        "updated_at": now(),
        "updated_by": identity.user["_id"],
    }
    if body.shop_name is not None:
        changes["name"] = body.shop_name
    if body.language is not None:
        changes["language"] = body.language.value
    db.shops.update_one({"_id": shop_id}, {"$set": changes})
    return settings


@router.get("/{shop_id}/managers")
def list_managers(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    shop_access(shop_id, db, identity, {"OWNER"})
    return [
        worker_view(db, m)
        for m in db.memberships.find(
            {
                "shop_id": shop_id,
                "role": {"$in": ["MANAGER", "ADMIN"]},
            }
        ).sort("created_at", 1)
    ]


@router.post("/{shop_id}/managers", status_code=201)
def add_manager(shop_id: str, body: ManagerCreate, identity=Depends(current_identity), db=Depends(get_db)):
    _, shop = shop_access(shop_id, db, identity, {"OWNER"})
    salary = initial_reference(body.salary) if body.salary else None
    user = ensure_user(db, body.mobile)
    if db.memberships.find_one(
        {"shop_id": shop_id, "user_id": user["_id"], "role": {"$in": ["MANAGER", "ADMIN"]}}
    ):
        raise HTTPException(409, "Manager already exists. Edit their profile to reactivate them.")
    member = {
        "_id": new_id(),
        "shop_id": shop_id,
        "user_id": user["_id"],
        "role": "MANAGER",
        "name": body.name,
        "active": True,
        "created_at": now(),
    }
    if salary:
        member["pay_reference"] = salary
    try:
        db.memberships.insert_one(member)
    except DuplicateKeyError:
        raise HTTPException(409, "Manager already exists. Edit their profile to reactivate them.")
    return worker_view(db, member)


@router.patch("/{shop_id}/managers/{manager_id}")
def edit_manager(
    shop_id: str, manager_id: str, body: ManagerUpdate, identity=Depends(current_identity), db=Depends(get_db)
):
    shop_access(shop_id, db, identity, {"OWNER"})
    if body.salary is not None:
        raise HTTPException(422, "Use the staff page to change reference salary.")
    query = {"_id": manager_id, "shop_id": shop_id, "role": {"$in": ["MANAGER", "ADMIN"]}}
    if not db.memberships.find_one(query):
        raise HTTPException(404, "Manager not found in this shop")
    user = ensure_user(db, body.mobile)
    if db.memberships.find_one(
        {
            "_id": {"$ne": manager_id},
            "shop_id": shop_id,
            "user_id": user["_id"],
            "role": {"$in": ["MANAGER", "ADMIN"]},
        }
    ):
        raise HTTPException(409, "This mobile already belongs to a manager in this shop")
    try:
        member = db.memberships.find_one_and_update(
            query,
            {
                "$set": {
                    "name": body.name,
                    "user_id": user["_id"],
                    "active": body.active,
                    "updated_at": now(),
                }
            },
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(409, "This mobile already belongs to a manager in this shop")
    return worker_view(db, member)
