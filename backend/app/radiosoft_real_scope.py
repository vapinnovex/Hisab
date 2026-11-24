"""Operator-only: approve, inspect or revoke one shop's real RadioSoft connector scope.

Writes to whichever database MONGODB_URI / MONGODB_DATABASE point at (the same settings
the API uses). Without --yes, create/revoke/restore only print what they would do.

  python -m app.radiosoft_real_scope create --shop-id ID --source-id shop-abc-pc1 \
      --generation rsdb-abc-gen1 --tracking-from 2026-12-01 [--capture-from ...] \
      [--capture-until ...] [--firm-codes 0] [--invoice-types 0,1] [--yes]
  python -m app.radiosoft_real_scope show --shop-id ID
  python -m app.radiosoft_real_scope revoke --shop-id ID [--yes]
  python -m app.radiosoft_real_scope restore --shop-id ID [--yes]

The scope is pinned by the paired PC: once a connector is set up, its source, generation,
firms, types and dates cannot be edited here. Choose a generous capture window up front.
"""

import argparse
import json
from datetime import date

from pydantic import ValidationError
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError

from .config import get_settings
from .db import create_indexes, now
from .radiosoft_real_schemas import RealScope


def integers(text):
    try:
        return [int(part) for part in text.split(",") if part.strip()]
    except ValueError:
        raise argparse.ArgumentTypeError("Use comma-separated whole numbers, e.g. 0,1")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="Approve a new shop")
    create.add_argument("--shop-id", required=True)
    create.add_argument("--source-id", required=True, help="Stable ID for this PC install; never change it")
    create.add_argument(
        "--generation", required=True, help="Stable ID for this RsDB database; never change it"
    )
    create.add_argument("--tracking-from", required=True, type=date.fromisoformat)
    create.add_argument("--capture-from", type=date.fromisoformat, help="Default: same as --tracking-from")
    create.add_argument("--capture-until", type=date.fromisoformat, help="Exclusive. Default: 2 years later")
    create.add_argument("--firm-codes", type=integers, default=[0])
    create.add_argument("--invoice-types", type=integers, default=[0, 1])
    create.add_argument("--yes", action="store_true", help="Write the change (otherwise preview only)")
    for name, text in (
        ("show", "Print a shop's scope"),
        ("revoke", "Disable a shop"),
        ("restore", "Undo revoke"),
    ):
        command = commands.add_parser(name, help=text)
        command.add_argument("--shop-id", required=True)
        if name != "show":
            command.add_argument(
                "--yes", action="store_true", help="Write the change (otherwise preview only)"
            )
    return parser.parse_args(argv)


def two_years_after(day):
    try:
        return day.replace(year=day.year + 2)
    except ValueError:  # 29 February
        return day.replace(year=day.year + 2, day=28)


def owner_of(db, shop_id):
    shop = db.shops.find_one({"_id": shop_id})
    if not shop:
        raise SystemExit("No shop with that ID in this database.")
    owner_id = shop.get("created_by")
    if not owner_id or not db.memberships.find_one(
        {"shop_id": shop_id, "user_id": owner_id, "role": "OWNER", "active": True}
    ):
        raise SystemExit("The shop's creator is not an active owner. Fix ownership before approving.")
    return shop, db.users.find_one({"_id": owner_id}) or {"_id": owner_id}


def describe(shop, owner):
    who = owner.get("email") or owner.get("mobile") or owner["_id"]
    return f"shop '{shop.get('name', shop['_id'])}' owned by {owner.get('name') or 'owner'} <{who}>"


def run(db, args, environment):
    print(f"Database: {db.name} (APP_ENV={environment})")
    if args.command == "create":
        shop, owner = owner_of(db, args.shop_id)
        capture_from = args.capture_from or args.tracking_from
        capture_until = args.capture_until or two_years_after(args.tracking_from)
        try:
            approved = RealScope(
                shop_id=args.shop_id,
                owner_id=owner["_id"],
                source_id=args.source_id,
                generation=args.generation,
                database="RsDB",
                firm_codes=args.firm_codes,
                invoice_types=args.invoice_types,
                tracking_from=args.tracking_from,
                capture_from=capture_from,
                capture_until=capture_until,
            )
        except ValidationError as error:
            raise SystemExit(f"Invalid scope: {error.errors()[0]['loc']} {error.errors()[0]['msg']}")
        if not approved.capture_from <= approved.tracking_from < approved.capture_until:
            raise SystemExit("Dates must satisfy capture-from <= tracking-from < capture-until.")
        if any(code < 0 for code in approved.firm_codes):
            raise SystemExit("Firm codes cannot be negative.")
        if db.radiosoft_real_scopes.find_one({"_id": args.shop_id}):
            raise SystemExit("This shop already has a scope. Use show, revoke or restore.")
        document = approved.model_dump(mode="json")
        print(f"Approve {describe(shop, owner)}:")
        print(json.dumps(document, indent=2))
        if not args.yes:
            print("Preview only. Re-run with --yes to save.")
            return 0
        try:
            db.radiosoft_real_scopes.insert_one(
                {"_id": args.shop_id, "scope": document, "revoked": False, "created_at": now(), "audit": []}
            )
        except DuplicateKeyError:
            raise SystemExit("This shop already has a scope. Use show, revoke or restore.")
        print("Saved. The owner can now open Connection settings in the Hishob app.")
        return 0

    stored = db.radiosoft_real_scopes.find_one({"_id": args.shop_id})
    if not stored:
        raise SystemExit("This shop has no RadioSoft scope in this database.")
    if args.command == "show":
        integration = db.radiosoft_real_integrations.find_one({"_id": args.shop_id}) or {}
        print(
            json.dumps(
                {
                    "scope": stored["scope"],
                    "revoked": bool(stored.get("revoked")),
                    "setup_confirmed": bool(integration),
                    "connector_enabled": bool(integration.get("enabled")),
                    "paired": bool(integration.get("credential_hash")),
                    "last_contact": str(integration["last_contact"])
                    if integration.get("last_contact")
                    else None,
                },
                indent=2,
            )
        )
        return 0
    revoke = args.command == "revoke"
    if bool(stored.get("revoked")) == revoke:
        print("Nothing to change: the scope is already " + ("revoked." if revoke else "active."))
        return 0
    print(("Revoke" if revoke else "Restore") + f" the RadioSoft scope for shop {args.shop_id}.")
    if not args.yes:
        print("Preview only. Re-run with --yes to save.")
        return 0
    db.radiosoft_real_scopes.update_one(
        {"_id": args.shop_id},
        {
            "$set": {"revoked": revoke},
            "$push": {"audit": {"action": "REVOKED" if revoke else "RESTORED", "at": now()}},
        },
    )
    print("Saved. The connector stops on its next request." if revoke else "Saved. The connector may resume.")
    return 0


def main(argv=None):
    args = parse_args(argv)
    config = get_settings()
    with MongoClient(config.mongodb_uri, tz_aware=True) as connection:
        db = connection[config.mongodb_database]
        create_indexes(db)
        return run(db, args, config.app_env)


if __name__ == "__main__":
    raise SystemExit(main())
