from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from conftest import login
from pymongo.errors import DuplicateKeyError

from app.db import now


def paths(setup_shop):
    owner, shop, worker, auth = setup_shop
    return owner, auth, f"/api/shops/{shop}", f"/api/shops/{shop}/workers/{worker}/attendance"


def configure(client, owner, shop_base, **changes):
    response = client.get(f"{shop_base}/settings", headers=owner)
    assert response.status_code == 200
    response = client.put(f"{shop_base}/settings", headers=owner, json={**response.json(), **changes})
    assert response.status_code == 200, response.text
    return response.json()


def manager_login(client, setup_shop):
    owner, shop, _, _ = setup_shop
    result = client.post(
        f"/api/shops/{shop}/managers", headers=owner, json={"name": "Ravi", "mobile": "+919876543212"}
    )
    assert result.status_code == 201, result.text
    return result.json()["id"], login(client, "+919876543212", "MANAGER")


def test_default_check_in_only_and_worker_read_only(client, setup_shop):
    owner, auth, base, attendance = paths(setup_shop)
    assert client.get(base + "/settings", headers=owner).json()["attendance_mode"] == "CHECK_IN_ONLY"
    for path in [
        base + "/me/attendance/check-in",
        base + "/me/attendance/check-out",
        attendance + "/check-in",
        attendance + "/check-out",
    ]:
        assert client.post(path, headers=auth).status_code == 403
    initial = client.get(base + "/me/attendance/today", headers=auth).json()
    assert initial["attendance"]["status"] == "NOT_MARKED"
    result = client.post(attendance + "/check-in", headers=owner)
    assert result.status_code == 200, result.text
    record = result.json()
    assert record["status"] == "PRESENT"
    assert record["is_open"] is False
    assert record["check_out"] is None
    assert record["check_in"].endswith(("Z", "+00:00"))
    assert record["source"] == "OWNER"
    assert client.post(attendance + "/check-in", headers=owner).status_code == 409
    assert client.post(attendance + "/check-out", headers=owner).status_code == 409
    view = client.get(base + "/me/attendance/today", headers=auth).json()
    assert view["attendance"]["status"] == "PRESENT"
    assert view["active_shift"] is None
    assert client.app.state.db.attendance.count_documents({}) == 1


def test_in_out_correction_and_monthly_summary(client, setup_shop):
    owner, auth, base, attendance = paths(setup_shop)
    configure(client, owner, base, attendance_mode="CHECK_IN_OUT")
    assert client.post(attendance + "/check-out", headers=owner).status_code == 409
    checkin = client.post(attendance + "/check-in", headers=owner).json()
    assert checkin["is_open"] is True
    result = client.post(attendance + "/check-out", headers=owner)
    assert result.status_code == 200
    assert result.json()["check_out"] >= checkin["check_in"]
    assert client.post(attendance + "/check-out", headers=owner).status_code == 409
    updated = client.put(
        attendance,
        headers=owner,
        json={"date": checkin["date"], "status": "HALF_DAY", "note": "Left after lunch"},
    )
    assert updated.status_code == 200
    assert updated.json()["check_in"] == checkin["check_in"]
    assert updated.json()["edits"][-1]["status"] == "HALF_DAY"
    for path, headers in [(attendance, owner), (base + "/me/attendance", auth)]:
        history = client.get(path, headers=headers, params={"month": checkin["date"][:7]}).json()
        assert history["days"][-1]["status"] == "HALF_DAY"
        assert history["summary"]["HALF_DAY"] == 1
        assert history["summary"]["PRESENT"] == 0
        assert history["today"] == checkin["date"]
    assert (
        client.put(attendance, headers=auth, json={"date": checkin["date"], "status": "PRESENT"}).status_code
        == 403
    )


