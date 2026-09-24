from fastapi import HTTPException

from .db import public
from .schemas import ShopSettings


def settings_for(shop):
    # Existing shops get safe defaults without rewriting their history.
    return ShopSettings.model_validate(shop.get("settings", {})).model_dump(mode="json")


def shop_view(shop):
    return {**public(shop), "settings": settings_for(shop)}


def permissions_for(membership, shop):
    owner = membership["role"] == "OWNER"
    manager = membership["role"] in {"MANAGER", "ADMIN"}
    config = settings_for(shop)
    return {
        "view_hishob": owner or (manager and config["manager_can_access_hishob"]),
        "add_hishob_transactions": owner or (manager and config["manager_can_access_hishob"]),
        "edit_hishob_transactions": owner,
        "close_hishob": owner
        or (manager and config["manager_can_access_hishob"] and config["manager_can_close_hishob"]),
        "reopen_hishob": owner,
        "manage_attendance": owner or (manager and config["manager_can_manage_attendance"]),
        "add_workers": owner or (manager and config["manager_can_add_workers"]),
        "edit_workers": owner or (manager and config["manager_can_edit_workers"]),
        "manage_managers": owner,
        "manage_settings": owner,
        "view_own_attendance": manager or config["workers_can_view_attendance"],
        "mark_own_attendance": manager and config["manager_can_mark_own_attendance"],
    }


def require_permission(membership, shop, permission):
    if not permissions_for(membership, shop).get(permission):
        raise HTTPException(403, "Your shop owner has not enabled this permission for your role.")


def attendance_permissions(actor, shop, target):
    """Self-attendance cannot be authorised through the general team permission."""
    if actor["role"] == "OWNER":
        return {"can_mark": True, "can_edit": True}
    if target["user_id"] == actor["user_id"]:
        return {"can_mark": permissions_for(actor, shop)["mark_own_attendance"], "can_edit": False}
    permitted = target["role"] == "WORKER" and permissions_for(actor, shop)["manage_attendance"]
    return {"can_mark": permitted, "can_edit": permitted}


def require_attendance_permission(actor, shop, target, action):
    if not attendance_permissions(actor, shop, target)[action]:
        raise HTTPException(403, "Only your owner can authorise this attendance action.")
