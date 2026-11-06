"""Short human codes; long connector proofs remain independent and unchanged."""

import hashlib
import hmac
import re
from datetime import timedelta

from fastapi import Depends, HTTPException, Request
from pymongo import ReturnDocument

from .db import get_db, now
from .radiosoft import secret_hash


def normalize_code(value):
    if not isinstance(value, str):
        raise ValueError("Enter the eight-digit pairing code")
    text = value.strip()
    compact = re.sub(r"\s", "", text)
    if re.fullmatch(r"[0-9]{8}", compact):
        return compact
    # Rolling upgrades: accept outstanding codes issued by the old server.
    if re.fullmatch(r"[A-Za-z0-9_-]{32,100}", text):
        return text
    raise ValueError("Enter the eight-digit pairing code")


def pairing_hash(code, request, purpose="radiosoft-real-pair"):
    if re.fullmatch(r"[0-9]{8}", code):
        return hmac.new(
            request.app.state.settings.jwt_secret.encode(),
            (purpose + ":" + code).encode(),
            hashlib.sha256,
        ).hexdigest()
    return secret_hash(code)


def pairing_attempt(request: Request, db=Depends(get_db)):
    # Database counters work across processes. Never trust raw forwarding headers.
    # A global pilot ceiling also bounds distributed guesses / proxy misconfiguration.
    timestamp = now()
    seconds = 300
    bucket = int(timestamp.timestamp()) // seconds
    peer = request.client.host if request.client else "unknown"
    for key, limit in (("global", 100), ("peer:" + secret_hash(peer), 10)):
        record = db.radiosoft_pair_limits.find_one_and_update(
            {"_id": f"{key}:{bucket}"},
            {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": timestamp + timedelta(seconds=600)}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        if record["count"] > limit:
            raise HTTPException(
                429, "Too many pairing attempts. Try again later.", headers={"Retry-After": "300"}
            )
