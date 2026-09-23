import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client():
    settings = Settings(
        _env_file=None,
        app_env="test",
        jwt_secret="test-secret-with-more-than-32-characters",
        mongodb_uri=os.getenv("TEST_MONGODB_URI", "mongodb://127.0.0.1:27018"),
        mongodb_database=f"hisab_test_{uuid4().hex}",
        otp_resend_seconds=0,
    )
    with TestClient(create_app(settings)) as c:
        yield c
    with MongoClient(settings.mongodb_uri) as mongo:
        mongo.drop_database(settings.mongodb_database)


def login(client, mobile="+919876543210", role="OWNER"):
    response = client.post("/api/auth/otp/request", json={"mobile": mobile, "role": role})
    assert response.status_code == 200, response.text
    response = client.post(
        "/api/auth/otp/verify",
        json={
            "challenge_id": response.json()["challenge_id"],
            "code": "123456",
        },
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def setup_shop(client):
    owner = login(client)
    result = client.post("/api/shops", headers=owner, json={"name": "Hisab Shop", "timezone": "Asia/Kolkata"})
    assert result.status_code == 201, result.text
    shop = result.json()["id"]
    result = client.post(
        f"/api/shops/{shop}/workers", headers=owner, json={"name": "Asha", "mobile": "+919876543211"}
    )
    assert result.status_code == 201, result.text
    worker = result.json()["id"]
    worker_auth = login(client, "+919876543211", "WORKER")
    return owner, shop, worker, worker_auth
