"""Local synthetic test helper, NOT the Windows connector. Secrets stay in memory."""

import argparse
import getpass
import json
import queue
import secrets
import sys
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

LOOPBACK = {"localhost", "127.0.0.1", "::1"}
FIXTURE = Path(__file__).resolve().parents[1] / "tests/fixtures/radiosoft-observation.json"


def local_api(value):
    parsed = urlparse(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in LOOPBACK
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise argparse.ArgumentTypeError("Use a loopback API address, e.g. http://localhost:8001")
    return value.rstrip("/")


def print_ids():
    from pymongo import MongoClient

    from app.config import Settings

    settings = Settings()
    if (
        settings.app_env not in {"development", "test"}
        or urlparse(settings.mongodb_uri).hostname not in LOOPBACK
    ):
        raise RuntimeError("This helper only reads a local development/test database")
    with MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=3000) as client:
        shops = list(client[settings.mongodb_database].shops.find({}, {"name": 1, "created_by": 1}))
    print("Use a dedicated RadioSoft Demo shop created through local Hishob.\n")
    for shop in shops:
        scope = {
            "shop_id": shop["_id"],
            "owner_id": shop["created_by"],
            "source_id": "synthetic-installation",
            "firm_codes": [0],
            "tracking_from": "2026-11-01",
        }
        print(f"Shop: {shop['name']}")
        print("RADIOSOFT_PILOTS=" + json.dumps([scope], separators=(",", ":")))
        print()
    if not shops:
        print("No local shops found. Sign up as an owner and create RadioSoft Demo in the web app first.")
    print("Copy ONLY the demo shop's line into backend/.env, without a leading #, then restart the API.")


def post(api, path, body, credential=None):
    headers = {"Content-Type": "application/json"}
    if credential:
        headers["Authorization"] = "Bearer " + credential
    encoded = json.dumps(body).encode()
    # Exact-body retries are safe for pairing, observations and health. No secrets logged.
    for attempt in range(3):
        try:
            request = Request(
                api + "/api/radiosoft/connector/" + path, data=encoded, headers=headers, method="POST"
            )
            with urlopen(request, timeout=10) as response:
                return json.load(response)
        except HTTPError as error:
            if error.code < 500 or attempt == 2:
                detail = json.loads(error.read()).get("detail", "Request rejected")
                raise RuntimeError(f"HTTP {error.code}: {detail}") from None
        except (URLError, TimeoutError):
            if attempt == 2:
                raise RuntimeError("Local API unavailable. Check http://localhost:8000/health.") from None
        time.sleep(1)


def make_bills(scope):
    # New references per run; never overwrite bills from an earlier demo run.
    prefix = str(time.time_ns() // 1000)
    template = json.loads(FIXTURE.read_text())
    bills = []
    for offset, amount in enumerate(["1000.00", "750.00", "1500.00"]):
        bill = deepcopy(template)
        bill.update(
            source_id=scope["source_id"],
            generation=scope["generation"],
            sequence=1,
            business_date=scope["tracking_from"],
        )
        bill["key"].update(invoice_no=str(int(prefix) + offset), firm_code=scope["firm_codes"][0])
        bill["amounts"]["net_amt"] = amount
        bill["lines"][0].update(
            description=f"Synthetic item {offset + 1}",
            amount=amount,
            salesperson_ref=f"SYN-STAFF-{offset % 2 + 1}",
            salesperson_name=f"Demo Worker {offset % 2 + 1}",
        )
        if offset == 2:
            bill["lines"][0]["amount"] = "750.00"
            bill["lines"].append(
                {
                    **bill["lines"][0],
                    "description": "Synthetic second item",
                    "salesperson_ref": "SYN-STAFF-2",
                    "salesperson_name": "Demo Worker 2",
                }
            )
        bills.append(bill)
    return bills


def demo(api, interval=30):
    print("Synthetic local demo only. No RadioSoft/SQL access; no accounting activation.")
    code = getpass.getpass("Paste the five-minute pairing code (input hidden): ").strip()
    credential = secrets.token_urlsafe(32)
    scope = post(api, "pair", {"code": code, "credential": credential})
    if scope.get("synthetic_only") is not True:
        raise RuntimeError("Refusing a non-synthetic pairing")
    bills = make_bills(scope)
    sequence = 0

    def sync():
        nonlocal sequence
        for bill in bills:
            sequence += 1
            bill.update(sequence=sequence, observed_at=datetime.now(timezone.utc).isoformat())
            post(api, "observations", bill, credential)
        post(api, "health", {"status": "OK", "pending_observations": 0}, credential)
        print("Synced. The web page should refresh within about 10 seconds.")

    sync()
    print("Demo bill references:")
    for bill in bills:
        print(f"  {bill['key']['invoice_no']}: Rs {bill['amounts']['net_amt']}")
    print("\nOpen Bills & Collections. Try partial, split and unspecified payments.")
    print("Automatic synthetic sync every 30 seconds while this helper runs. p pauses it; r resumes.")
    actions = queue.Queue()

    def read_actions():
        while True:
            try:
                action = (
                    input(
                        "\nr=refresh/resume, p=pause, +=1200, -=800, m=missing, c=cancelled, u=restore, h=source outage, q=quit: "
                    )
                    .strip()
                    .lower()
                )
            except (EOFError, KeyboardInterrupt):
                action = "q"
            actions.put(action)
            if action == "q":
                return

    threading.Thread(target=read_actions, daemon=True).start()
    automatic = True
    while True:
        try:
            action = actions.get(timeout=interval)
        except queue.Empty:
            if automatic:
                sync()
            continue
        if action == "q":
            print(
                "Demo stopped. Credentials were held only in memory. Revoke the connector in setup when finished."
            )
            return
        if action == "h":
            automatic = False
            post(api, "health", {"status": "SOURCE_UNAVAILABLE", "pending_observations": 0}, credential)
            print("Source outage reported; existing bills and collections remain.")
            continue
        if action == "p":
            automatic = False
            print("Auto-sync paused. After 2 minutes the page will warn offline/stale. r resumes.")
            continue
        if action == "r":
            automatic = True
        if action in {"+", "-"}:
            bills[0]["amounts"]["net_amt"] = "1200.00" if action == "+" else "800.00"
            bills[0]["lines"][0]["amount"] = bills[0]["amounts"]["net_amt"]
        elif action in {"m", "c", "u"}:
            bills[0]["source_status"] = {"m": "MISSING_REVIEW", "c": "CANCELLED", "u": "CURRENT"}[action]
            bills[0]["lifecycle_evidence"] = "Synthetic menu action; not a real source lifecycle observation"
        elif action != "r":
            print("Choose one of the listed actions.")
            continue
        sync()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["ids", "demo"])
    parser.add_argument("--api", default="http://localhost:8001", type=local_api)
    args = parser.parse_args()
    try:
        print_ids() if args.command == "ids" else demo(args.api)
    except (RuntimeError, KeyboardInterrupt, EOFError) as error:
        print(str(error) or "Demo stopped.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
