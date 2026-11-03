import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pydantic_settings import SettingsError

from app.check_origin import main
from app.config import Settings, get_settings
from app.db import get_db

ORIGIN = "https://hisab-mobile-delta.vercel.app"


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch, tmp_path):
    # Do not inherit developer credentials, settings or a local .env.
    import os

    for key in list(os.environ):
        if key.lower() in Settings.model_fields:
            monkeypatch.delenv(key)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("JWT_SECRET", "test-secret-with-more-than-32-characters")
    monkeypatch.setenv("CORS_ORIGINS", json.dumps([ORIGIN]))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_render_json_and_settings_precedence(tmp_path):
    (tmp_path / ".env").write_text('CORS_ORIGINS=["https://dotenv.example"]\n')
    assert Settings().cors_origins == [ORIGIN]
    assert Settings(cors_origins=["https://explicit.example"]).cors_origins == ["https://explicit.example"]


def test_dotenv_and_default_fallback(monkeypatch, tmp_path):
    monkeypatch.delenv("CORS_ORIGINS")
    assert Settings().cors_origins == ["http://localhost:8081"]
    (tmp_path / ".env").write_text(f"CORS_ORIGINS={json.dumps([ORIGIN])}\n")
    assert Settings().cors_origins == [ORIGIN]


def test_settings_are_cached_until_process_restart(monkeypatch):
    assert get_settings().cors_origins == [ORIGIN]
    monkeypatch.setenv("CORS_ORIGINS", '["https://other.example"]')
    assert get_settings().cors_origins == [ORIGIN]
    get_settings.cache_clear()
    assert get_settings().cors_origins == ["https://other.example"]


@pytest.mark.parametrize("raw", [ORIGIN, '["*"]', "[123]", '"https://example.com"'])
def test_invalid_configuration_fails_closed(monkeypatch, raw):
    monkeypatch.setenv("CORS_ORIGINS", raw)
    with pytest.raises((SettingsError, ValidationError)):
        Settings()


def test_production_still_rejects_wildcard(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("EMAIL_PROVIDER", "brevo")
    monkeypatch.setenv("BREVO_API_KEY", "test-only")
    monkeypatch.setenv("BREVO_SENDER_NAME", "Test")
    monkeypatch.setenv("BREVO_SENDER_EMAIL", "test@example.com")
    assert Settings().cors_origins == [ORIGIN]
    monkeypatch.setenv("CORS_ORIGINS", '["*"]')
    with pytest.raises(ValidationError, match="exact trusted app origins"):
        Settings()


def test_development_origin_passes_real_middleware():
    from app.main import create_app

    app = create_app()
    app.dependency_overrides[get_db] = lambda: None
    # No lifespan/database startup; invalid input must reach validation, never auth logic.
    client = TestClient(app)
    response = client.post(
        "/api/auth/password/options",
        headers={"Origin": ORIGIN, "X-Hishob-Client": "web"},
        json={},
    )
    assert response.status_code == 422
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"
    for origin, status in [(ORIGIN, 200), ("https://evil.example", 400)]:
        response = client.options(
            "/api/auth/password/options",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-hishob-client",
            },
        )
        assert response.status_code == status
    for origin in [None, "https://evil.example", ORIGIN + ".evil.example", ORIGIN + "/"]:
        headers = {"X-Hishob-Client": "web"}
        if origin is not None:
            headers["Origin"] = origin
        response = client.post("/api/auth/password/options", headers=headers, json={})
        assert response.status_code == 403
    response = client.post(
        "/api/auth/password/options",
        headers={"Origin": ORIGIN, "Cookie": "hishob_session=dummy"},
        json={},
    )
    assert response.status_code == 403
    client.close()


def test_safe_diagnostic(capsys, monkeypatch):
    assert main([ORIGIN]) == 0
    assert capsys.readouterr().out == "Origin recognized: true\n"
    assert main(["https://evil.example"]) == 1
    assert capsys.readouterr().out == "Origin recognized: false\n"
    get_settings.cache_clear()
    monkeypatch.setenv("JWT_SECRET", "secret")
    assert main([ORIGIN]) == 2
    output = capsys.readouterr().out
    assert output == "Settings could not be loaded; configuration values withheld.\n"
