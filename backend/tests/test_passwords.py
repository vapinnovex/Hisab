from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from conftest import PASSWORD, login

from app.db import now

NEW = "a different long passphrase 99"


def registration(client, mobile="+919812345678", email="new@example.com"):
    response = client.post(
        "/api/auth/owner/register/request",
        json={"role": "OWNER", "mobile": mobile, "email": email, "name": "New Owner"},
    )
    assert response.status_code == 200, response.text
    return {
        "challenge_id": response.json()["challenge_id"],
        "code": "123456",
        "password": PASSWORD,
        "confirm_password": PASSWORD,
    }


def test_owner_registration_verifies_email_and_never_returns_secrets(client):
    body = registration(client)
    assert client.app.state.db.users.count_documents({}) == 0
    assert client.post("/api/auth/owner/register/confirm", json={**body, "code": "000000"}).status_code == 400
    result = client.post("/api/auth/owner/register/confirm", json=body)
    assert result.status_code == 200, result.text
    auth = {"Authorization": "Bearer " + result.json()["access_token"]}
    profile = client.get("/api/auth/me", headers=auth).json()["user"]
    assert profile["email_verified"] and profile["password_ready"]
    assert set(profile) == {"id", "mobile", "name", "email", "password_ready", "email_verified"}
    stored = client.app.state.db.users.find_one({})
    assert stored["password_hash"].startswith("$argon2id$") and PASSWORD not in stored["password_hash"]
    assert client.post("/api/auth/owner/register/confirm", json=body).status_code == 400
    assert (
        client.post(
            "/api/auth/password/login",
            json={"mobile": profile["mobile"], "role": "OWNER", "password": PASSWORD},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/auth/owner/register/request",
            json={"role": "OWNER", "mobile": "+919812345679", "email": "NEW@example.com", "name": "Other"},
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "password,confirm",
    [
        ("short", "short"),
        (PASSWORD, "different passphrase"),
        ("password123456", "password123456"),
        (" a long passphrase ", " a long passphrase "),
        ("a" * 129, "a" * 129),
    ],
)
def test_password_validation(client, password, confirm):
    body = registration(client)
    response = client.post(
        "/api/auth/owner/register/confirm", json={**body, "password": password, "confirm_password": confirm}
    )
    assert response.status_code == 422, response.text
    assert client.app.state.db.users.count_documents({}) == 0


def test_recovery_expiry_attempts_scope_and_session_revocation(client, setup_shop):
    owner, shop, *_ = setup_shop
    email = client.get("/api/auth/me", headers=owner).json()["user"]["email"]

    def challenge():
        result = client.post("/api/auth/owner/recovery/request", json={"email": email})
        assert result.status_code == 200, result.text
        return {
            "challenge_id": result.json()["challenge_id"],
            "code": "123456",
            "password": NEW,
            "confirm_password": NEW,
        }

    body = challenge()
    for _ in range(5):
        assert (
            client.post("/api/auth/owner/recovery/confirm", json={**body, "code": "000000"}).status_code
            == 400
        )
    assert client.post("/api/auth/owner/recovery/confirm", json=body).status_code == 400
    body = challenge()
    client.app.state.db.otp_challenges.update_one(
        {"_id": body["challenge_id"]}, {"$set": {"expires_at": now() - timedelta(seconds=1)}}
    )
    assert client.post("/api/auth/owner/recovery/confirm", json=body).status_code == 400
    body = challenge()
    assert client.post("/api/auth/owner/register/confirm", json=body).status_code == 400
    response = client.post("/api/auth/owner/recovery/confirm", json=body)
    assert response.status_code == 200, response.text
    assert client.get("/api/auth/me", headers=owner).status_code == 401
    assert (
        client.post(
            "/api/auth/password/login",
            json={"mobile": "+919876543210", "role": "OWNER", "password": PASSWORD},
        ).status_code
        == 401
    )
    auth = {"Authorization": "Bearer " + response.json()["access_token"]}
    assert client.get("/api/auth/me", headers=auth).json()["memberships"][0]["shop_id"] == shop
    assert client.post("/api/auth/owner/recovery/confirm", json=body).status_code == 400
    unknown = client.post("/api/auth/owner/recovery/request", json={"email": "unknown@example.com"})
    assert unknown.status_code == 200 and "dev_otp" not in unknown.json()


def grant(client, owner, shop, staff):
    response = client.post(f"/api/shops/{shop}/team/{staff}/password-access", headers=owner)
    assert response.status_code == 200, response.text
    return response.json()["setup_code"]


def test_staff_first_setup_and_owner_approved_reset(client, setup_shop):
    owner, shop, _, _ = setup_shop
    mobile = "+919812345677"
    staff = client.post(
        f"/api/shops/{shop}/workers", headers=owner, json={"name": "New staff", "mobile": mobile}
    ).json()["id"]
    who = {"mobile": mobile, "role": "WORKER"}
    body = {**who, "setup_code": "NOTVALIDCODE", "password": PASSWORD, "confirm_password": PASSWORD}
    assert client.post("/api/auth/password/options", json=who).json()["step"] == "SETUP"
    assert client.post("/api/auth/staff/password/setup", json=body).status_code == 400
    body["setup_code"] = grant(client, owner, shop, staff)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.post("/api/auth/staff/password/setup", json=body), range(2)))
    assert sum(r.status_code == 200 for r in results) == 1
    auth = {
        "Authorization": "Bearer " + next(r for r in results if r.status_code == 200).json()["access_token"]
    }
    assert client.post("/api/auth/password/options", json=who).json()["step"] == "PASSWORD"
    assert client.post(f"/api/shops/{shop}/team/{staff}/password-access", headers=owner).status_code == 409
    assert client.post("/api/auth/staff/reset-request", json=who).status_code == 200
    assert (
        client.get("/api/auth/me", headers=auth).status_code == 200
    )  # A request alone cannot lock someone out.
    assert client.post(f"/api/shops/{shop}/team/{staff}/password-deny", headers=owner).status_code == 200
    assert client.post("/api/auth/staff/reset-request", json=who).status_code == 200
    fresh = grant(client, owner, shop, staff)
    assert client.get("/api/auth/me", headers=auth).status_code == 401
    assert client.post("/api/auth/password/login", json={**who, "password": PASSWORD}).status_code == 401
    assert client.post("/api/auth/staff/password/setup", json=body).status_code == 400
    response = client.post(
        "/api/auth/staff/password/setup",
        json={**body, "setup_code": fresh, "password": NEW, "confirm_password": NEW},
    )
    assert response.status_code == 200, response.text
    assert client.post("/api/auth/password/login", json={**who, "password": NEW}).status_code == 200


