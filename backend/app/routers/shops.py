from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import get_db, new_id, now
from ..schemas import ShopCreate, ShopSettings, WorkerCreate, WorkerUpdate
from ..security import current_identity, require_owner, shop_access, worker_in_shop
from ..shop_policy import require_permission, settings_for, shop_view

router = APIRouter(prefix="/shops", tags=["Shops and workers"])


def worker_view(db, membership):
    profile = db.worker_profiles.find_one({"membership_id": membership["_id"]})
    user = db.users.find_one({"_id": membership["user_id"]})
    return {
        "id": membership["_id"],
        "name": profile["name"] if profile else membership.get("name", ""),
        "role": "MANAGER" if membership["role"] == "ADMIN" else membership["role"],
        "mobile": user["mobile"],
        "active": membership["active"],
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
    shop = {"_id": new_id(), **body.model_dump(), "created_by": identity.user["_id"], "created_at": now()}
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
    user = ensure_user(db, body.mobile)
    membership_id = new_id()
    membership = {
        "_id": membership_id,
        "shop_id": shop_id,
        "user_id": user["_id"],
        "role": "WORKER",
        "active": True,
        "created_at": now(),
    }
    # Publish membership only after its profile exists.
    db.worker_profiles.insert_one(
        {"_id": membership_id, "membership_id": membership_id, "name": body.name, "created_at": now()}
    )
    try:
        db.memberships.insert_one(membership)
    except DuplicateKeyError:
        db.worker_profiles.delete_one({"_id": membership_id})
        raise HTTPException(409, "Worker already exists. Edit their profile to reactivate them.")
    return worker_view(db, membership)


@router.patch("/{shop_id}/workers/{worker_id}")
def edit_worker(
    shop_id: str, worker_id: str, body: WorkerUpdate, identity=Depends(current_identity), db=Depends(get_db)
):
    member, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    require_permission(member, shop, "edit_workers")
    worker_in_shop(db, shop_id, worker_id)
    user = ensure_user(db, body.mobile)
    try:
        membership = db.memberships.find_one_and_update(
            {"_id": worker_id, "shop_id": shop_id},
            {"$set": {"user_id": user["_id"], "active": body.active, "updated_at": now()}},
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(409, "This mobile number already belongs to a worker in this shop")
    db.worker_profiles.update_one(
        {"membership_id": worker_id}, {"$set": {"name": body.name, "updated_at": now()}}
    )
    return worker_view(db, membership)


@router.get("/{shop_id}/settings")
def get_shop_settings(shop_id: str, identity=Depends(current_identity), db=Depends(get_db)):
    _, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN", "WORKER"})
    return settings_for(shop)


@router.put("/{shop_id}/settings")
def update_shop_settings(
    shop_id: str, body: ShopSettings, identity=Depends(current_identity), db=Depends(get_db)
):
    shop_access(shop_id, db, identity, {"OWNER"})
    db.shops.update_one(
        {"_id": shop_id},
        {
            "$set": {
                "settings": body.model_dump(mode="json"),
                "updated_at": now(),
                "updated_by": identity.user["_id"],
            }
        },
    )
    return body


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
def add_manager(shop_id: str, body: WorkerCreate, identity=Depends(current_identity), db=Depends(get_db)):
    shop_access(shop_id, db, identity, {"OWNER"})
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
    try:
        db.memberships.insert_one(member)
    except DuplicateKeyError:
        raise HTTPException(409, "Manager already exists. Edit their profile to reactivate them.")
    return worker_view(db, member)


@router.patch("/{shop_id}/managers/{manager_id}")
def edit_manager(
    shop_id: str, manager_id: str, body: WorkerUpdate, identity=Depends(current_identity), db=Depends(get_db)
):
    shop_access(shop_id, db, identity, {"OWNER"})
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
