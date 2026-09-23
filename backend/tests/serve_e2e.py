"""Isolated real-Mongo API used only by the browser end-to-end suite."""

import os
import sys
from pathlib import Path
from uuid import uuid4

import uvicorn
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

settings = Settings(
    _env_file=None,
    app_env="test",
    jwt_secret="browser-test-secret-at-least-32-characters",
    mongodb_uri=os.getenv("TEST_MONGODB_URI", "mongodb://127.0.0.1:27018"),
    mongodb_database=f"hisab_e2e_{uuid4().hex}",
    otp_resend_seconds=0,
    cors_origins=["http://localhost:8082"],
)
try:
    uvicorn.run(create_app(settings), host="127.0.0.1", port=8001)
finally:
    with MongoClient(settings.mongodb_uri) as client:
        client.drop_database(settings.mongodb_database)
