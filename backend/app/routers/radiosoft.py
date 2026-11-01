"""Synthetic RadioSoft preview only. Production ingestion/accounting have no activation path."""

import secrets
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import get_db, new_id, now
from ..radiosoft import (
    METHODS,
    apply_collection,
    bill_view,
    digest,
    effective_collections,
    evidence_view,
    ingest,
    secret_hash,
)
from ..radiosoft_schemas import (
    CollectionAction,
    DailyEvidence,
    Health,
    Observation,
    PairRequest,
    PilotSettings,
)
from ..security import current_identity, shop_access

router = APIRouter(tags=["RadioSoft synthetic preview"])
shop_path = "/shops/{shop_id}/radiosoft"
connector_path = "/radiosoft/connector"
bearer = HTTPBearer(auto_error=False)


def approved_scope(request, db, shop_id):
    settings = request.app.state.settings
    if not settings.radiosoft_synthetic_enabled or settings.app_env not in {"development", "test"}:
        return None
    shop = db.shops.find_one({"_id": shop_id})
    for scope in settings.radiosoft_pilots:
        if (
            scope.get("shop_id") == shop_id
            and shop
            and scope.get("owner_id") == shop["created_by"]
            and db.memberships.find_one(
                {"shop_id": shop_id, "user_id": scope["owner_id"], "role": "OWNER", "active": True}
            )
        ):
            # Fail closed on incomplete deployment configuration.
            if not scope.get("source_id") or not scope.get("firm_codes") or not scope.get("tracking_from"):
                return None
            date.fromisoformat(scope["tracking_from"])
            return scope
    return None


def scope_matches(config, scope):
    return scope and all(
        config.get(key) == scope.get(key) for key in ("source_id", "firm_codes", "tracking_from", "owner_id")
    )


def permissions(member, config, eligible):
    owner = member["role"] == "OWNER"
    enabled = eligible and config and config["mode"] == "PREVIEW"
    return {
        name: bool(enabled and (owner or config.get("manager_" + name, False)))
        for name in ("view", "collect", "correct")
    }


def access(request, db, shop_id, identity, permission=None):
    member, shop = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN"})
    scope = approved_scope(request, db, shop_id)
    config = db.radiosoft_integrations.find_one({"_id": shop_id})
    eligible = bool(scope and (not config or scope_matches(config, scope)))
    grants = permissions(member, config, eligible)
    if permission and not grants[permission]:
        raise HTTPException(403, "RadioSoft preview is disabled or this permission is not granted")
    return member, shop, scope if eligible else None, config, grants


def owner_access(request, db, shop_id, identity):
    result = access(request, db, shop_id, identity)
    if result[0]["role"] != "OWNER" or not result[2]:
        raise HTTPException(403, "An approved pilot shop owner is required")
    return result


def bill_scope(config):
    return {"shop_id": config["_id"], "source_id": config["source_id"], "generation": config["generation"]}


def load_bill(db, config, bill_id):
    bill = db.radiosoft_bills.find_one({"_id": bill_id, **bill_scope(config)})
    if not bill:
        raise HTTPException(404, "Bill not found in this source/shop")
    return bill


def connection_status(db, config):
    if not config or config["mode"] == "OFF":
        return {"connection": "DISABLED", "last_successful_sync": None, "last_contact": None, "stale": True}
    latest = db.radiosoft_bills.find_one(bill_scope(config), sort=[("observed_at", -1)])
    synced = latest["observed_at"] if latest else None
    observed = latest["source_observed_at"] if latest else None
    contact = config.get("last_contact")
    connected = contact and (now() - contact).total_seconds() <= 120
    return {
        "connection": "UNPAIRED"
        if not config.get("credential_hash")
        else "CONNECTED"
        if connected
        else "OFFLINE",
        "last_successful_sync": synced,
        "last_source_observation": observed,
        "last_contact": contact,
        "stale": not synced
        or (now() - synced).total_seconds() > 120
        or not observed
        or (now() - observed).total_seconds() > 120,
        "source_health": config.get("health", {"status": "SCAN_INCOMPLETE", "pending_observations": 0}),
    }


@router.get(shop_path + "/status")
def status(shop_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)):
    member, _, scope, config, grants = access(request, db, shop_id, identity)
    # No bill metadata is exposed to a manager without view permission.
    if member["role"] != "OWNER" and not grants["view"]:
        return {"eligible": False, "mode": "OFF", "permissions": grants}
    return {
        "eligible": bool(scope),
        "mode": config["mode"] if scope and config else "OFF",
        "revision": config["revision"] if config else 0,
        "permissions": grants,
        "accounting_available": False,
        "synthetic_only": True,
        "source_id": scope["source_id"] if scope else None,
        "firm_codes": scope["firm_codes"] if scope else [],
        "tracking_from": scope["tracking_from"] if scope else None,
        "manager_view": bool(config and config.get("manager_view")),
        "manager_collect": bool(config and config.get("manager_collect")),
        "manager_correct": bool(config and config.get("manager_correct")),
        "coverage": "UNVALIDATED — polling cannot establish complete edit/delete coverage",
        **connection_status(db, config if scope else None),
    }