def test_manager_reset_permissions_are_live_and_never_allow_self_or_owner(client, setup_shop):
    owner, shop, staff, _ = setup_shop
    manager_id = client.post(
        f"/api/shops/{shop}/managers", headers=owner, json={"mobile": "+919876543212", "name": "Manager"}
    ).json()["id"]
    manager = login(client, "+919876543212", "MANAGER")
    who = {"mobile": "+919876543211", "role": "WORKER"}
    client.post("/api/auth/staff/reset-request", json=who)
    path = f"/api/shops/{shop}/team/{staff}/password-access"
    assert client.post(path, headers=manager).status_code == 403
    config = client.get(f"/api/shops/{shop}/settings", headers=owner).json()
    client.put(
        f"/api/shops/{shop}/settings",
        headers=owner,
        json={**config, "manager_can_reset_worker_passwords": True},
    )
    code = grant(client, manager, shop, staff)
    assert (
        client.post(f"/api/shops/{shop}/team/{manager_id}/password-access", headers=manager).status_code
        == 403
    )
    client.put(f"/api/shops/{shop}/settings", headers=owner, json=config)
    assert (
        client.post(
            "/api/auth/staff/password/setup",
            json={**who, "setup_code": code, "password": NEW, "confirm_password": NEW},
        ).status_code
        == 403
    )
    other = login(client, "+919876543299")
    assert client.post(path, headers=other).status_code == 403
    # Even a shop owner cannot reset a staff account that also owns a shop.
    client.app.state.db.users.update_one({"mobile": who["mobile"]}, {"$set": {"owner_registered": True}})
    assert client.post(path, headers=owner).status_code == 403


def test_setup_expiry_deactivation_and_wrong_shop(client, setup_shop):
    owner, shop, staff, _ = setup_shop
    who = {"mobile": "+919876543211", "role": "WORKER"}
    client.post("/api/auth/staff/reset-request", json=who)
    code = grant(client, owner, shop, staff)
    body = {**who, "setup_code": code, "password": NEW, "confirm_password": NEW}
    db = client.app.state.db
    db.users.update_one(
        {"mobile": who["mobile"]}, {"$set": {"password_setup.expires_at": now() - timedelta(seconds=1)}}
    )
    assert client.post("/api/auth/staff/password/setup", json=body).status_code == 400
    code = grant(client, owner, shop, staff)
    db.memberships.update_one({"_id": staff}, {"$set": {"active": False}})
    assert client.post("/api/auth/staff/password/setup", json={**body, "setup_code": code}).status_code == 403


