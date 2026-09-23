from datetime import timedelta

import jwt
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.db import now


def test_otp_expiry_attempts_replay_and_logout(client):
    body = {"mobile": "+919876543210", "role": "OWNER"}
    challenge = client.post("/api/auth/otp/request", json=body).json()["challenge_id"]
    for _ in range(5):
        assert (
            client.post(
                "/api/auth/otp/verify", json={"challenge_id": challenge, "code": "000000"}
            ).status_code
            == 400
        )
    assert (
        client.post("/api/auth/otp/verify", json={"challenge_id": challenge, "code": "123456"}).status_code
        == 400
    )
    challenge = client.post("/api/auth/otp/request", json=body).json()["challenge_id"]
    client.app.state.db.otp_challenges.update_one(
        {"_id": challenge}, {"$set": {"expires_at": now() - timedelta(seconds=1)}}
    )
    assert (
        client.post("/api/auth/otp/verify", json={"challenge_id": challenge, "code": "123456"}).status_code
        == 400
    )
    challenge = client.post("/api/auth/otp/request", json=body).json()["challenge_id"]
    verification = {"challenge_id": challenge, "code": "123456"}
    response = client.post("/api/auth/otp/verify", json=verification)
    assert response.status_code == 200
    assert client.post("/api/auth/otp/verify", json=verification).status_code == 400
    auth = {"Authorization": "Bearer " + response.json()["access_token"]}
    assert client.get("/api/auth/me", headers=auth).status_code == 200
    assert client.post("/api/auth/logout", headers=auth).status_code == 204
    assert client.get("/api/auth/me", headers=auth).status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer invalid"}).status_code == 401


def test_validation_and_duplicate_workers(client, setup_shop):
    owner, shop, worker, auth = setup_shop
    assert client.post("/api/auth/otp/request", json={"mobile": "123", "role": "OWNER"}).status_code == 422
    assert (
        client.post("/api/shops", headers=owner, json={"name": "Shop", "timezone": "Nope"}).status_code == 422
    )
    assert (
        client.post(
            f"/api/shops/{shop}/workers", headers=owner, json={"name": "Again", "mobile": "+919876543211"}
        ).status_code
        == 409
    )
    assert client.get(f"/api/shops/{shop}/me/attendance?month=2026-13", headers=auth).status_code == 422
    assert (
        client.put(
            f"/api/shops/{shop}/workers/{worker}/attendance",
            headers=owner,
            json={"date": "2099-01-01", "status": "ABSENT"},
        ).status_code
        == 422
    )
    assert (
        client.put(
            f"/api/shops/{shop}/workers/{worker}/attendance",
            headers=owner,
            json={"date": "2000-01-01", "status": "ABSENT"},
        ).status_code
        == 422
    )


def test_rate_limit_and_production_guard(client):
    client.app.state.settings.otp_resend_seconds = 30
    body = {"mobile": "+919876543210", "role": "OWNER"}
    assert client.post("/api/auth/otp/request", json=body).status_code == 200
    assert client.post("/api/auth/otp/request", json=body).status_code == 429
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", jwt_secret="a" * 32, otp_provider="dev")


def test_expired_jwt(client, setup_shop):
    _, _, _, auth = setup_shop
    secret = client.app.state.settings.jwt_secret
    token = auth["Authorization"].split(" ")[1]
    claims = jwt.decode(token, secret, algorithms=["HS256"], audience="hisab-mobile")
    claims["exp"] = now() - timedelta(seconds=1)
    expired = jwt.encode(claims, secret, algorithm="HS256")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
