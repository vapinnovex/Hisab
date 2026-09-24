from concurrent.futures import ThreadPoolExecutor

import pytest
from conftest import login


def status(client, auth):
    return client.get("/api/auth/me", headers=auth).status_code


@pytest.mark.parametrize("role", ["WORKER", "MANAGER"])
def test_staff_successful_login_replaces_previous_session(client, setup_shop, role):
    owner, shop, _, worker = setup_shop
    mobile = "+919876543211"
    if role == "MANAGER":
        mobile = "+919876543212"
        client.post(f"/api/shops/{shop}/managers", headers=owner, json={"name": "Ravi", "mobile": mobile})
        worker = login(client, mobile, role)
    challenge = client.post("/api/auth/otp/request", json={"mobile": mobile, "role": role}).json()
    assert status(client, worker) == 200
    assert (
        client.post(
            "/api/auth/otp/verify", json={"challenge_id": challenge["challenge_id"], "code": "000000"}
        ).status_code
        == 400
    )
    assert status(client, worker) == 200
    result = client.post(
        "/api/auth/otp/verify", json={"challenge_id": challenge["challenge_id"], "code": "123456"}
    ).json()
    latest = {"Authorization": "Bearer " + result["access_token"]}
    assert status(client, worker) == 401
    assert status(client, latest) == 200
    assert status(client, owner) == 200


def test_owner_three_sessions_oldest_removed_and_logout_frees_slot(client):
    sessions = [login(client) for _ in range(3)]
    assert [status(client, s) for s in sessions] == [200, 200, 200]
    sessions.append(login(client))
    assert [status(client, s) for s in sessions] == [401, 200, 200, 200]
    assert client.post("/api/auth/logout", headers=sessions[2]).status_code == 204
    sessions.append(login(client))
    assert [status(client, s) for s in sessions] == [401, 200, 401, 200, 200]


def test_staff_limit_shared_across_worker_manager_portals_but_owner_separate(client, setup_shop):
    owner, shop, _, worker = setup_shop
    client.post(
        f"/api/shops/{shop}/managers", headers=owner, json={"name": "Asha manager", "mobile": "+919876543211"}
    )
    manager = login(client, "+919876543211", "MANAGER")
    assert status(client, worker) == 401
    same_user_owner = login(client, "+919876543211", "OWNER")
    assert status(client, manager) == 200
    replacement = login(client, "+919876543211", "WORKER")
    assert status(client, manager) == 401
    assert status(client, replacement) == status(client, same_user_owner) == 200


@pytest.mark.parametrize("role,limit", [("OWNER", 3), ("WORKER", 1)])
def test_concurrent_otp_verifications_never_exceed_session_limit(client, setup_shop, role, limit):
    mobile = "+919876543210" if role == "OWNER" else "+919876543211"
    challenges = [
        client.post("/api/auth/otp/request", json={"mobile": mobile, "role": role}).json()["challenge_id"]
        for _ in range(5)
    ]

    def verify(challenge):
        result = client.post("/api/auth/otp/verify", json={"challenge_id": challenge, "code": "123456"})
        assert result.status_code == 200, result.text
        return {"Authorization": "Bearer " + result.json()["access_token"]}

    with ThreadPoolExecutor(max_workers=5) as pool:
        sessions = list(pool.map(verify, challenges))
    assert sum(status(client, s) == 200 for s in sessions) == limit


def test_legacy_sessions_are_bounded_and_owner_sessions_carried_forward(client):
    sessions = [login(client) for _ in range(3)]
    db = client.app.state.db
    db.users.update_many({}, {"$unset": {"session_slots": ""}})
    db.sessions.update_many({}, {"$unset": {"slot_managed": ""}})
    assert all(status(client, s) == 200 for s in sessions)
    new = login(client)
    assert [status(client, s) for s in sessions] == [401, 200, 200]
    assert status(client, new) == 200


def test_expired_owner_slot_does_not_displace_an_active_session(client):
    from datetime import timedelta

    import jwt

    from app.db import now

    sessions = [login(client) for _ in range(3)]
    claims = jwt.decode(sessions[1]["Authorization"].split()[1], options={"verify_signature": False})
    client.app.state.db.sessions.update_one(
        {"_id": claims["jti"]}, {"$set": {"expires_at": now() - timedelta(seconds=1)}}
    )
    sessions.append(login(client))
    assert [status(client, s) for s in sessions] == [200, 401, 200, 200]
