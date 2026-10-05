from conftest import login
from test_face_attendance import Camera, setting
from test_flow import configure, manager_login


def test_face_mode_blocks_every_manager_manual_route_and_worker_mutations(client, setup_shop):
    owner, shop, worker, worker_auth = setup_shop
    manager_id, manager = manager_login(client, setup_shop)
    base = f"/api/shops/{shop}"
    configure(
        client,
        owner,
        base,
        manager_can_mark_own_attendance=True,
        manager_can_manage_attendance=True,
        attendance_mode="CHECK_IN_OUT",
    )
    opened = client.post(base + "/me/attendance/check-in", headers=manager)
    assert opened.status_code == 200
    day = opened.json()["date"]
    client.app.state.face_engine = Camera()
    assert setting(client, owner, shop, enabled=True).status_code == 200
    for auth in (manager, worker_auth):
        for path in ["/me/attendance", f"/workers/{manager_id}/attendance", f"/workers/{worker}/attendance"]:
            for operation in ("check-in", "check-out"):
                assert client.post(base + path + "/" + operation, headers=auth).status_code == 403
        for target in (worker, manager_id):
            assert (
                client.put(
                    base + f"/workers/{target}/attendance",
                    headers=auth,
                    json={"date": day, "status": "PRESENT"},
                ).status_code
                == 403
            )
    me = client.get("/api/auth/me", headers=manager).json()["memberships"][0]
    assert me["permissions"]["mark_own_attendance"] is False
    assert me["permissions"]["manage_attendance"] is False
    today = client.get(base + "/me/attendance/today", headers=manager).json()
    assert today["face_attendance_enabled"] is True
    assert today["permissions"]["mark_own_attendance"] is False
    rows = client.get(base + "/attendance/today", headers=manager).json()["rows"]
    assert all(not row["can_mark"] and not row["can_edit"] for row in rows)
    # Owners retain explicit, separately attributed manual fallback.
    assert client.post(base + f"/workers/{manager_id}/attendance/check-out", headers=owner).status_code == 200
    assert setting(client, owner, shop, enabled=False).status_code == 200
    assert (
        client.get(base + "/me/attendance/today", headers=manager).json()["permissions"][
            "mark_own_attendance"
        ]
        is True
    )
    assert client.post(base + f"/workers/{worker}/attendance/check-in", headers=manager).status_code == 200


def test_activity_atomic_snapshots_search_filters_roles_and_shop_isolation(client, setup_shop):
    owner, shop, worker, worker_auth = setup_shop
    _, manager = manager_login(client, setup_shop)
    base = f"/api/shops/{shop}"
    configure(client, owner, base, attendance_mode="CHECK_IN_OUT")
    path = base + f"/workers/{worker}/attendance"
    arrival = client.post(path + "/check-in", headers=manager).json()
    departure = client.post(path + "/check-out", headers=manager).json()
    corrected = client.put(
        path,
        headers=owner,
        json={"date": arrival["date"], "status": "HALF_DAY", "note": "Appointment $check"},
    )
    assert corrected.status_code == 200, corrected.text
    edits = corrected.json()["edits"]
    assert len(edits) == 3
    assert edits[1]["before"]["check_out"] is None
    assert edits[1]["after"]["check_out"] == departure["check_out"]
    assert edits[2]["before"]["status"] == "PRESENT"
    assert edits[2]["after"]["status"] == "HALF_DAY"
    assert edits[2]["after"]["note"] == "Appointment $check"
    assert edits[0]["actor_name"] == "Ravi"
    assert edits[0]["employee_name"] == "Asha"
    assert "_audit_before" not in corrected.json()
    endpoint = base + "/attendance/activity"
    assert client.get(endpoint, headers=worker_auth).status_code == 403
    for query, count in [
        ("asha", 3),
        ("Ravi", 2),
        ("$check", 1),
        ("CHECK_OUT", 1),
        ("9876543211", 3),
        (".*", 0),
        ("nobody", 0),
    ]:
        result = client.get(endpoint, headers=manager, params={"q": query})
        assert result.status_code == 200, result.text
        assert len(result.json()["events"]) == count, query
    assert len(client.get(endpoint, headers=owner, params={"source": "MANUAL"}).json()["events"]) == 3
    assert client.get(endpoint, headers=owner, params={"source": "FACE"}).json()["events"] == []
    first = client.get(endpoint, headers=owner, params={"limit": 2}).json()
    second = client.get(endpoint, headers=owner, params={"limit": 2, "offset": 2}).json()
    assert first["has_more"] is True and second["has_more"] is False
    assert not ({e["id"] for e in first["events"]} & {e["id"] for e in second["events"]})
    assert (
        client.get(endpoint, headers=owner, params={"start": "2000-01-01", "end": "2000-01-31"}).json()[
            "events"
        ]
        == []
    )
    assert (
        client.get(endpoint, headers=owner, params={"start": "2026-02-02", "end": "2026-02-01"}).status_code
        == 422
    )
    stranger = login(client, "+919999999999")
    assert client.get(endpoint, headers=stranger).status_code == 403
    # Retained legacy logs remain searchable; new events never truncate them.
    db = client.app.state.db
    old = {
        "at": db.attendance.find_one({"worker_id": worker})["created_at"],
        "by": "legacy",
        "status": "PRESENT",
    }
    db.attendance.update_one({"worker_id": worker}, {"$set": {"edits": [old] * 105}})
    response = client.put(path, headers=owner, json={"date": arrival["date"], "status": "LEAVE"})
    assert len(response.json()["edits"]) == 106
    older = client.get(endpoint, headers=owner, params={"q": "legacy"}).json()["events"]
    assert older and all(e["legacy"] for e in older)


