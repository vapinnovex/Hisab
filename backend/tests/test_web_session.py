from conftest import PASSWORD, login

WEB = {"Origin": "http://localhost:8081", "X-Hishob-Client": "web"}


def web_login(client, mobile="+919811112222", role="OWNER"):
    login(client, mobile, role)
    return client.post(
        "/api/auth/password/login", headers=WEB, json={"mobile": mobile, "role": role, "password": PASSWORD}
    )


def test_cookie_session_persists_without_exposing_token_and_logout_revokes(client):
    result = web_login(client)
    assert result.status_code == 200
    assert "access_token" not in result.json()
    assert result.json()["token_type"] == "cookie"
    cookie = result.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert "Path=/api" in cookie and "Max-Age=604800" in cookie
    assert "Domain=" not in cookie
    encoded = client.cookies.get("hishob_session")
    me = client.get("/api/auth/me", headers=WEB)
    assert me.status_code == 200 and me.headers["cache-control"] == "no-store"
    assert client.patch("/api/auth/profile", headers=WEB, json={"name": "Owner"}).status_code == 200
    result = client.post("/api/auth/logout", headers=WEB)
    assert result.status_code == 204 and "Max-Age=0" in result.headers["set-cookie"]
    assert client.get("/api/auth/me", headers=WEB).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {encoded}"}).status_code == 401


def test_browser_requires_exact_origin_and_custom_header_for_writes(client):
    result = client.post(
        "/api/auth/password/options",
        headers={**WEB, "Origin": "https://evil.example"},
        json={"mobile": "+919811112222", "role": "OWNER"},
    )
    assert result.status_code == 403
    assert web_login(client).status_code == 200
    for headers in [
        {},
        {"Origin": WEB["Origin"]},
        {"X-Hishob-Client": "web"},
        {**WEB, "Origin": "http://localhost:8081.evil.example"},
    ]:
        assert (
            client.patch("/api/auth/profile", headers=headers, json={"name": "Attacker"}).status_code == 403
        )
    assert client.get("/api/auth/me", headers=WEB).json()["user"].get("name") is None


def test_https_cookie_secure_and_credentialed_cors(client):
    client.base_url = "https://testserver"
    assert "Secure" in web_login(client).headers["set-cookie"]
    response = client.options(
        "/api/auth/profile",
        headers={
            "Origin": WEB["Origin"],
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "content-type,x-hishob-client",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-credentials"] == "true"
    assert response.headers["access-control-allow-origin"] == WEB["Origin"]


def test_browser_and_native_share_owner_session_limit(client):
    assert web_login(client).status_code == 200
    for _ in range(3):
        # Native authorization uses a separate credential, not the ambient browser cookie.
        client.cookies.clear()
        native = login(client, "+919811112222")
        assert client.get("/api/auth/me", headers=native).status_code == 200
    # First session is revoked even though its signed JWT hasn't expired.
    first = client.app.state.db.sessions.find_one(sort=[("created_at", 1)])
    assert first["revoked"] is True


def test_cookie_mobile_change_replaces_session_and_keeps_identity(client):
    assert web_login(client).status_code == 200
    old_cookie = client.cookies.get("hishob_session")
    old_id = client.get("/api/auth/me", headers=WEB).json()["user"]["id"]
    result = client.post(
        "/api/auth/mobile-change/request",
        headers=WEB,
        json={"mobile": "+919811113333", "role": "OWNER", "password": PASSWORD},
    )
    assert result.status_code == 200, result.text
    result = client.post(
        "/api/auth/mobile-change/confirm",
        headers=WEB,
        json={"challenge_id": result.json()["challenge_id"], "code": "123456"},
    )
    assert result.status_code == 200 and "access_token" not in result.json()
    me = client.get("/api/auth/me", headers=WEB).json()
    assert me["user"]["id"] == old_id and me["user"]["mobile"] == "+919811113333"
    assert client.cookies.get("hishob_session") != old_cookie
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {old_cookie}"}).status_code == 401
