import json

import httpx

from .contract import local_api


class DeliveryError(Exception):
    def __init__(self, status, category=""):
        self.status = status
        self.category = category
        super().__init__(f"HTTP_{status}")  # Never retain response text, headers or request secrets.


class HttpTransport:
    prefix = "/api/radiosoft/connector/"
    allowed_paths = {"pair", "observations", "health"}

    def __init__(self, api):
        self.api = local_api(api)

    def post(self, path, body, credential=None):
        if path not in self.allowed_paths:
            raise ValueError("Unsupported endpoint")
        headers = {"Content-Type": "application/json"}
        if credential:
            headers["Authorization"] = "Bearer " + credential
        try:
            with httpx.Client(timeout=8, trust_env=False, follow_redirects=False) as client:
                with client.stream(
                    "POST", self.api + self.prefix + path, headers=headers, content=body
                ) as response:
                    if response.status_code != 200:
                        raise DeliveryError(response.status_code)
                    result = bytearray()
                    for chunk in response.iter_bytes():
                        result.extend(chunk)
                        if len(result) > 65536:
                            raise DeliveryError(422)
                    return json.loads(result)
        except (httpx.TransportError, OSError) as exc:
            # Exception class/errno only: never URLs, request bodies or driver text.
            cause = exc
            codes = []
            for _ in range(3):
                number = getattr(cause, "winerror", None) or getattr(cause, "errno", None)
                codes.append(type(cause).__name__ + ("_" + str(number) if type(number) is int else ""))
                if cause.__cause__ is None:
                    break
                cause = cause.__cause__
            raise DeliveryError(0, ":".join(codes)) from None
        except (ValueError, UnicodeError):
            raise DeliveryError(422) from None
