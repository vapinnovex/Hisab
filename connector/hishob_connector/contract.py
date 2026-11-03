import json
from importlib.resources import files
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator, FormatChecker

SCHEMA = json.loads(files("hishob_connector").joinpath("observation.schema.json").read_text())
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
MAX_SEQUENCE = 9_007_199_254_740_991


def encoded(body):
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def local_api(value):
    parsed = urlsplit(value)
    # Literal IP only: no DNS rebinding, redirects, proxy or remote production API.
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or not parsed.port
    ):
        raise ValueError("This synthetic build requires http://127.0.0.1:<development-port>")
    return value.rstrip("/")


def validate_observation(body):
    VALIDATOR.validate(body)
    # The draft schema's const true can equate 1 to true in some validators.
    if body.get("synthetic") is not True or type(body.get("sequence")) is not int:
        raise ValueError("Strict synthetic observation required")
    if not 1 <= body["sequence"] <= MAX_SEQUENCE:
        raise ValueError("Sequence exhausted")
    # FormatChecker's optional RFC3339 dependency may be absent in a minimal bundle.
    # Enforce the fields used by this contract with the standard library as well.
    from datetime import date, datetime

    if datetime.fromisoformat(body["observed_at"].replace("Z", "+00:00")).tzinfo is None:
        raise ValueError("Observation timestamp requires a timezone")
    date.fromisoformat(body["business_date"])


def validate_pair(body):
    expected = {
        "version",
        "shop_id",
        "source_id",
        "generation",
        "firm_codes",
        "invoice_types",
        "tracking_from",
        "synthetic_only",
        "next_action",
    }
    if set(body) != expected or body["synthetic_only"] is not True or body["version"] != 1:
        raise ValueError("Incompatible synthetic pairing response")
    if body["next_action"] != "SEND_SYNTHETIC_OBSERVATIONS" or body["invoice_types"] != [0, 1]:
        raise ValueError("Unsupported pairing contract")
    for key in ("shop_id", "source_id", "generation"):
        if not isinstance(body[key], str) or not 1 <= len(body[key]) <= 100:
            raise ValueError("Invalid source binding")
    if not body["firm_codes"] or any(type(x) is not int or x < 0 for x in body["firm_codes"]):
        raise ValueError("Invalid firm scope")
    from datetime import date

    date.fromisoformat(body["tracking_from"])
    return body