def test_existing_owner_enrollment_requires_existing_session(client, setup_shop):
    owner, shop, *_ = setup_shop
    db = client.app.state.db
    db.users.update_one(
        {"mobile": "+919876543210"}, {"$unset": {"password_hash": "", "email": "", "email_verified": ""}}
    )
    assert (
        client.post("/api/auth/password/options", json={"mobile": "+919876543210", "role": "OWNER"}).json()[
            "step"
        ]
        == "OWNER_MIGRATION"
    )
    assert (
        client.post("/api/auth/owner/enroll/request", json={"email": "migrate@example.com"}).status_code
        == 401
    )
    result = client.post(
        "/api/auth/owner/enroll/request", headers=owner, json={"email": "migrate@example.com"}
    )
    assert result.status_code == 200, result.text
    body = {
        "challenge_id": result.json()["challenge_id"],
        "code": "123456",
        "password": NEW,
        "confirm_password": NEW,
    }
    result = client.post("/api/auth/owner/enroll/confirm", headers=owner, json=body)
    assert result.status_code == 200, result.text
    auth = {"Authorization": "Bearer " + result.json()["access_token"]}
    assert client.get("/api/auth/me", headers=auth).json()["memberships"][0]["shop_id"] == shop
    assert client.get("/api/auth/me", headers=owner).status_code == 401


def test_password_change_and_rate_limit(client, setup_shop):
    owner, *_ = setup_shop
    body = {"current_password": "wrong", "password": NEW, "confirm_password": NEW}
    assert client.post("/api/auth/password/change", headers=owner, json=body).status_code == 400
    assert (
        client.post(
            "/api/auth/password/change", headers=owner, json={**body, "current_password": PASSWORD}
        ).status_code
        == 200
    )
    assert client.get("/api/auth/me", headers=owner).status_code == 401
    for _ in range(20):
        result = client.post(
            "/api/auth/password/login", json={"mobile": "+919812345677", "role": "OWNER", "password": "wrong"}
        )
    assert result.status_code == 401
    assert (
        client.post(
            "/api/auth/password/login", json={"mobile": "+919812345677", "role": "OWNER", "password": "wrong"}
        ).status_code
        == 429
    )


def test_smtp_email_provider_and_failed_delivery_cleanup(client, monkeypatch):
    import re

    from app import email_provider

    settings = client.app.state.settings
    settings.email_provider = "smtp"
    settings.smtp_host = "smtp.example.com"
    settings.smtp_from = "Hishob <hello@example.com>"
    settings.smtp_username = "mailer"
    settings.smtp_password = "smtp-secret"
    sent = []

    class SMTP:
        def __init__(self, *args, **kwargs):
            self.tls = False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def starttls(self, context):
            assert context.check_hostname
            self.tls = True

        def login(self, username, password):
            assert self.tls and username == "mailer"

        def send_message(self, message):
            sent.append(message)

    monkeypatch.setattr(email_provider.smtplib, "SMTP", SMTP)
    result = client.post(
        "/api/auth/owner/register/request",
        json={
            "role": "OWNER",
            "mobile": "+919812345678",
            "email": "smtp-test@example.com",
            "name": "Mail owner",
        },
    )
    assert result.status_code == 200 and "dev_otp" not in result.json()
    assert sent[0]["To"] == "smtp-test@example.com"
    code = re.search(r"code is (\d{6})", sent[0].get_content()).group(1)
    assert (
        client.post(
            "/api/auth/owner/register/confirm",
            json={
                "challenge_id": result.json()["challenge_id"],
                "code": code,
                "password": PASSWORD,
                "confirm_password": PASSWORD,
            },
        ).status_code
        == 200
    )

    def fail(*args):
        raise RuntimeError("SMTP unavailable")

    monkeypatch.setattr(email_provider.smtplib.SMTP, "send_message", fail)
    before = client.app.state.db.otp_challenges.count_documents({})
    result = client.post(
        "/api/auth/owner/register/request",
        json={
            "role": "OWNER",
            "mobile": "+919812345679",
            "email": "smtp-fail@example.com",
            "name": "Mail owner",
        },
    )
    assert result.status_code == 503
    assert client.app.state.db.otp_challenges.count_documents({}) == before


def test_validation_never_echoes_passwords_and_email_is_required(client):
    result = client.post(
        "/api/auth/password/login",
        json={"mobile": "+919812345678", "role": "OWNER", "password": "secret" * 30},
    )
    assert result.status_code == 422 and "secret" not in result.text
    assert (
        client.post(
            "/api/auth/owner/register/request",
            json={"mobile": "+919812345678", "role": "OWNER", "name": "Owner"},
        ).status_code
        == 422
    )
    for password in ["aaaaaaaaaaaa", "Password!!!!!12345", "welcome1234567"]:
        body = registration(client)
        assert (
            client.post(
                "/api/auth/owner/register/confirm",
                json={**body, "password": password, "confirm_password": password},
            ).status_code
            == 422
        )
