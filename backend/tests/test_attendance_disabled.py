from test_face_attendance import Camera, setting
from test_flow import configure, manager_login


def test_disabled_attendance_blocks_all_roles_preserves_history_and_resumes(client, setup_shop):
    owner, shop, worker, worker_auth = setup_shop
    _, manager = manager_login(client, setup_shop)
    base = f"/api/shops/{shop}"
    path = base + f"/workers/{worker}/attendance"
    arrival = client.post(path + "/check-in", headers=owner)
    assert arrival.status_code == 200
    original = client.app.state.db.attendance.find_one({"worker_id": worker})
    configure(client, owner, base, attendance_enabled=False)
    for auth in (owner, manager, worker_auth):
        for route in (
            "/attendance/today",
            "/attendance/register",
            "/attendance/activity",
            "/me/attendance",
            "/me/attendance/today",
            f"/workers/{worker}/attendance",
        ):
            assert client.get(base + route, headers=auth).status_code == 403
        for route in (
            path + "/check-in",
            path + "/check-out",
            base + "/me/attendance/check-in",
            base + "/me/attendance/check-out",
        ):
            assert client.post(route, headers=auth).status_code == 403
        assert (
            client.put(
                path, headers=auth, json={"date": arrival.json()["date"], "status": "ABSENT"}
            ).status_code
            == 403
        )
        membership = client.get("/api/auth/me", headers=auth).json()["memberships"][0]
        assert membership["shop"]["settings"]["attendance_enabled"] is False
        assert not membership["permissions"]["manage_attendance"]
        assert not membership["permissions"]["view_own_attendance"]
        assert not membership["permissions"]["mark_own_attendance"]
    assert client.app.state.db.attendance.find_one({"worker_id": worker}) == original
    assert client.get(base + "/team", headers=owner).status_code == 200
    assert (
        client.put(base + "/settings", headers=manager, json={"attendance_enabled": True}).status_code == 403
    )
    client.app.state.face_engine = Camera()
    assert setting(client, owner, shop, enabled=True).status_code == 403
    configure(client, owner, base, attendance_enabled=True)
    assert client.get(base + "/attendance/today", headers=owner).status_code == 200
    assert client.get(path, headers=owner, params={"month": arrival.json()["date"][:7]}).status_code == 200
    assert setting(client, owner, shop, enabled=True).status_code == 200


def test_disabled_shop_stops_paired_station_and_preserves_enrollment(client, setup_shop):
    from test_face_attendance import connect, enroll, scan

    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    enroll(client, owner, shop, worker, device)
    profiles = client.app.state.db.face_shops.find_one({"_id": shop})["profiles"]
    base = f"/api/shops/{shop}"
    configure(client, owner, base, attendance_enabled=False)
    assert client.get("/api/face-station/status").json()["enabled"] is False
    assert scan(client).status_code == 403
    assert client.post(base + "/face/pairing", headers=owner).status_code == 403
    assert (
        client.post(
            base + "/face/enrollments",
            headers=owner,
            json={"member_id": worker, "device_id": device, "employee_informed": True},
        ).status_code
        == 403
    )
    assert client.app.state.db.face_shops.find_one({"_id": shop})["profiles"] == profiles
    configure(client, owner, base, attendance_enabled=True)
    assert scan(client).status_code == 200


def test_manual_attendance_defaults_and_settings_round_trip(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    base = f"/api/shops/{shop}"
    # Older shops without the new setting stay enabled, rather than opt-out.
    client.app.state.db.shops.update_one({"_id": shop}, {"$unset": {"settings.attendance_enabled": ""}})
    settings = client.get(base + "/settings", headers=owner).json()
    assert settings["attendance_enabled"] is True
    membership = client.get("/api/auth/me", headers=owner).json()["memberships"][0]
    assert membership["shop"]["face_attendance_enabled"] is False
    assert membership["permissions"]["manage_attendance"] is True
    # Match the complete mobile form payload, including shop details.
    for enabled in (False, True):
        settings["attendance_enabled"] = enabled
        response = client.put(
            base + "/settings", headers=owner, json={**settings, "shop_name": "My shop", "language": "en"}
        )
        assert response.status_code == 200, response.text
        settings = response.json()
        assert settings["attendance_enabled"] is enabled
    assert client.post(base + f"/workers/{worker}/attendance/check-in", headers=owner).status_code == 200
    new_shop = client.post(
        "/api/shops", headers=owner, json={"name": "New manual shop", "timezone": "Asia/Kolkata"}
    )
    assert new_shop.status_code == 201
    assert new_shop.json()["settings"]["attendance_enabled"] is True
