"""Provider boundary: implement send() and register a provider to add real SMS."""

import hashlib
import hmac
from typing import Protocol

from .config import Settings


class OTPProvider(Protocol):
    def send(self, mobile: str, code: str) -> None: ...


class DevOTPProvider:
    def send(self, mobile: str, code: str) -> None:
        # Code is displayed only in the development API response, never logged.
        pass


def get_provider(settings: Settings) -> OTPProvider:
    if settings.otp_provider == "dev" and settings.app_env in {"development", "test"}:
        return DevOTPProvider()
    raise RuntimeError("Configure an SMS provider before enabling production")


def code_hash(secret: str, challenge_id: str, code: str) -> str:
    return hmac.new(secret.encode(), f"{challenge_id}:{code}".encode(), hashlib.sha256).hexdigest()