def test_owner_can_delegate_and_revoke_face_worker_corrections(client, setup_shop):
    owner, shop, worker, worker_auth = setup_shop
    manager_id, manager = manager_login(client, setup_shop)
    base = f"/api/shops/{shop}"
    client.app.state.face_engine = Camera()
    assert setting(client, owner, shop, enabled=True).status_code == 200
    configure(
        client,
        owner,
        base,
        manager_can_correct_face_attendance=True,
        manager_can_manage_attendance=False,
        attendance_mode="CHECK_IN_OUT",
    )
    path = base + f"/workers/{worker}/attendance"
    arrival = client.post(path + "/check-in", headers=manager)
    assert arrival.status_code == 200, arrival.text
    assert client.post(path + "/check-out", headers=manager).status_code == 200
    body = {"date": arrival.json()["date"], "status": "HALF_DAY", "note": "Scan failed"}
    corrected = client.put(path, headers=manager, json=body)
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["edits"][-1]["actor_name"] == "Ravi"
    for target in (manager_id,):
        assert (
            client.put(base + f"/workers/{target}/attendance", headers=manager, json=body).status_code == 403
        )
    assert client.post(base + "/me/attendance/check-in", headers=manager).status_code == 403
    assert client.put(path, headers=worker_auth, json=body).status_code == 403
    settings = client.get(base + "/settings", headers=owner).json()
    assert client.put(base + "/settings", headers=manager, json=settings).status_code == 403
    configure(client, owner, base, manager_can_correct_face_attendance=False)
    assert client.put(path, headers=manager, json=body).status_code == 403
    assert client.post(path + "/check-in", headers=manager).status_code == 403


def test_calendar_counts_match_register_and_protect_access(client, setup_shop):
    from datetime import timedelta

    from app.db import now

    owner, shop, worker, worker_auth = setup_shop
    _, manager = manager_login(client, setup_shop)
    base = f"/api/shops/{shop}"
    today = client.get(base + "/attendance/today", headers=owner).json()["date"]
    endpoint = base + "/attendance/calendar"
    month = today[:7]
    assert client.get(endpoint, headers=worker_auth, params={"month": month}).status_code == 403
    assert client.get(endpoint, headers=owner, params={"month": "2026-13"}).status_code == 422
    client.app.state.db.memberships.update_one(
        {"_id": worker}, {"$set": {"created_at": now() - timedelta(days=40)}}
    )
    client.put(
        base + f"/workers/{worker}/attendance", headers=owner, json={"date": today, "status": "ABSENT"}
    )
    client.app.state.db.memberships.update_one({"_id": worker}, {"$set": {"active": False}})
    result = client.get(endpoint, headers=manager, params={"month": month})
    assert result.status_code == 200
    days = result.json()["days"]
    assert all(day["date"] <= today for day in days)
    for day in days:
        register = client.get(
            base + "/attendance/register", headers=owner, params={"day": day["date"]}
        ).json()["rows"]
        assert day["total"] == len(register)
        for status, count in day["counts"].items():
            assert count == sum(row["attendance"]["status"] == status for row in register)
    assert days[-1]["counts"]["ABSENT"] == 1
    assert days[-1]["counts"]["NOT_MARKED"] == 1
    assert all(day["total"] == 0 for day in days[:-1])
