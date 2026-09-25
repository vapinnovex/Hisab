"""Browser credentials stay in a host-only HttpOnly cookie; native uses bearer JWTs."""

COOKIE_NAME = "hishob_session"


def browser_session(request, response, session):
    if request.headers.get("x-hishob-client") != "web":
        return session
    response.set_cookie(
        COOKIE_NAME,
        session["access_token"],
        max_age=request.app.state.settings.jwt_expire_minutes * 60,
        httponly=True,
        secure=cookie_secure(request),
        samesite="lax",
        path="/api",
    )
    return {"token_type": "cookie", "expires_at": session["expires_at"]}


def cookie_secure(request):
    return request.app.state.settings.app_env not in {"development", "test"} or request.url.scheme == "https"


def clear_browser_session(request, response):
    response.delete_cookie(
        COOKIE_NAME, path="/api", httponly=True, secure=cookie_secure(request), samesite="lax"
    )
