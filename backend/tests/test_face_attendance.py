"""Real Mongo authorization/state tests; only camera inference is replaced with known vectors."""

import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from conftest import login
from cryptography.fernet import Fernet
from fastapi import HTTPException

from app.db import now
from app.face_engine import MODEL_VERSION, FaceEngine, rank, seal
from app.face_store import mutate

WEB = {"X-Hishob-Client": "web", "Origin": "http://testserver"}


class Camera:
    def ready(self):
        pass

    def extract(self, frames):
        if frames == ["unknown"] * 3:
            return [[0.0, 1.0, 0.0]] * 3
        if frames == ["bad"] * 3:
            raise HTTPException(422, "Keep exactly one face in the camera and try again.")
        return [[1.0, 0.0, 0.0]] * 3


def setting(client, owner, shop, **patch):
    data = client.get(f"/api/shops/{shop}/face", headers=owner).json()
    body = {
        k: data[k] for k in ["revision", "enabled", "manager_can_enroll_workers", "allow_manager_attendance"]
    }
    return client.put(
        f"/api/shops/{shop}/face/settings",
        headers=owner,
        json={**body, "supervised_use_acknowledged": True, **patch},
    )


def connect(client, owner, shop):
    client.headers["X-Hishob-Shop"] = shop
    client.app.state.face_engine = Camera()
    assert setting(client, owner, shop, enabled=True).status_code == 200
    code = client.post(f"/api/shops/{shop}/face/pairing", headers=owner).json()["code"]
    result = client.post("/api/face-station/pair", headers=WEB, json={"code": code, "name": "Entrance"})
    assert result.status_code == 200, result.text
    device = client.get(f"/api/shops/{shop}/face", headers=owner).json()["devices"][0]["id"]
    assert client.post(f"/api/shops/{shop}/face/devices/{device}/approve", headers=owner).status_code == 200
    return device


def enroll(client, owner, shop, worker, device):
    grant = client.post(
        f"/api/shops/{shop}/face/enrollments",
        headers=owner,
        json={"member_id": worker, "device_id": device, "employee_informed": True},
    )
    assert grant.status_code == 200, grant.text
    grant_id = grant.json()["id"]
    captured = client.post(
        f"/api/face-station/enrollments/{grant_id}/capture", headers=WEB, json={"frames": ["sample"] * 3}
    )
    assert captured.status_code == 200, captured.text
    confirmed = client.post(f"/api/shops/{shop}/face/enrollments/{grant_id}/confirm", headers=owner)
    assert confirmed.status_code == 200, confirmed.text
    return grant_id


def scan(client, action="IN", request_id=None, frames=None):
    return client.post(
        "/api/face-station/scan",
        headers=WEB,
        json={"request_id": request_id or str(uuid4()), "action": action, "frames": frames or ["sample"] * 3},
    )


