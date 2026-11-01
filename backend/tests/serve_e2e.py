"""Isolated real-Mongo API used only by the browser end-to-end suite."""

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import uvicorn
from fastapi import Depends, HTTPException
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.security import current_identity, shop_access  # noqa: E402

settings = Settings(
    _env_file=None,
    app_env="test",
    jwt_secret="browser-test-secret-at-least-32-characters",
    mongodb_uri=os.getenv("TEST_MONGODB_URI", "mongodb://127.0.0.1:27018"),
    mongodb_database=f"hisab_e2e_{uuid4().hex}",
    otp_resend_seconds=0,
    cors_origins=["http://localhost:8082", "http://localhost:8083"],
)
# Only this isolated test server replaces camera inference. Production has no bypass.
app = create_app(settings)
real_lifespan = app.router.lifespan_context


@app.post("/api/test-only/radiosoft/{shop_id}")
def approve_synthetic_pilot(shop_id: str, identity=Depends(current_identity)):
    # Exists only in this isolated E2E server, never in create_app / production.
    if identity.role != "OWNER":
        raise HTTPException(403, "Owner required")
    shop_access(shop_id, app.state.db, identity, {"OWNER"})
    settings.radiosoft_synthetic_enabled = True
    settings.radiosoft_pilots.append(
        {
            "shop_id": shop_id,
            "owner_id": identity.user["_id"],
            "source_id": "synthetic-installation",
            "firm_codes": [0],
            "tracking_from": "2026-11-01",
        }
    )
    return {"synthetic_only": True}


class TestCamera:
    def ready(self):
        pass

    def extract(self, frames):
        assert len(frames) == 3 and all(len(frame) > 100 for frame in frames)
        return [[1.0] + [0.0] * 127] * 3


@asynccontextmanager
async def test_lifespan(application):
    async with real_lifespan(application):
        application.state.face_engine = TestCamera()
        yield


app.router.lifespan_context = test_lifespan
try:
    uvicorn.run(app, host="127.0.0.1", port=8001)
finally:
    with MongoClient(settings.mongodb_uri) as client:
        client.drop_database(settings.mongodb_database)
