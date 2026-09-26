"""Keyed hashes for single-use email codes and owner-issued staff setup codes."""

import hashlib
import hmac


def code_hash(secret: str, challenge_id: str, code: str) -> str:
    return hmac.new(secret.encode(), f"{challenge_id}:{code}".encode(), hashlib.sha256).hexdigest()
