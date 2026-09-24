from datetime import timedelta

from conftest import login

from app.db import now


def otp_body(response):
    assert response.status_code == 200, response.text
    return {"challenge_id": response.json()["challenge_id"], "code": "123456"}


def start_change(client, owner, mobile="+919876543219"):
    return otp_body(client.post("/api/auth/mobile-change/request", headers=owner, json={"mobile": mobile}))


def test_owner_name_validation_and_permissions(client, setup_shop):
    owner, _, _, worker = setup_shop
    assert client.patch("/api/auth/profile", headers=worker, json={"name": "Denied"}).status_code == 403
    for name in ["", "  ", "x", "x" * 101]:
        assert client.patch("/api/auth/profile", headers=owner, json={"name": name}).status_code == 422
    assert (
        client.patch("/api/auth/profile", headers=owner, json={"name": "  Prajwal Patil  "}).json()["name"]
        == "Prajwal Patil"
    )
    assert client.get("/api/auth/me", headers=owner).json()["user"]["name"] == "Prajwal Patil"
    assert (
        client.patch(
            "/api/auth/profile", headers=owner, json={"name": "Valid", "mobile": "+919876543219"}
        ).status_code
        == 422
    )


def test_mobile_change_preserves_identity_and_revokes_old_sessions_and_codes(client, setup_shop):
    owner, shop, worker_id, _ = setup_shop
    other_session = login(client)
    before = client.get("/api/auth/me", headers=owner).json()
    attendance = client.post(
        f"/api/shops/{shop}/workers/{worker_id}/attendance/check-in", headers=owner
    ).json()
    stale_old = otp_body(
        client.post("/api/auth/otp/request", json={"mobile": "+919876543210", "role": "OWNER"})
    )
    stale_new = otp_body(
        client.post("/api/auth/otp/request", json={"mobile": "+919876543219", "role": "OWNER"})
    )
    current = start_change(client, owner)
    new = otp_body(client.post("/api/auth/mobile-change/verify-current", headers=owner, json=current))
    result = client.post("/api/auth/mobile-change/confirm", headers=owner, json=new)
    assert result.status_code == 200, result.text
    updated = {"Authorization": "Bearer " + result.json()["access_token"]}
    after = client.get("/api/auth/me", headers=updated).json()
    assert after["user"]["id"] == before["user"]["id"]
    assert after["user"]["mobile"] == "+919876543219"
    assert after["memberships"] == before["memberships"]
    assert (
        client.get(f"/api/shops/{shop}/attendance/today", headers=updated).json()["rows"][0]["attendance"][
            "id"
        ]
        == attendance["id"]
    )
    for old in [owner, other_session]:
        assert client.get("/api/auth/me", headers=old).status_code == 401
    for stale in [stale_old, stale_new]:
        assert client.post("/api/auth/otp/verify", json=stale).status_code == 400
    relogin = login(client, "+919876543219")
    assert client.get("/api/auth/me", headers=relogin).json()["user"]["id"] == before["user"]["id"]
    old_number = login(client)
    assert client.get("/api/auth/me", headers=old_number).json()["memberships"] == []
    assert client.get(f"/api/shops/{shop}/team", headers=old_number).status_code == 403


def test_change_challenges_are_purpose_session_and_user_bound(client, setup_shop):
    owner, _, _, worker = setup_shop
    assert (
        client.post(
            "/api/auth/mobile-change/request", headers=worker, json={"mobile": "+919876543219"}
        ).status_code
        == 403
    )
    current = start_change(client, owner)
    other = login(client, "+919876543218")
    second_session = login(client)
    for actor in [other, second_session]:
        assert (
            client.post("/api/auth/mobile-change/verify-current", headers=actor, json=current).status_code
            == 400
        )
    assert client.post("/api/auth/otp/verify", json=current).status_code == 400
    assert client.post("/api/auth/mobile-change/confirm", headers=owner, json=current).status_code == 400
    new = otp_body(client.post("/api/auth/mobile-change/verify-current", headers=owner, json=current))
    assert (
        client.post("/api/auth/mobile-change/verify-current", headers=owner, json=current).status_code == 400
    )
    assert client.post("/api/auth/otp/verify", json=new).status_code == 400
    assert (
        client.post(
            "/api/auth/mobile-change/confirm", headers=owner, json={**new, "code": "000000"}
        ).status_code
        == 400
    )
    assert client.post("/api/auth/mobile-change/confirm", headers=owner, json=new).status_code == 200


def test_change_rejects_duplicates_expired_and_exhausted_codes(client, setup_shop):
    owner, _, _, _ = setup_shop
    for number, code in [("+919876543210", 422), ("+919876543211", 409)]:
        assert (
            client.post("/api/auth/mobile-change/request", headers=owner, json={"mobile": number}).status_code
            == code
        )
    current = start_change(client, owner)
    for _ in range(5):
        assert (
            client.post(
                "/api/auth/mobile-change/verify-current", headers=owner, json={**current, "code": "000000"}
            ).status_code
            == 400
        )
    assert (
        client.post("/api/auth/mobile-change/verify-current", headers=owner, json=current).status_code == 400
    )
    current = start_change(client, owner)
    new = otp_body(client.post("/api/auth/mobile-change/verify-current", headers=owner, json=current))
    client.app.state.db.otp_challenges.update_one(
        {"_id": new["challenge_id"]}, {"$set": {"expires_at": now() - timedelta(seconds=1)}}
    )
    assert client.post("/api/auth/mobile-change/confirm", headers=owner, json=new).status_code == 400
    current = start_change(client, owner)
    new = otp_body(client.post("/api/auth/mobile-change/verify-current", headers=owner, json=current))
    # A number can be claimed between requesting and confirming; the unique index is authoritative.
    login(client, "+919876543219")
    assert client.post("/api/auth/mobile-change/confirm", headers=owner, json=new).status_code == 409
    assert client.get("/api/auth/me", headers=owner).json()["user"]["mobile"] == "+919876543210"


def test_concurrent_mobile_changes_only_one_can_win(client, setup_shop):
    from concurrent.futures import ThreadPoolExecutor

    owner, _, _, _ = setup_shop
    confirmations = []
    for mobile in ["+919876543218", "+919876543219"]:
        current = start_change(client, owner, mobile)
        confirmations.append(
            otp_body(client.post("/api/auth/mobile-change/verify-current", headers=owner, json=current))
        )
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda body: client.post("/api/auth/mobile-change/confirm", headers=owner, json=body),
                confirmations,
            )
        )
    assert sorted(result.status_code for result in results) in [[200, 401], [200, 409]]
    winner = next(result for result in results if result.status_code == 200)
    new_auth = {"Authorization": "Bearer " + winner.json()["access_token"]}
    account = client.get("/api/auth/me", headers=new_auth)
    assert account.status_code == 200
    assert account.json()["user"]["auth_version"] == 1
    assert len(account.json()["memberships"]) == 1
    assert client.get("/api/auth/me", headers=owner).status_code == 401
