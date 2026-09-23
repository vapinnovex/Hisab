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
        "manage_attendance": owner or (manager and config["manager_can_manage_attendance"]),
        "add_workers": owner or (manager and config["manager_can_add_workers"]),
        "edit_workers": owner or (manager and config["manager_can_edit_workers"]),
        "manage_managers": owner,
        "manage_settings": owner,
        "view_own_attendance": config["workers_can_view_attendance"],
    }


def require_permission(membership, shop, permission):
    if not permissions_for(membership, shop).get(permission):
        raise HTTPException(403, "Your shop owner has not enabled this permission for your role.")
