"""Allowlisted diagnostics: no credential, pairing code, source row or personal name."""

import hashlib
from datetime import datetime, timezone

from . import __version__


def redacted_status(store):
    status = store.status()
    binding = status.pop("binding", None)
    if binding:
        status["binding"] = {
            key: (
                "masked-" + hashlib.sha256(value.encode()).hexdigest()[:12]
                if key in {"shop_id", "source_id", "generation"}
                else value
            )
            for key, value in binding.items()
        }
    return {
        "connector_version": __version__,
        "exported_utc": datetime.now(timezone.utc).isoformat(),
        "mode_boundary": "SYNTHETIC_LOOPBACK_ONLY",
        "status": status,
    }
