from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from .config import Settings, get_settings
from .db import create_indexes
from .routers import account, attendance, auth, hishob, password_auth, shops
from .web_session import COOKIE_NAME


def create_app(settings: Settings = None):
    @asynccontextmanager
    async def lifespan(app):
        config = settings or get_settings()
        client = MongoClient(config.mongodb_uri, tz_aware=True, serverSelectionTimeoutMS=5000)
        app.state.settings = config
        app.state.db = client[config.mongodb_database]
        client.admin.command("ping")
        create_indexes(app.state.db)
        try:
            yield
        finally:
            client.close()

    app = FastAPI(title="Hishob API", version="1.0.0", lifespan=lifespan)
    config = settings or get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "PUT"],
        allow_headers=["Authorization", "Content-Type", "X-Hishob-Client"],
        allow_credentials=True,
    )

    @app.middleware("http")
    async def browser_security(request: Request, call_next):
        web = request.headers.get("x-hishob-client") == "web"
        cookie_auth = COOKIE_NAME in request.cookies and not request.headers.get("authorization")
        if request.url.path.startswith("/api/"):
            # A custom header and exact trusted Origin prevent login and cookie CSRF.
            if request.method not in {"GET", "HEAD", "OPTIONS"} and (web or cookie_auth):
                if not web or request.headers.get("origin") not in config.cors_origins:
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "Untrusted browser origin. Open Hishob from its app address."},
                        headers={"Cache-Control": "no-store"},
                    )
            response = await call_next(request)
            response.headers["Cache-Control"] = "no-store"
            return response
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Never reflect passwords or verification tokens in validation responses.
        return JSONResponse(
            status_code=422,
            content={
                "detail": [{key: error[key] for key in ("loc", "msg", "type")} for error in exc.errors()]
            },
            headers={"Cache-Control": "no-store"},
        )

    @app.exception_handler(PyMongoError)
    async def database_error(request: Request, exc: PyMongoError):
        return JSONResponse(
            status_code=503, content={"detail": "Database temporarily unavailable. Please retry."}
        )

    @app.get("/health", tags=["System"])
    def health(request: Request):
        request.app.state.db.command("ping")
        return {"status": "ok"}

    app.include_router(auth.router, prefix="/api")
    app.include_router(password_auth.router, prefix="/api")
    app.include_router(account.router, prefix="/api")
    app.include_router(shops.router, prefix="/api")
    app.include_router(hishob.router, prefix="/api")
    app.include_router(attendance.router, prefix="/api")
    return app