def test_full_enrollment_attendance_and_retry(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    enroll(client, owner, shop, worker, device)
    db = client.app.state.db
    stored = db.face_shops.find_one({"_id": shop})["profiles"][worker]
    assert stored["model"] == MODEL_VERSION
    assert "sample" not in stored["template"]
    assert db.face_enrollments.count_documents({}) == 0
    assert scan(client, frames=["unknown"] * 3).status_code == 422
    assert scan(client, frames=["bad"] * 3).status_code == 422
    request_id = str(uuid4())
    first = scan(client, request_id=request_id)
    assert first.status_code == 200, first.text
    assert first.json()["name"] == "Asha"
    assert scan(client, request_id=request_id).json() == first.json()
    assert scan(client, "OUT", request_id=request_id).status_code == 409
    assert scan(client).json()["already_recorded"]
    record = db.attendance.find_one({"shop_id": shop})
    assert record["source"] == "FACE" and not record["is_open"]
    assert len(record["face_receipts"]) == 1
    assert record["edits"][-1]["device_id"] == device
    assert scan(client, "OUT").status_code == 409


def test_pending_one_use_pairing_csrf_and_isolation(client, setup_shop):
    owner, shop, _, worker_auth = setup_shop
    client.app.state.face_engine = Camera()
    assert setting(client, owner, shop, enabled=True).status_code == 200
    assert client.get(f"/api/shops/{shop}/face", headers=worker_auth).status_code == 403
    code = client.post(f"/api/shops/{shop}/face/pairing", headers=owner).json()["code"]
    body = {"code": code, "name": "Entrance"}
    assert client.post("/api/face-station/pair", json=body).status_code == 403
    assert (
        client.post(
            "/api/face-station/pair", headers={**WEB, "Origin": "https://evil.example"}, json=body
        ).status_code
        == 403
    )
    result = client.post("/api/face-station/pair", headers=WEB, json=body)
    assert "HttpOnly" in result.headers["set-cookie"]
    assert "SameSite=strict" in result.headers["set-cookie"]
    assert client.post("/api/face-station/pair", headers=WEB, json=body).status_code == 400
    client.headers["X-Hishob-Shop"] = shop
    assert scan(client).status_code == 403
    assert client.get(f"/api/shops/{shop}/team").status_code == 401
    other_owner = login(client, "+919876543219")
    assert client.get(f"/api/shops/{shop}/face", headers=other_owner).status_code == 403
    status = client.get("/api/face-station/status").json()
    assert status["status"] == "PENDING" and not status["enrollment"]
    assert "members" not in status


def test_enrollment_requires_informed_employee_and_live_authorization(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    url = f"/api/shops/{shop}/face/enrollments"
    body = {"member_id": worker, "device_id": device}
    assert client.post(url, headers=owner, json=body).status_code == 422
    grant = client.post(url, headers=owner, json={**body, "employee_informed": True}).json()["id"]
    assert client.post(f"{url}/{grant}/confirm", headers=owner).status_code == 409
    client.app.state.db.memberships.update_one({"_id": worker}, {"$set": {"active": False}})
    assert (
        client.post(
            f"/api/face-station/enrollments/{grant}/capture", headers=WEB, json={"frames": ["sample"] * 3}
        ).status_code
        == 404
    )
    assert client.get("/api/face-station/status").json()["enrollment"] is None


def test_manager_permissions_rechecked_and_not_self_enrollment(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    manager_id = client.post(
        f"/api/shops/{shop}/managers", headers=owner, json={"name": "Manager", "mobile": "+919876543212"}
    ).json()["id"]
    manager = login(client, "+919876543212", "MANAGER")
    url = f"/api/shops/{shop}/face/enrollments"
    body = {"member_id": worker, "device_id": device, "employee_informed": True}
    assert client.post(url, headers=manager, json=body).status_code == 403
    assert setting(client, owner, shop, manager_can_enroll_workers=True).status_code == 200
    assert client.post(url, headers=manager, json={**body, "member_id": manager_id}).status_code == 403
    grant = client.post(url, headers=manager, json=body).json()["id"]
    assert setting(client, owner, shop, manager_can_enroll_workers=False).status_code == 200
    assert (
        client.post(
            f"/api/face-station/enrollments/{grant}/capture", headers=WEB, json={"frames": ["sample"] * 3}
        ).status_code
        == 403
    )
    assert client.post(f"/api/shops/{shop}/face/pairing", headers=manager).status_code == 403
    assert client.post(f"/api/shops/{shop}/face/devices/{device}/revoke", headers=manager).status_code == 403


def test_duplicate_face_cannot_be_assigned_to_second_employee(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    enroll(client, owner, shop, worker, device)
    second = client.post(
        f"/api/shops/{shop}/workers", headers=owner, json={"name": "Other", "mobile": "+919876543213"}
    ).json()["id"]
    grant = client.post(
        f"/api/shops/{shop}/face/enrollments",
        headers=owner,
        json={"member_id": second, "device_id": device, "employee_informed": True},
    ).json()["id"]
    assert (
        client.post(
            f"/api/face-station/enrollments/{grant}/capture", headers=WEB, json={"frames": ["sample"] * 3}
        ).status_code
        == 200
    )
    result = client.post(f"/api/shops/{shop}/face/enrollments/{grant}/confirm", headers=owner)
    assert result.status_code == 409 and "resembles" in result.text
    assert second not in client.app.state.db.face_shops.find_one({"_id": shop})["profiles"]


def test_disable_revoke_remove_and_membership_reassignment(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    enroll(client, owner, shop, worker, device)
    assert setting(client, owner, shop, enabled=False).status_code == 200
    assert scan(client).status_code == 403
    assert setting(client, owner, shop, enabled=True).status_code == 200
    db = client.app.state.db
    original = db.memberships.find_one({"_id": worker})["user_id"]
    db.memberships.update_one({"_id": worker}, {"$set": {"user_id": "different-user"}})
    assert scan(client).status_code == 422
    db.memberships.update_one({"_id": worker}, {"$set": {"user_id": original}})
    assert client.post(f"/api/shops/{shop}/face/members/{worker}/remove", headers=owner).status_code == 200
    assert scan(client).status_code == 422
    assert db.face_shops.find_one({"_id": shop})["profiles"] == {}
    assert client.post(f"/api/shops/{shop}/face/devices/{device}/revoke", headers=owner).status_code == 200
    assert scan(client).status_code == 401


def test_in_out_mode_switch_and_manual_conflicts(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    enroll(client, owner, shop, worker, device)
    db = client.app.state.db
    db.shops.update_one({"_id": shop}, {"$set": {"settings.attendance_mode": "CHECK_IN_OUT"}})
    assert scan(client).status_code == 200
    db.shops.update_one({"_id": shop}, {"$set": {"settings.attendance_mode": "CHECK_IN_ONLY"}})
    assert client.get("/api/face-station/status").json()["allow_out"]
    request_id = str(uuid4())
    result = scan(client, "OUT", request_id)
    assert result.status_code == 200
    assert scan(client, "OUT", request_id).json() == result.json()
    assert not db.attendance.find_one({"shop_id": shop})["is_open"]
    db.attendance.delete_many({"shop_id": shop})
    day = now().astimezone(ZoneInfo("Asia/Kolkata")).date().isoformat()
    assert (
        client.put(
            f"/api/shops/{shop}/workers/{worker}/attendance",
            headers=owner,
            json={"date": day, "status": "LEAVE", "note": "Approved leave"},
        ).status_code
        == 200
    )
    assert scan(client).status_code == 409
    assert db.attendance.find_one({"shop_id": shop})["status"] == "LEAVE"


def test_expiry_rate_limits_and_body_limits(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    grant = client.post(
        f"/api/shops/{shop}/face/enrollments",
        headers=owner,
        json={"member_id": worker, "device_id": device, "employee_informed": True},
    ).json()["id"]
    client.app.state.db.face_enrollments.update_one(
        {"_id": grant}, {"$set": {"expires_at": now() - timedelta(seconds=1)}}
    )
    assert (
        client.post(
            f"/api/face-station/enrollments/{grant}/capture", headers=WEB, json={"frames": ["sample"] * 3}
        ).status_code
        == 410
    )
    assert scan(client, frames=["x" * 500000] * 3).status_code == 413
    for _ in range(31):
        response = scan(client)
    assert response.status_code == 429


def test_concurrent_check_ins_are_atomic(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    enroll(client, owner, shop, worker, device)
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: scan(client), range(4)))
    assert all(result.status_code == 200 for result in results)
    db = client.app.state.db
    assert db.attendance.count_documents({"shop_id": shop}) == 1
    assert len(db.attendance.find_one({"shop_id": shop})["face_receipts"]) == 1


def test_model_files_load_and_reject_non_faces(client):
    import cv2
    import numpy as np

    engine = FaceEngine(client.app.state.settings)
    engine.ready()
    _, image = cv2.imencode(".jpg", np.full((480, 640, 3), 128, np.uint8))
    frame = base64.b64encode(image).decode()
    with pytest.raises(HTTPException) as error:
        engine.extract([frame] * 3)
    assert error.value.status_code == 422
    for frame in ["invalid base64", base64.b64encode(b"not an image").decode()]:
        with pytest.raises(HTTPException) as error:
            engine.extract([frame] * 3)
        assert error.value.status_code == 422


def test_templates_require_correct_key_and_ambiguity_is_rejected(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    enroll(client, owner, shop, worker, device)
    second = client.post(
        f"/api/shops/{shop}/workers", headers=owner, json={"name": "Similar", "mobile": "+919876543214"}
    ).json()["id"]
    db = client.app.state.db
    member = db.memberships.find_one({"_id": second})

    def change(doc):
        doc["profiles"][second] = {
            "user_id": member["user_id"],
            "model": MODEL_VERSION,
            "template": seal(client.app.state.settings, [[0.99, 0.141, 0.0]]),
        }

    mutate(db, shop, change)
    assert scan(client).status_code == 422
    assert db.attendance.count_documents({}) == 0
    profiles = db.face_shops.find_one({"_id": shop})["profiles"]
    client.app.state.settings.face_encryption_key = Fernet.generate_key().decode()
    with pytest.raises(HTTPException) as error:
        rank([[1.0, 0.0, 0.0]], profiles, client.app.state.settings)
    assert error.value.status_code == 503


def test_manager_face_attendance_is_separate_from_personal_marking(client, setup_shop):
    owner, shop, _, _ = setup_shop
    device = connect(client, owner, shop)
    manager_id = client.post(
        f"/api/shops/{shop}/managers", headers=owner, json={"name": "Manager", "mobile": "+919876543215"}
    ).json()["id"]
    enroll(client, owner, shop, manager_id, device)
    assert scan(client).status_code == 403
    assert setting(client, owner, shop, allow_manager_attendance=True).status_code == 200
    assert scan(client).status_code == 200
    manager = login(client, "+919876543215", "MANAGER")
    assert client.post(f"/api/shops/{shop}/me/attendance/check-in", headers=manager).status_code == 403


def test_overnight_checkout_preserves_original_date(client, setup_shop):

    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    enroll(client, owner, shop, worker, device)
    db = client.app.state.db
    previous = now() - timedelta(days=1)
    day = previous.astimezone(ZoneInfo("Asia/Kolkata")).date().isoformat()
    db.attendance.insert_one(
        {
            "_id": str(uuid4()),
            "shop_id": shop,
            "worker_id": worker,
            "date": day,
            "check_in": previous,
            "check_out": None,
            "status": "PRESENT",
            "is_open": True,
        }
    )
    assert scan(client).status_code == 409
    result = scan(client, "OUT")
    assert result.status_code == 200
    record = db.attendance.find_one({"shop_id": shop})
    assert record["date"] == day and not record["is_open"]
    assert record["check_out"].isoformat() == result.json()["recorded_at"]


def test_confirmation_retry_and_changed_scan_payload(client, setup_shop):
    owner, shop, worker, _ = setup_shop
    device = connect(client, owner, shop)
    grant_id = enroll(client, owner, shop, worker, device)
    assert (
        client.post(f"/api/shops/{shop}/face/enrollments/{grant_id}/confirm", headers=owner).status_code
        == 200
    )
    request_id = str(uuid4())
    assert scan(client, request_id=request_id).status_code == 200
    assert scan(client, request_id=request_id, frames=["unknown"] * 3).status_code == 409
    overview = client.get(f"/api/shops/{shop}/face", headers=owner).json()
    assert overview["events"][0]["actor_name"]
    assert "template" not in str(overview["enrollments"])
    assert client.post(f"/api/shops/{shop}/face/remove-all", headers=owner).status_code == 200
    assert scan(client).status_code == 422
    assert client.app.state.db.attendance.count_documents({"shop_id": shop}) == 1


def test_station_qr_decodes_to_trusted_url_without_credentials(client, setup_shop):
    import cv2
    import numpy as np

    owner, shop, _, worker_auth = setup_shop
    url = f"http://testserver/api/face-station/?shop={shop}"
    endpoint = f"/api/shops/{shop}/face/station-qr"
    response = client.post(endpoint, headers=owner, json={"url": url})
    assert response.status_code == 200, response.text
    image = cv2.imdecode(
        np.frombuffer(base64.b64decode(response.json()["image"].split(",")[1]), np.uint8), cv2.IMREAD_COLOR
    )
    decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(image)
    assert decoded == url
    assert client.post(endpoint, headers=worker_auth, json={"url": url}).status_code == 403
    for invalid in [
        "http://[",
        "https://evil.example/api/face-station/",
        url + "?token=secret",
        "http://testserver/api/auth/me",
        "http://user:password@testserver/api/face-station/",
    ]:
        assert client.post(endpoint, headers=owner, json={"url": invalid}).status_code == 422
    client.post(
        f"/api/shops/{shop}/managers", headers=owner, json={"name": "Manager", "mobile": "+919876543216"}
    )
    manager = login(client, "+919876543216", "MANAGER")
    assert client.post(endpoint, headers=manager, json={"url": url}).status_code == 200


def test_station_shop_binding_disconnect_and_same_face_across_shops(client, setup_shop):
    owner, first, worker_a, _ = setup_shop
    device_a = connect(client, owner, first)
    enroll(client, owner, first, worker_a, device_a)
    second = client.post(
        "/api/shops", headers=owner, json={"name": "Nampali", "timezone": "Asia/Kolkata"}
    ).json()["id"]
    worker_b = client.post(
        f"/api/shops/{second}/workers", headers=owner, json={"name": "Asha", "mobile": "+919876543211"}
    ).json()["id"]
    assert setting(client, owner, second, enabled=True).status_code == 200
    code_b = client.post(f"/api/shops/{second}/face/pairing", headers=owner).json()["code"]
    body = {"code": code_b, "name": "Nampali entrance"}
    # A valid code for B cannot be consumed from A's link.
    assert client.post("/api/face-station/pair", headers=WEB, json=body).status_code == 409
    client.headers["X-Hishob-Shop"] = second
    # Nor may pairing silently overwrite the currently paired A station cookie.
    assert client.post("/api/face-station/pair", headers=WEB, json=body).status_code == 409
    status = client.get("/api/face-station/status").json()
    assert status["shop_id"] == first and status["device_id"] == device_a
    assert scan(client).status_code == 409
    assert client.app.state.db.attendance.count_documents({}) == 0
    # Cross-shop enrollment capture also fails before inference.
    grant = client.post(
        f"/api/shops/{first}/face/enrollments",
        headers=owner,
        json={"member_id": worker_a, "device_id": device_a, "employee_informed": True},
    ).json()["id"]
    assert (
        client.post(
            f"/api/face-station/enrollments/{grant}/capture", headers=WEB, json={"frames": ["sample"] * 3}
        ).status_code
        == 409
    )
    assert (
        client.post("/api/face-station/disconnect", headers=WEB, json={"device_id": device_a}).status_code
        == 200
    )
    assert client.app.state.db.face_enrollments.count_documents({"shop_id": first}) == 0
    assert client.get("/api/face-station/status").status_code == 401
    assert client.app.state.db.face_shops.find_one({"_id": first})["devices"][0]["status"] == "REVOKED"
    assert client.post(f"/api/shops/{first}/face/pairing", headers=owner).status_code == 200
    # B's code survived both rejected attempts.
    paired = client.post("/api/face-station/pair", headers=WEB, json=body)
    assert paired.status_code == 200, paired.text
    assert paired.json()["shop_id"] == second
    device_b = client.get("/api/face-station/status").json()["device_id"]
    assert (
        client.post(f"/api/shops/{second}/face/devices/{device_b}/approve", headers=owner).status_code == 200
    )
    enroll(client, owner, second, worker_b, device_b)
    # An older tab cannot redirect its scan or revoke B's replacement cookie.
    client.headers["X-Hishob-Shop"] = first
    assert scan(client).status_code == 409
    assert (
        client.post("/api/face-station/disconnect", headers=WEB, json={"device_id": device_a}).status_code
        == 409
    )
    del client.headers["X-Hishob-Shop"]
    assert scan(client).status_code == 409
    client.headers["X-Hishob-Shop"] = second
    result = scan(client)
    assert result.status_code == 200, result.text
    assert result.json()["shop_id"] == second and result.json()["shop_name"] == "Nampali"
    records = list(client.app.state.db.attendance.find({}))
    assert len(records) == 1 and records[0]["shop_id"] == second and records[0]["worker_id"] == worker_b
    # Scoped QR rejects an otherwise valid station address for a different shop.
    assert (
        client.post(
            f"/api/shops/{first}/face/station-qr",
            headers=owner,
            json={"url": f"http://testserver/api/face-station/?shop={second}"},
        ).status_code
        == 422
    )
    assert "Nampali" in client.get(f"/api/face-station/?shop={second}").text
