"""Operator-only migration for legacy owners who no longer have a signed-in device.

Run after verifying the owner's identity and recovery email out of band.
Does not set a password or log anyone in; email OTP recovery must still succeed.
"""

import argparse

from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError

from .config import get_settings
from .db import create_indexes
from .password_schemas import EmailInput
from .routers.password_auth import is_owner, version_query
from .schemas import MobileInput


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mobile", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--identity-checked", action="store_true", required=True)
    args = parser.parse_args()
    mobile = MobileInput(mobile=args.mobile).mobile
    email = str(EmailInput(email=args.email).email).lower()
    config = get_settings()
    with MongoClient(config.mongodb_uri, tz_aware=True) as connection:
        db = connection[config.mongodb_database]
        create_indexes(db)
        user = db.users.find_one({"mobile": mobile})
        if not user or not is_owner(db, user) or user.get("password_hash") or user.get("email_verified"):
            raise SystemExit("Only a legacy owner without a password/verified email can be enrolled here.")
        try:
            result = db.users.update_one(
                version_query(user),
                {
                    "$set": {"email": email, "email_verified": False, "owner_registered": True},
                    "$inc": {"auth_version": 1},
                    "$unset": {"session_slots": ""},
                },
            )
        except DuplicateKeyError:
            raise SystemExit("Email already belongs to another account.")
        if not result.modified_count:
            raise SystemExit("Account changed. Check it before retrying.")
        print("Recovery email linked. The owner must now use Forgot password and verify their email code.")


if __name__ == "__main__":
    main()