@router.put(shop_path + "/settings")
def configure(
    shop_id: str,
    body: PilotSettings,
    request: Request,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    _, _, scope, config, _ = owner_access(request, db, shop_id, identity)
    if (config["revision"] if config else 0) != body.revision:
        raise HTTPException(409, "Settings changed. Refresh and retry.")
    audit = {
        "action": "SETTINGS",
        "at": now(),
        "actor_id": identity.user["_id"],
        "settings": body.model_dump(),
    }
    if not config:
        config = {
            "_id": shop_id,
            **{k: scope[k] for k in ("owner_id", "source_id", "firm_codes", "tracking_from")},
            "generation": new_id(),
            **body.model_dump(),
            "revision": 1,
            "audit": [audit],
        }
        try:
            db.radiosoft_integrations.insert_one(config)
        except DuplicateKeyError:
            raise HTTPException(409, "Settings changed. Refresh and retry.")
    else:
        patch = {
            "$set": {**body.model_dump(exclude={"revision"})},
            "$inc": {"revision": 1},
            "$push": {"audit": audit},
        }
        if body.mode == "OFF":
            patch["$unset"] = {"credential_hash": "", "pairing": "", "last_contact": "", "health": ""}
        result = db.radiosoft_integrations.update_one({"_id": shop_id, "revision": body.revision}, patch)
        if not result.modified_count:
            raise HTTPException(409, "Settings changed. Refresh and retry.")
    return status(shop_id, request, identity, db)


@router.post(shop_path + "/pairing")
def pairing(shop_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)):
    _, _, _, config, _ = owner_access(request, db, shop_id, identity)
    if not config or config["mode"] != "PREVIEW":
        raise HTTPException(409, "Enable synthetic preview before pairing")
    code = secrets.token_urlsafe(24)
    expires_at = now() + timedelta(minutes=5)
    result = db.radiosoft_integrations.update_one(
        {"_id": shop_id, "revision": config["revision"], "mode": "PREVIEW"},
        {
            "$set": {"pairing": {"code_hash": secret_hash(code), "expires_at": expires_at}},
            "$inc": {"revision": 1},
            "$push": {"audit": {"action": "PAIRING_CREATED", "at": now(), "actor_id": identity.user["_id"]}},
        },
    )
    if not result.modified_count:
        raise HTTPException(409, "Settings changed. Retry pairing.")
    return {"code": code, "expires_at": expires_at, "source_id": config["source_id"], "synthetic_only": True}


@router.post(shop_path + "/revoke")
def revoke(shop_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)):
    owner_access(request, db, shop_id, identity)
    db.radiosoft_integrations.update_one(
        {"_id": shop_id},
        {
            "$unset": {"credential_hash": "", "pairing": "", "last_contact": "", "health": ""},
            "$inc": {"revision": 1},
            "$push": {"audit": {"action": "REVOKED", "at": now(), "actor_id": identity.user["_id"]}},
        },
    )
    return {"revoked": True}


def connector_request(request):
    if request.query_params or request.headers.get("x-hishob-shop"):
        raise HTTPException(400, "Connector scope comes only from its credential")


