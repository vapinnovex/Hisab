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


PASSWORD = "a long test passphrase 42"


def login(client, mobile="+919876543210", role="OWNER"):
    # Domain fixtures seed credentials; password lifecycle tests exercise real onboarding.
    from app.db import new_id, now
    from app.passwords import hash_password

    db = client.app.state.db
    user = db.users.find_one({"mobile": mobile})
    if not user:
        user = {"_id": new_id(), "mobile": mobile, "created_at": now()}
        db.users.insert_one(user)
    patch = {}
    if not user.get("password_hash"):
        patch["password_hash"] = hash_password(PASSWORD)
    if role == "OWNER":
        patch.update(
            owner_registered=True, email=user.get("email", user["_id"] + "@example.com"), email_verified=True
        )
    if patch:
        db.users.update_one({"_id": user["_id"]}, {"$set": patch})
    response = client.post(
        "/api/auth/password/login", json={"mobile": mobile, "role": role, "password": PASSWORD}
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
