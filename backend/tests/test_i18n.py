import ast
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from conftest import PASSWORD
from pymongo.errors import PyMongoError

from app.email_provider import send_email
from app.i18n import CATALOG, negotiate, translate


@pytest.mark.parametrize(
    "header,expected",
    [
        ("hi-IN, en;q=0.5", "hi"),
        ("mr-IN;q=0.9,hi;q=0.2", "mr"),
        ("de,en;q=0.5", "en"),
        ("hi;q=0,mr;q=0.7", "mr"),
        ("hi;q=bad,mr", "mr"),
        ("hi;q=2", "en"),
        ("", "en"),
    ],
)
def test_negotiate(header, expected):
    assert negotiate(header) == expected


def test_catalog_covers_errors_and_preserves_placeholders():
    assert CATALOG["hi"].keys() == CATALOG["mr"].keys()
    for source, hindi in CATALOG["hi"].items():
        for translated in (hindi, CATALOG["mr"][source]):
            assert translated and translated != source
            assert sorted(re.findall(r"\{\w+\}", source)) == sorted(re.findall(r"\{\w+\}", translated))
    for file in Path("app").rglob("*.py"):
        if file.name in {"config.py", "enroll_owner.py"}:
            continue  # Startup/operator errors, not API messages.
        for node in ast.walk(ast.parse(file.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            if node.func.id not in {"HTTPException", "ValueError"}:
                continue
            args = node.args[1:] if node.func.id == "HTTPException" else node.args
            args += [kw.value for kw in node.keywords if kw.arg == "detail"]
            for arg in args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    assert arg.value in CATALOG["hi"], (str(file), arg.value)


def test_guest_errors_validation_headers_and_concurrent_languages(client):
    def expired(language):
        response = client.get("/api/auth/me", headers={"Accept-Language": language})
        assert response.status_code == 401
        assert response.headers["content-language"] == language
        assert "Accept-Language" in response.headers["vary"]
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["detail"] == translate("Session expired. Please log in again.", language)

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(expired, ["en", "hi", "mr"] * 3))
    for language in ["hi", "mr"]:
        headers = {"Accept-Language": language}
        response = client.post(
            "/api/auth/owner/register/request",
            headers=headers,
            json={
                "role": "OWNER",
                "mobile": "+919812345678",
                "name": "X",
                "email": "invalid",
            },
        )
        assert response.status_code == 422
        for error in response.json()["detail"]:
            assert set(error) == {"loc", "msg", "type"}
            assert error["msg"] in CATALOG[language].values() or "1" in error["msg"] or "2" in error["msg"]
        missing = client.get("/api/missing", headers=headers)
        assert missing.json()["detail"] == translate("Not Found", language)
        assert client.post("/api/auth/me", headers=headers).json()["detail"] == translate(
            "Method Not Allowed", language
        )


def test_personal_preference_shop_fallback_and_auth_are_independent(client, setup_shop):
    owner, shop, _, worker = setup_shop
    assert (
        client.put(f"/api/shops/{shop}/settings", headers=owner, json={"language": "mr"}).status_code == 200
    )
    headers = {**worker, "Accept-Language": "hi", "X-Hishob-Shop": shop}
    assert client.get("/api/auth/me", headers=headers).headers["content-language"] == "mr"
    assert client.patch("/api/auth/language", headers=worker, json={"language": "hi"}).status_code == 200
    denied = client.put(f"/api/shops/{shop}/settings", headers=headers, json={})
    assert denied.status_code == 403
    assert denied.headers["content-language"] == "hi"
    assert denied.json()["detail"] in CATALOG["hi"].values()
    client.patch("/api/auth/language", headers=worker, json={"language": None})
    assert client.get("/api/auth/me", headers=headers).headers["content-language"] == "mr"
    # A spoofed selection never grants access or chooses another shop's language.
    spoof = {**worker, "Accept-Language": "hi", "X-Hishob-Shop": "not-my-shop"}
    assert client.get("/api/auth/me", headers=spoof).headers["content-language"] == "hi"
    result = client.post(
        "/api/shops",
        headers={**owner, "Accept-Language": "mr"},
        json={"name": "My Shop", "timezone": "invalid"},
    )
    assert result.status_code == 422
    assert result.json()["detail"][0]["msg"] == translate(
        "Use a valid IANA timezone, e.g. Asia/Kolkata", "mr"
    )


def test_registration_persists_language_and_localizes_email(client, monkeypatch):
    delivery = MagicMock()
    monkeypatch.setattr("app.routers.auth.send_email", delivery)
    for index, language in enumerate(["en", "hi", "mr"]):
        result = client.post(
            "/api/auth/owner/register/request",
            json={
                "role": "OWNER",
                "name": "Unchanged Name",
                "email": f"locale{index}@example.com",
                "mobile": f"+91981234567{index}",
                "language": language,
            },
        )
        assert result.status_code == 200, result.text
        assert delivery.call_args.args[-1] == language
        result = client.post(
            "/api/auth/owner/register/confirm",
            json={
                "challenge_id": result.json()["challenge_id"],
                "code": "123456",
                "password": PASSWORD,
                "confirm_password": PASSWORD,
            },
        )
        assert result.status_code == 200, result.text
        profile = client.get(
            "/api/auth/me", headers={"Authorization": "Bearer " + result.json()["access_token"]}
        )
        assert profile.headers["content-language"] == language
        assert profile.json()["user"]["language"] == language
        assert profile.json()["user"]["name"] == "Unchanged Name"


@pytest.mark.parametrize("language", ["en", "hi", "mr"])
def test_email_subject_body_and_otp(language, monkeypatch):
    from app.config import Settings

    settings = Settings(
        _env_file=None,
        app_env="test",
        jwt_secret="test-secret-with-more-than-32-characters",
        email_provider="brevo",
        brevo_api_key="test-api-key",
        brevo_sender_name="Hisab",
        brevo_sender_email="app@example.com",
    )
    response = MagicMock()
    response.__enter__.return_value = response
    request = MagicMock(return_value=response)
    monkeypatch.setattr("app.email_provider.urlopen", request)
    send_email(settings, "recipient@example.com", "123456", language)
    email = json.loads(request.call_args.args[0].data)
    assert email["subject"] == translate("Your Hishob verification code", language)
    assert email["to"] == [{"email": "recipient@example.com"}]
    assert "123456" in email["textContent"]
    if language != "en":
        assert "Your Hishob code" not in email["textContent"]


def test_database_and_csrf_errors_are_localized(client):
    @client.app.get("/api/test-database-error")
    def fail():
        raise PyMongoError("private database details")

    for language in ["hi", "mr"]:
        result = client.get("/api/test-database-error", headers={"Accept-Language": language})
        assert result.status_code == 503
        assert result.json()["detail"] == translate(
            "Database temporarily unavailable. Please retry.", language
        )
        result = client.post(
            "/api/auth/password/login",
            headers={
                "Accept-Language": language,
                "X-Hishob-Client": "web",
                "Origin": "https://untrusted.example",
            },
        )
        assert result.status_code == 403
        assert result.headers["content-language"] == language
        assert result.json()["detail"] in CATALOG[language].values()


def test_unexpected_errors_hide_details_and_use_language(client):
    from fastapi.testclient import TestClient

    @client.app.get("/api/test-unexpected-error")
    def fail():
        raise RuntimeError("sensitive internal information")

    errors = TestClient(client.app, raise_server_exceptions=False)
    try:
        for language in ["en", "hi", "mr"]:
            result = errors.get("/api/test-unexpected-error", headers={"Accept-Language": language})
            assert result.status_code == 500
            assert result.headers["content-language"] == language
            assert result.headers["cache-control"] == "no-store"
            assert result.json()["detail"] == translate("Unexpected server error. Please retry.", language)
    finally:
        errors.close()
