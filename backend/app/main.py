from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import Settings, get_settings
from .db import create_indexes
from .face_engine import FaceEngine
from .i18n import message, negotiate, validation_message
from .routers import account, attendance, auth, dues, face, hishob, password_auth, shops
from .web_session import COOKIE_NAME


def create_app(settings: Settings = None):
    @asynccontextmanager
    async def lifespan(app):
        config = settings or get_settings()
        client = MongoClient(config.mongodb_uri, tz_aware=True, serverSelectionTimeoutMS=5000)
        app.state.settings = config
        app.state.db = client[config.mongodb_database]
        app.state.face_engine = FaceEngine(config)
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
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Hishob-Client",
            "Accept-Language",
            "X-Hishob-Shop",
        ],
        allow_credentials=True,
    )

    @app.middleware("http")
    async def browser_security(request: Request, call_next):
        request.state.language = negotiate(request.headers.get("accept-language", "en"))
        station = request.url.path.startswith("/api/face-station/")
        if station and request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            own_origin = str(request.base_url).rstrip("/")
            if request.headers.get("x-hishob-client") != "web" or origin not in [
                *config.cors_origins,
                own_origin,
            ]:
                return JSONResponse(
                    status_code=403, content={"detail": "Open the attendance station from its app address."}
                )
            size, chunks = 0, []
            async for chunk in request.stream():
                size += len(chunk)
                if size > 1_250_000:
                    return JSONResponse(
                        status_code=413, content={"detail": "Camera images are too large. Please try again."}
                    )
                chunks.append(chunk)
            request._body = b"".join(chunks)
        web = request.headers.get("x-hishob-client") == "web"
        cookie_auth = COOKIE_NAME in request.cookies and not request.headers.get("authorization")
        if request.url.path.startswith("/api/"):
            # A custom header and exact trusted Origin prevent login and cookie CSRF.
            if request.method not in {"GET", "HEAD", "OPTIONS"} and (web or cookie_auth):
                if not station and (not web or request.headers.get("origin") not in config.cors_origins):
                    return JSONResponse(
                        status_code=403,
                        content={
                            "detail": message(
                                request, "Untrusted browser origin. Open Hishob from its app address."
                            )
                        },
                        headers={"Cache-Control": "no-store", "Content-Language": request.state.language},
                    )
            response = await call_next(request)
            response.headers["Cache-Control"] = "no-store"
            response.headers["Content-Language"] = request.state.language
            response.headers["Vary"] = ", ".join(
                filter(None, [response.headers.get("Vary"), "Accept-Language"])
            )
            return response
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Never reflect passwords or verification tokens in validation responses.
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {"loc": error["loc"], "msg": validation_message(request, error), "type": error["type"]}
                    for error in exc.errors()
                ]
            },
            headers={"Cache-Control": "no-store"},
        )

    @app.exception_handler(PyMongoError)
    async def database_error(request: Request, exc: PyMongoError):
        return JSONResponse(
            status_code=503,
            content={"detail": message(request, "Database temporarily unavailable. Please retry.")},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": message(request, exc.detail) if isinstance(exc.detail, str) else exc.detail},
            headers=exc.headers,
        )

    @app.get("/health", tags=["System"])
    def health(request: Request):
        request.app.state.db.command("ping")
        return {"status": "ok"}

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        # Starlette logs/re-raises the original exception; never expose its details to clients.
        return JSONResponse(
            status_code=500,
            content={"detail": message(request, "Unexpected server error. Please retry.")},
            headers={
                "Cache-Control": "no-store",
                "Content-Language": getattr(request.state, "language", "en"),
                "Vary": "Accept-Language",
            },
        )

    app.include_router(auth.router, prefix="/api")
    app.include_router(password_auth.router, prefix="/api")
    app.include_router(account.router, prefix="/api")
    app.include_router(shops.router, prefix="/api")
    app.include_router(hishob.router, prefix="/api")
    app.include_router(dues.router, prefix="/api")
    app.include_router(attendance.router, prefix="/api")
    app.include_router(face.router, prefix="/api")
    return app
