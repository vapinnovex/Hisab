from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from .config import Settings, get_settings
from .db import create_indexes
from .otp import get_provider
from .routers import attendance, auth, shops


def create_app(settings: Settings = None):
    @asynccontextmanager
    async def lifespan(app):
        config = settings or get_settings()
        client = MongoClient(config.mongodb_uri, tz_aware=True, serverSelectionTimeoutMS=5000)
        app.state.settings = config
        app.state.db = client[config.mongodb_database]
        app.state.otp_provider = get_provider(config)
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
        allow_headers=["Authorization", "Content-Type"],
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
    app.include_router(shops.router, prefix="/api")
    app.include_router(attendance.router, prefix="/api")
    return app