@router.post(connector_path + "/pair")
def exchange(body: PairRequest, request: Request, db=Depends(get_db)):
    connector_request(request)
    config = db.radiosoft_integrations.find_one(
        {"pairing.code_hash": secret_hash(body.code), "pairing.expires_at": {"$gt": now()}, "mode": "PREVIEW"}
    )
    if not config or not scope_matches(config, approved_scope(request, db, config["_id"])):
        raise HTTPException(401, "Invalid or expired pairing code")
    credential_hash = secret_hash(body.credential)
    # Caller durably generates its random secret BEFORE exchange. Same-proof retries
    # recover lost responses without ever returning a credential from the server.
    updated = db.radiosoft_integrations.find_one_and_update(
        {
            "_id": config["_id"],
            "revision": config["revision"],
            "pairing.code_hash": secret_hash(body.code),
            "pairing.expires_at": {"$gt": now()},
            "$or": [{"pairing.claimed_hash": {"$exists": False}}, {"pairing.claimed_hash": credential_hash}],
        },
        {
            "$set": {"credential_hash": credential_hash, "pairing.claimed_hash": credential_hash},
            "$inc": {"revision": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(409, "Pairing code already consumed or settings changed")
    return {
        "version": 1,
        "shop_id": config["_id"],
        "source_id": config["source_id"],
        "generation": config["generation"],
        "firm_codes": config["firm_codes"],
        "invoice_types": [0, 1],
        "tracking_from": config["tracking_from"],
        "synthetic_only": True,
        "next_action": "SEND_SYNTHETIC_OBSERVATIONS",
    }


def connector_auth(
    request: Request, credentials: HTTPAuthorizationCredentials = Depends(bearer), db=Depends(get_db)
):
    connector_request(request)
    config = (
        db.radiosoft_integrations.find_one(
            {"credential_hash": secret_hash(credentials.credentials), "mode": "PREVIEW"}
        )
        if credentials
        else None
    )
    if not config or not scope_matches(config, approved_scope(request, db, config["_id"])):
        raise HTTPException(401, "Connector disabled, revoked or outside approved scope")
    return config


@router.post(connector_path + "/observations")
def observation(body: Observation, config=Depends(connector_auth), db=Depends(get_db)):
    return ingest(db, config, body)


@router.post(connector_path + "/health")
def health(body: Health, config=Depends(connector_auth), db=Depends(get_db)):
    db.radiosoft_integrations.update_one(
        {"_id": config["_id"], "credential_hash": config["credential_hash"]},
        {"$set": {"last_contact": now(), "health": body.model_dump()}},
    )
    return {"received": True}  # Heartbeats never advance last_successful_sync.


@router.get(shop_path + "/bills")
def bills(
    shop_id: str,
    request: Request,
    after: str = Query(default="", max_length=64),
    limit: int = Query(default=50, ge=1, le=100),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    _, _, _, config, grants = access(request, db, shop_id, identity, "view")
    query = {**bill_scope(config), "_id": {"$gt": after}}
    rows = list(db.radiosoft_bills.find(query).sort("_id", 1).limit(limit + 1))
    return {
        "bills": [bill_view(row, config) for row in rows[:limit]],
        "next_cursor": rows[limit - 1]["_id"] if len(rows) > limit else None,
        "permissions": grants,
        "mode": "PREVIEW",
        **connection_status(db, config),
    }


@router.get(shop_path + "/bills/{bill_id}")
def bill(
    shop_id: str, bill_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)
):
    _, _, _, config, _ = access(request, db, shop_id, identity, "view")
    return bill_view(load_bill(db, config, bill_id), config, True)


@router.post(shop_path + "/bills/{bill_id}/collections")
def collection(
    shop_id: str,
    bill_id: str,
    body: CollectionAction,
    request: Request,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    permission = "correct" if body.action in {"RECLASSIFY", "REVERSE"} else "collect"
    _, shop, _, config, _ = access(request, db, shop_id, identity, permission)
    # Reading the obligation is required even when collection/correction is delegated.
    access(request, db, shop_id, identity, "view")
    today = now().astimezone(ZoneInfo(shop["timezone"])).date().isoformat()
    return apply_collection(db, load_bill(db, config, bill_id), config, body, identity, today)


@router.post(shop_path + "/daily-evidence")
def record_evidence(
    shop_id: str,
    body: DailyEvidence,
    request: Request,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    access(request, db, shop_id, identity, "collect")
    _, _, _, config, _ = access(request, db, shop_id, identity, "view")
    document = {
        "_id": digest([shop_id, body.request_id]),
        **bill_scope(config),
        **body.model_dump(mode="json"),
        "actor_id": identity.user["_id"],
        "at": now(),
        "request_digest": digest(body.model_dump(mode="json")),
    }
    try:
        db.radiosoft_evidence.insert_one(document)
    except DuplicateKeyError:
        existing = db.radiosoft_evidence.find_one({"_id": document["_id"]})
        if (
            existing["request_digest"] != document["request_digest"]
            or existing["actor_id"] != identity.user["_id"]
        ):
            raise HTTPException(409, "Request ID already used for another evidence entry")
        document = existing
    return evidence_view(document)


@router.get(shop_path + "/daily-evidence/{business_date}")
def reconciliation(
    shop_id: str,
    business_date: date,
    request: Request,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    _, _, _, config, _ = access(request, db, shop_id, identity, "view")
    totals = {method: 0 for method in METHODS}
    for row in db.radiosoft_bills.find({**bill_scope(config), "events.business_date": str(business_date)}):
        for receipt in effective_collections(row):
            if not receipt["reversed"] and receipt["business_date"] == str(business_date):
                for allocation in receipt["allocations"]:
                    totals[allocation["method"]] += allocation["amount_paise"]
    evidence = list(
        db.radiosoft_evidence.find({**bill_scope(config), "date": str(business_date)})
        .sort([("at", -1), ("_id", -1)])
        .limit(101)
    )
    # Evidence is a replacement observation of one scope, never additive receipts.
    latest = evidence[0] if evidence else None
    return {
        "date": str(business_date),
        "recorded": totals,
        "evidence": [evidence_view(e) for e in evidence[:100]],
        "history_truncated": len(evidence) > 100,
        "difference": {m: latest[m.lower() + "_paise"] - totals[m] for m in ("UPI", "CARD")}
        if latest
        else None,
        "fully_reconciled": False,
        "bank_verified": False,
        "explanation": "Recorded methods only. Unspecified methods, settlement timing and bank verification require independent review.",
    }
