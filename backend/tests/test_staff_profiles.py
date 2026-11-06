from conftest import PASSWORD

from app.passwords import hash_password, verify_password


def test_multiple_profiles_retry_edit_login_activation_and_history(client, setup_shop):
    owner, shop, _, _ = setup_shop
    base = f"/api/shops/{shop}"
    users_before = client.app.state.db.users.count_documents({})
    payload = {"name": "Same name", "request_id": "create-one"}
    one = client.post(base + "/workers", headers=owner, json=payload).json()
    two = client.post(base + "/workers", headers=owner, json={"name": "Same name"}).json()
    assert one["id"] != two["id"] and not one["login_enabled"] and one["mobile"] == ""
    assert client.app.state.db.users.count_documents({}) == users_before
    assert client.post(base + "/workers", headers=owner, json=payload).json()["id"] == one["id"]
    client.app.state.db.attendance.insert_one(
        {
            "_id": "preserved",
            "shop_id": shop,
            "worker_id": one["id"],
            "date": "2026-11-03",
            "status": "PRESENT",
        }
    )
    client.app.state.db.memberships.update_one(
        {"_id": one["id"]}, {"$set": {"pay_reference": {"revision": 7}}}
    )
    edit = {"name": "Renamed", "mobile": "+919855555095", "active": True, "revision": 0}
    result = client.patch(base + "/workers/" + one["id"], headers=owner, json=edit)
    assert result.status_code == 200 and not result.json()["login_enabled"]
    assert client.patch(base + "/workers/" + one["id"], headers=owner, json=edit).status_code == 409
    assert (
        client.post(
            "/api/auth/password/login",
            json={"role": "WORKER", "mobile": edit["mobile"], "password": PASSWORD},
        ).status_code
        == 401
    )
    code = client.post(base + f"/team/{one['id']}/password-access", headers=owner).json()["setup_code"]
    body = {
        "role": "WORKER",
        "mobile": edit["mobile"],
        "password": PASSWORD,
        "confirm_password": PASSWORD,
        "setup_code": code,
    }
    assert client.post(
        "/api/auth/staff/password/setup", json={**body, "setup_code": "BAD-CODE"}
    ).status_code in (400, 403)
    reply = client.post("/api/auth/staff/password/setup", json=body)
    assert reply.status_code == 200, reply.text
    # Lost response can be retried with proof of the just-created password.
    assert client.post("/api/auth/staff/password/setup", json=body).status_code == 200
    member = client.app.state.db.memberships.find_one({"_id": one["id"]})
    assert member["pay_reference"]["revision"] == 7
    assert client.app.state.db.attendance.find_one({"_id": "preserved"})["worker_id"] == one["id"]
    assert client.post(base + "/managers", headers=owner, json={"name": "No phone"}).status_code == 422


def test_existing_account_requires_current_password_and_sets_new_password(client, setup_shop):
    owner, shop, _, _ = setup_shop
    base = f"/api/shops/{shop}"
    member = client.post(base + "/workers", headers=owner, json={"name": "New profile"}).json()
    mobile = "+919855555096"
    db = client.app.state.db
    db.users.insert_one(
        {
            "_id": "existing-account",
            "mobile": mobile,
            "password_hash": hash_password(PASSWORD),
            "password_reset_required": True,
        }
    )
    edit = {"name": "New profile", "mobile": mobile, "active": True, "revision": 0}
    assert client.patch(base + "/workers/" + member["id"], headers=owner, json=edit).status_code == 200
    code = client.post(base + f"/team/{member['id']}/password-access", headers=owner).json()["setup_code"]
    body = {
        "role": "WORKER",
        "mobile": mobile,
        "setup_code": code,
        "password": "New, secure passphrase 728!",
        "confirm_password": "New, secure passphrase 728!",
    }
    assert client.post("/api/auth/staff/password/setup", json=body).status_code == 409
    assert db.memberships.find_one({"_id": member["id"]})["user_id"] is None
    response = client.post(
        "/api/auth/staff/password/setup", json={**body, "current_password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    assert (
        client.post(
            "/api/auth/staff/password/setup", json={**body, "current_password": PASSWORD}
        ).status_code
        == 200
    )
    assert db.memberships.find_one({"_id": member["id"]})["user_id"] == "existing-account"
    updated_user = db.users.find_one({"_id": "existing-account"})
    assert not updated_user["password_reset_required"]
    assert verify_password(updated_user["password_hash"], body["password"])
    assert (
        client.post(
            "/api/auth/password/login",
            json={"role": "WORKER", "mobile": mobile, "password": PASSWORD},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/password/login",
            json={"role": "WORKER", "mobile": mobile, "password": body["password"]},
        ).status_code
        == 200
    )