def test_manager_login_and_shop_specific_permissions(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    _, manager = manager_login(client, setup_shop)
    base = f"/api/shops/{shop}"
    me = client.get("/api/auth/me", headers=manager).json()
    assert me["role"] == "MANAGER"
    assert me["memberships"][0]["worker_name"] == "Ravi"
    assert me["memberships"][0]["permissions"]["manage_attendance"] is True
    assert me["memberships"][0]["permissions"]["add_workers"] is False
    payload = {"name": "New worker", "mobile": "+919876543213"}
    assert client.post(base + "/workers", headers=manager, json=payload).status_code == 403
    assert client.post("/api/shops", headers=manager, json={"name": "Forbidden"}).status_code == 403
    assert client.get(base + "/managers", headers=manager).status_code == 403
    assert client.post(base + "/managers", headers=manager, json=payload).status_code == 403
    assert client.put(base + "/settings", headers=manager, json={}).status_code == 403
    configure(client, owner, base, manager_can_add_workers=True)
    added = client.post(base + "/workers", headers=manager, json=payload)
    assert added.status_code == 201
    edit_path = base + "/workers/" + added.json()["id"]
    update = {**payload, "active": False}
    assert client.patch(edit_path, headers=manager, json=update).status_code == 403
    configure(client, owner, base, manager_can_edit_workers=True)
    assert client.patch(edit_path, headers=manager, json=update).status_code == 200
    record = client.post(base + f"/workers/{worker}/attendance/check-in", headers=manager)
    assert record.status_code == 200
    assert record.json()["source"] == "MANAGER"
    assert (
        client.put(
            base + f"/workers/{worker}/attendance",
            headers=manager,
            json={"date": record.json()["date"], "status": "HALF_DAY"},
        ).status_code
        == 200
    )
    configure(client, owner, base, manager_can_manage_attendance=False, manager_can_add_workers=False)
    assert client.post(base + f"/workers/{worker}/attendance/check-in", headers=manager).status_code == 403
    assert (
        client.put(
            base + f"/workers/{worker}/attendance",
            headers=manager,
            json={"date": record.json()["date"], "status": "LEAVE"},
        ).status_code
        == 403
    )
    assert client.post(base + "/workers", headers=manager, json=payload).status_code == 403
    # Managers can still read the daily register when write permission is removed.
    assert client.get(base + "/attendance/today", headers=manager).status_code == 200


def test_permissions_do_not_leak_across_shops(client, setup_shop):
    owner, shop, worker, worker_auth = setup_shop
    _, manager = manager_login(client, setup_shop)
    second = client.post("/api/shops", headers=owner, json={"name": "Second shop"}).json()["id"]
    client.post(
        f"/api/shops/{second}/managers", headers=owner, json={"name": "Ravi", "mobile": "+919876543212"}
    )
    configure(client, owner, f"/api/shops/{shop}", manager_can_add_workers=True)
    payload = {"name": "New worker", "mobile": "+919876543213"}
    assert client.post(f"/api/shops/{second}/workers", headers=manager, json=payload).status_code == 403
    assert (
        client.post(f"/api/shops/{second}/workers/{worker}/attendance/check-in", headers=manager).status_code
        == 404
    )
    assert client.get(f"/api/shops/{second}/attendance/today", headers=worker_auth).status_code == 403
    outsider = login(client, "+919876543222")
    assert client.get(f"/api/shops/{shop}/attendance/today", headers=outsider).status_code == 403
    assert client.put(f"/api/shops/{shop}/settings", headers=outsider, json={}).status_code == 403
    assert (
        client.get(
            f"/api/shops/{shop}/workers/{worker}/attendance?month=2026-09", headers=worker_auth
        ).status_code
        == 403
    )


def test_worker_visibility_settings_preserve_history(client, setup_shop):
    owner, auth, base, attendance = paths(setup_shop)
    record = client.post(attendance + "/check-in", headers=owner).json()
    configure(client, owner, base, workers_can_view_attendance=False)
    assert client.get(base + "/me/attendance/today", headers=auth).status_code == 403
    assert client.get(base + "/me/attendance?month=" + record["date"][:7], headers=auth).status_code == 403
    assert (
        client.get(attendance + "?month=" + record["date"][:7], headers=owner).json()["summary"]["PRESENT"]
        == 1
    )
    configure(client, owner, base, workers_can_view_attendance=True)
    assert client.get(base + "/me/attendance/today", headers=auth).json()["attendance"]["status"] == "PRESENT"


def test_deactivation_blocks_worker_and_manager_without_losing_history(client, setup_shop):
    owner, shop, worker, auth = setup_shop
    manager_id, manager = manager_login(client, setup_shop)
    base = f"/api/shops/{shop}"
    record = client.post(base + f"/workers/{worker}/attendance/check-in", headers=manager).json()
    for role, member_id, mobile, headers in [
        ("workers", worker, "+919876543211", auth),
        ("managers", manager_id, "+919876543212", manager),
    ]:
        pending = client.post(
            "/api/auth/otp/request",
            json={"mobile": mobile, "role": "WORKER" if role == "workers" else "MANAGER"},
        ).json()
        update = {"name": "Edited", "mobile": mobile, "active": False}
        assert client.patch(base + f"/{role}/{member_id}", headers=owner, json=update).status_code == 200
        assert client.get("/api/auth/me", headers=headers).json()["memberships"] == []
        assert (
            client.post(
                "/api/auth/otp/verify", json={"challenge_id": pending["challenge_id"], "code": "123456"}
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/auth/otp/request",
                json={"mobile": mobile, "role": "WORKER" if role == "workers" else "MANAGER"},
            ).status_code
            == 403
        )
        update["active"] = True
        assert client.patch(base + f"/{role}/{member_id}", headers=owner, json=update).status_code == 200
    result = client.get(base + f"/workers/{worker}/attendance?month=" + record["date"][:7], headers=owner)
    assert result.json()["summary"]["PRESENT"] == 1


def test_unknown_staff_cannot_register_or_elevate(client, setup_shop):
    owner, auth, base, attendance = paths(setup_shop)
    for role in ["WORKER", "MANAGER"]:
        assert (
            client.post("/api/auth/otp/request", json={"mobile": "+919876543299", "role": role}).status_code
            == 403
        )
    assert (
        client.post("/api/auth/otp/request", json={"mobile": "+919876543299", "role": "ADMIN"}).status_code
        == 422
    )
    assert (
        client.post(
            base + "/workers",
            headers=owner,
            json={"name": "Escalate", "mobile": "+919876543213", "role": "OWNER"},
        ).status_code
        == 422
    )
    assert client.put(base + "/settings", headers=auth, json={}).status_code == 403


def test_atomic_checkin_checkout_and_unique_index(client, setup_shop):
    owner, _, base, attendance = paths(setup_shop)
    configure(client, owner, base, attendance_mode="CHECK_IN_OUT")
    for operation in ["check-in", "check-out"]:
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(
                pool.map(
                    lambda _: client.post(attendance + "/" + operation, headers=owner).status_code, range(8)
                )
            )
        assert results.count(200) == 1
        assert results.count(409) == 7
    record = client.app.state.db.attendance.find_one({})
    record["_id"] = "duplicate"
    with pytest.raises(DuplicateKeyError):
        client.app.state.db.attendance.insert_one(record)


def test_overnight_shift_and_mode_change_preserve_open_shift(client, setup_shop, monkeypatch):
    from app.routers import attendance as module

    owner, _, base, attendance = paths(setup_shop)
    configure(client, owner, base, attendance_mode="CHECK_IN_OUT")
    timestamp = now().replace(hour=18, minute=29, second=0, microsecond=0)
    monkeypatch.setattr(module, "now", lambda: timestamp)
    first = client.post(attendance + "/check-in", headers=owner).json()
    timestamp += timedelta(minutes=2)
    configure(client, owner, base, attendance_mode="CHECK_IN_ONLY")
    today = client.get(base + "/attendance/today", headers=owner).json()
    assert today["date"] != first["date"]
    assert today["rows"][0]["active_shift"]["date"] == first["date"]
    assert client.post(attendance + "/check-in", headers=owner).status_code == 409
    assert client.post(attendance + "/check-out", headers=owner).json()["date"] == first["date"]
    next_day = client.post(attendance + "/check-in", headers=owner).json()
    assert next_day["attendance_mode"] == "CHECK_IN_ONLY"
    assert not next_day["is_open"]


def test_legacy_shop_defaults_and_admin_mapping(client, setup_shop):
    owner, shop, _, _ = setup_shop
    client.app.state.db.shops.update_one({"_id": shop}, {"$unset": {"settings": ""}})
    assert (
        client.get(f"/api/shops/{shop}/settings", headers=owner).json()["attendance_mode"] == "CHECK_IN_ONLY"
    )
    manager_id, manager = manager_login(client, setup_shop)
    client.app.state.db.memberships.update_one({"_id": manager_id}, {"$set": {"role": "ADMIN"}})
    assert client.get("/api/auth/me", headers=manager).json()["memberships"][0]["role"] == "MANAGER"
    # Legacy ADMIN is no longer a route to owner privileges through the owner portal.
    owner_portal = login(client, "+919876543212", "OWNER")
    assert client.get(f"/api/shops/{shop}/workers", headers=owner_portal).status_code == 403
    assert client.get(f"/api/shops/{shop}/attendance/today", headers=manager).status_code == 200


def test_reset_and_mobile_reassignment(client, setup_shop):
    owner, shop, worker, auth = setup_shop
    _, _, base, attendance = paths(setup_shop)
    day = client.post(attendance + "/check-in", headers=owner).json()["date"]
    assert (
        client.put(attendance, headers=owner, json={"date": day, "status": "NOT_MARKED"}).status_code == 200
    )
    assert client.post(attendance + "/check-in", headers=owner).status_code == 200
    assert (
        client.patch(
            base + "/workers/" + worker,
            headers=owner,
            json={"name": "Asha", "mobile": "+919876543255", "active": True},
        ).status_code
        == 200
    )
    assert client.get(base + "/me/attendance/today", headers=auth).status_code == 403
    replacement = login(client, "+919876543255", "WORKER")
    assert (
        client.get(base + "/me/attendance/today", headers=replacement).json()["attendance"]["status"]
        == "PRESENT"
    )
