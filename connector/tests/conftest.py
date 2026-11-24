import os
from uuid import uuid4

import pytest

from hishob_connector.security import DPAPI
from hishob_connector.store import Store


class TestVault:
    """Unit-test dependency only; never imported by shipped code."""

    def seal(self, value):
        return b"TEST-ONLY:" + value

    def open(self, value):
        assert value.startswith(b"TEST-ONLY:")
        return value[10:]


@pytest.fixture
def vault():
    return DPAPI() if os.name == "nt" else TestVault()


@pytest.fixture
def store(tmp_path, vault):
    instance = Store.initialize(tmp_path / "state", vault)
    yield instance
    instance.close()


@pytest.fixture
def backend():
    if not os.environ.get("CONNECTOR_TEST_MONGODB_URI"):
        pytest.skip("Set CONNECTOR_TEST_MONGODB_URI to an isolated loopback test Mongo instance")
    from urllib.parse import urlsplit

    from app.config import Settings
    from app.main import create_app
    from app.passwords import hash_password
    from fastapi.testclient import TestClient
    from pymongo import MongoClient

    uri = os.environ["CONNECTOR_TEST_MONGODB_URI"]
    if urlsplit(uri).hostname != "127.0.0.1":
        pytest.fail("Only an isolated loopback MongoDB is allowed")
    settings = Settings(
        _env_file=None,
        app_env="test",
        jwt_secret="synthetic-connector-test-secret-32-characters",
        mongodb_uri=uri,
        mongodb_database="hishob_connector_test_" + uuid4().hex,
        radiosoft_synthetic_enabled=True,
    )
    with TestClient(create_app(settings)) as client:
        db = client.app.state.db
        owner_id = uuid4().hex
        db.users.insert_one(
            {
                "_id": owner_id,
                "mobile": "+919000000123",
                "owner_registered": True,
                "email_verified": True,
                "email": "synthetic@example.com",
                "password_hash": hash_password("synthetic test password 123"),
            }
        )
        response = client.post(
            "/api/auth/password/login",
            json={"mobile": "+919000000123", "role": "OWNER", "password": "synthetic test password 123"},
        )
        assert response.status_code == 200, response.text
        owner = {"Authorization": "Bearer " + response.json()["access_token"]}
        response = client.post(
            "/api/shops", headers=owner, json={"name": "Connector synthetic test", "timezone": "Asia/Kolkata"}
        )
        assert response.status_code == 201, response.text
        shop = response.json()["id"]
        settings.radiosoft_pilots = [
            {
                "shop_id": shop,
                "owner_id": owner_id,
                "source_id": "synthetic-installation",
                "firm_codes": [0],
                "tracking_from": "2026-11-01",
            }
        ]
        base = f"/api/shops/{shop}/radiosoft"
        assert (
            client.put(base + "/settings", headers=owner, json={"revision": 0, "mode": "PREVIEW"}).status_code
            == 200
        )
        yield {"client": client, "db": db, "owner": owner, "base": base, "settings": settings}
    with MongoClient(uri) as mongo:
        mongo.drop_database(settings.mongodb_database)


class BackendTransport:
    def __init__(self, backend):
        self.client = backend["client"]
        self.calls = []
        self.fail = None
        self.fail_path = None
        self.lose = None

    def post(self, path, body, credential=None):
        from hishob_connector.transport import DeliveryError

        self.calls.append((path, body))
        if self.fail is not None and (self.fail_path is None or path == self.fail_path):
            raise DeliveryError(self.fail)
        response = self.client.post(
            "/api/radiosoft/connector/" + path,
            content=body,
            headers={
                "Content-Type": "application/json",
                **({"Authorization": "Bearer " + credential} if credential else {}),
            },
        )
        if self.lose == path:
            self.lose = None
            assert response.status_code == 200, response.text
            raise DeliveryError(0)
        if response.status_code != 200:
            raise DeliveryError(response.status_code)
        return response.json()


def new_code(backend):
    return backend["client"].post(backend["base"] + "/pairing", headers=backend["owner"]).json()["code"]


def pair(store, backend, transport):
    from hishob_connector.engine import Engine

    store.queue_pair("http://127.0.0.1:8000", new_code(backend))
    engine = Engine(store, transport)
    engine.tick()
    assert store.get("mode") == "RUNNING"
    return engine
