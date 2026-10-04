"""Shop-scoped face configuration; optimistic updates work on standalone MongoDB."""

from copy import deepcopy

from bson import BSON
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from .db import now


def state(db, shop_id):
    found = db.face_shops.find_one({"_id": shop_id})
    return found or {
        "_id": shop_id,
        "revision": 0,
        "enabled": False,
        "manager_can_enroll_workers": False,
        "allow_manager_attendance": False,
        "devices": [],
        "profiles": {},
        "events": [],
        "pairing": None,
    }


def mutate(db, shop_id, change):
    for _ in range(8):
        old = state(db, shop_id)
        updated = deepcopy(old)
        result = change(updated)
        updated["revision"] += 1
        if len(BSON.encode(updated)) > 8_000_000:
            raise HTTPException(
                409, "Face settings storage is full. Contact support before adding more data."
            )
        if old["revision"] == 0:
            try:
                db.face_shops.insert_one(updated)
                return result
            except DuplicateKeyError:
                continue
        if db.face_shops.replace_one({"_id": shop_id, "revision": old["revision"]}, updated).modified_count:
            return result
    raise HTTPException(409, "Face settings changed at the same time. Refresh and try again.")


def event(doc, actor, action, **details):
    doc["events"].append({"at": now(), "by": actor, "action": action, **details})


def device_in(doc, device_id, active=True):
    device = next((d for d in doc["devices"] if d["id"] == device_id), None)
    if not device or (active and (device["status"] != "ACTIVE" or device["expires_at"] <= now())):
        raise HTTPException(403, "This attendance device is not active. Ask the owner to connect it again.")
    return device


def enabled(doc):
    if not doc["enabled"]:
        raise HTTPException(403, "Face attendance is turned off. Ask your owner to record attendance.")
