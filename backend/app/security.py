from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import get_db, now

bearer = HTTPBearer(auto_error=False)


@dataclass
class Identity:
    user: dict
    role: str
    session_id: str


def current_identity(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db=Depends(get_db),
):
    unauthorized = HTTPException(401, "Session expired. Please log in again.")
    if credentials is None:
        raise unauthorized
    try:
        claims = jwt.decode(
            credentials.credentials,
            request.app.state.settings.jwt_secret,
            algorithms=["HS256"],
            audience="hisab-mobile",
            issuer="hisab-api",
            options={"require": ["sub", "exp", "iat", "jti", "portal"]},
        )
    except jwt.InvalidTokenError:
        raise unauthorized
    session = db.sessions.find_one(
        {
            "_id": claims["jti"],
            "user_id": claims["sub"],
            "role": claims["portal"],
            "revoked": False,
            "expires_at": {"$gt": now()},
        }
    )
    user = db.users.find_one({"_id": claims["sub"]})
    if not user or not session or claims["portal"] not in {"OWNER", "MANAGER", "WORKER"}:
        raise unauthorized
    return Identity(user, claims["portal"], claims["jti"])


def require_owner(identity=Depends(current_identity)):
    if identity.role != "OWNER":
        raise HTTPException(403, "Owner access required")
    return identity


def shop_access(shop_id: str, db, identity: Identity, roles: set[str]):
    # The path is only a selector: every request rechecks a live membership.
    portal_roles = {"MANAGER", "ADMIN"} if identity.role == "MANAGER" else {identity.role}
    membership = db.memberships.find_one(
        {
            "shop_id": shop_id,
            "user_id": identity.user["_id"],
            "active": True,
            "role": {"$in": list(roles & portal_roles)},
        }
    )
    if not membership:
        raise HTTPException(403, "You do not have access to this shop")
    shop = db.shops.find_one({"_id": shop_id})
    if not shop:
        raise HTTPException(404, "Shop not found")
    return membership, shop


def worker_in_shop(db, shop_id, worker_id, active_only=False):
    query = {"_id": worker_id, "shop_id": shop_id, "role": "WORKER"}
    if active_only:
        query["active"] = True
    membership = db.memberships.find_one(query)
    if not membership:
        raise HTTPException(404, "Worker not found in this shop")
    return membership
