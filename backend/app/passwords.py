"""Password hashing and validation. Secrets never belong in public user views."""

import re

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import HTTPException

hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
DUMMY_HASH = hasher.hash("not-a-user-password")


def hash_password(value):
    return hasher.hash(value)


def verify_password(encoded, value):
    try:
        return hasher.verify(encoded or DUMMY_HASH, value) and bool(encoded)
    except (VerificationError, InvalidHashError):
        return False


def validate_password(value, confirm, mobile="", email=""):
    if value != confirm:
        raise HTTPException(422, "Passwords do not match.")
    if not 12 <= len(value) <= 128 or not value.strip() or value != value.strip():
        raise HTTPException(422, "Use 12–128 characters, without spaces at the beginning or end.")
    common_stem = re.sub(r"[^a-z]", "", value.casefold())
    if (
        len(set(value)) < 4
        or common_stem
        in {
            "password",
            "qwerty",
            "admin",
            "administrator",
            "welcome",
            "letmein",
            "hishob",
            "iloveyou",
            "correcthorsebatterystaple",
        }
        or value.lower()
        in {
            "password12345",
            "password123456",
            "123456789012",
            "qwerty12345678",
            "hishob12345678",
        }
    ):
        raise HTTPException(422, "This password is too common. Choose a longer, unique passphrase.")
    if (mobile and mobile.lstrip("+") in value) or (email and value.casefold() == email.casefold()):
        raise HTTPException(422, "Do not use your mobile number or email as your password.")


def user_view(user):
    return {
        "id": user["_id"],
        "mobile": user["mobile"],
        "name": user.get("name"),
        "email": user.get("email"),
        "password_ready": bool(user.get("password_hash")),
        "email_verified": bool(user.get("email_verified")),
    }
