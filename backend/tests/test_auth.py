from datetime import timedelta

import jwt
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.db import now


def test_login_logout_and_invalid_tokens(client):
    from conftest import login

    auth = login(client)
    assert client.get("/api/auth/me", headers=auth).status_code == 200
    assert client.post("/api/auth/logout", headers=auth).status_code == 204
    assert client.get("/api/auth/me", headers=auth).status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer invalid"}).status_code == 401
    assert client.post("/api/auth/otp/request", json={}).status_code == 404
    assert client.post("/api/auth/otp/verify", json={}).status_code == 404


def test_validation_and_duplicate_workers(client, setup_shop):
    owner, shop, worker, auth = setup_shop
    assert (
        client.post("/api/auth/password/options", json={"mobile": "123", "role": "OWNER"}).status_code == 422
    )
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
    body = {"mobile": "+919876543210", "role": "OWNER", "email": "owner@example.com", "name": "Owner"}
    assert client.post("/api/auth/owner/register/request", json=body).status_code == 200
    assert client.post("/api/auth/owner/register/request", json=body).status_code == 429
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", jwt_secret="a" * 32, email_provider="dev")


def test_expired_jwt(client, setup_shop):
    _, _, _, auth = setup_shop
    secret = client.app.state.settings.jwt_secret
    token = auth["Authorization"].split(" ")[1]
    claims = jwt.decode(token, secret, algorithms=["HS256"], audience="hisab-mobile")
    claims["exp"] = now() - timedelta(seconds=1)
    expired = jwt.encode(claims, secret, algorithm="HS256")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
