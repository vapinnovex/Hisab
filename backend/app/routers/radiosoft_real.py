"""DEV-only real preview. Separate collections, credentials and routes from v1."""

import re
import secrets
from datetime import date as Date
from datetime import time, timedelta
from decimal import ROUND_HALF_UP, Decimal, localcontext
from zoneinfo import ZoneInfo

from bson import BSON
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from pymongo.write_concern import WriteConcern

from ..db import get_db as application_db
from ..db import now
from ..radiosoft import digest, secret_hash
from ..radiosoft_real_schemas import (
    Mapping,
    RealHealth,
    RealObservation,
    RealPairRequest,
    Setup,
)
from ..radiosoft_schemas import CollectionAction
from ..real_pairing import pairing_attempt, pairing_hash
from ..security import current_identity, shop_access, worker_in_shop
from .radiosoft import connector_request


def get_db(db=Depends(application_db)):
    # Do not acknowledge ingestion until the journal/replica durability contract holds.
    return db.with_options(write_concern=WriteConcern(w="majority", j=True))


router = APIRouter(tags=["RadioSoft real DEV preview"])
shop_path = "/shops/{shop_id}/radiosoft-real"
connector_path = "/radiosoft/real-connector"
bearer = HTTPBearer(auto_error=False)


def scope(request, db, shop_id):
    settings = request.app.state.settings
    if not settings.radiosoft_real_enabled or settings.app_env not in {"development", "test"}:
        raise HTTPException(403, "Real DEV preview disabled")
    scopes = [s.model_dump(mode="json") for s in settings.radiosoft_real_pilots if s.shop_id == shop_id]
    if len(scopes) != 1:
        raise HTTPException(403, "Exactly one deployment scope is required")
    s = scopes[0]
    shop = db.shops.find_one({"_id": shop_id, "created_by": s["owner_id"]})
    if not shop or not db.memberships.find_one(
        {"shop_id": shop_id, "user_id": s["owner_id"], "role": "OWNER", "active": True}
    ):
        raise HTTPException(403, "Configured owner does not own this shop")
    if not s["capture_from"] <= s["tracking_from"] < s["capture_until"] or any(
        x < 0 for x in s["firm_codes"]
    ):
        raise HTTPException(403, "Invalid capture/tracking scope")
    return s


def access(request, db, shop_id, identity, permission="view"):
    member, _ = shop_access(shop_id, db, identity, {"OWNER", "MANAGER", "ADMIN", "WORKER"})
    s = scope(request, db, shop_id)
    config = db.radiosoft_real_integrations.find_one({"_id": shop_id})
    if config and config["scope"] != s:
        raise HTTPException(409, "Deployment binding changed; restore it or use reviewed recovery")
    owner = member["role"] == "OWNER" and identity.user["_id"] == s["owner_id"]
    allowed = (
        owner
        or (
            permission in {"view", "map", "collect", "correct"}
            and member["role"]
            in ({"MANAGER"} if permission in {"collect", "correct"} else {"MANAGER", "ADMIN"})
            and config
            and config.get("manager_" + permission)
        )
        or (permission == "report" and member["role"] == "WORKER")
    )
    if permission == "status" and member["role"] in {"MANAGER", "ADMIN"}:
        allowed = bool(
            config
            and any(config.get("manager_" + delegated) for delegated in ("view", "map", "collect", "correct"))
        )
    if permission == "report" and member["role"] in {"MANAGER", "ADMIN"}:
        allowed = bool(config and config.get("manager_view"))
    if not allowed:
        raise HTTPException(403, "This preview permission is not granted")
    return member, s, config


def binding(config):
    return {
        "version": 2,
        **config["scope"],
        "synthetic_only": False,
        "next_action": "SEND_REAL_REVIEW_OBSERVATIONS",
    }


@router.post(shop_path + "/setup")
def setup(
    shop_id: str, body: Setup, request: Request, identity=Depends(current_identity), db=Depends(get_db)
):
    _, s, old = access(request, db, shop_id, identity, "owner")
    if body.scope.model_dump(mode="json") != s:
        raise HTTPException(409, "Explicit confirmation must match the configured source, dates and scope")
    audit = {
        "action": "SETUP_CONFIRMED",
        "actor_id": identity.user["_id"],
        "at": now(),
        "scope": s,
        "manager_view": body.manager_view,
        "manager_map": body.manager_map,
        "manager_collect": body.manager_collect,
        "manager_correct": body.manager_correct,
    }
    if old:
        db.radiosoft_real_integrations.update_one(
            {"_id": shop_id},
            {
                "$set": {
                    "enabled": True,
                    "manager_view": body.manager_view,
                    "manager_map": body.manager_map,
                    "manager_collect": body.manager_collect,
                    "manager_correct": body.manager_correct,
                },
                "$push": {"audit": audit},
            },
        )
    else:
        try:
            db.radiosoft_real_integrations.insert_one(
                {
                    "_id": shop_id,
                    "scope": s,
                    "enabled": True,
                    "manager_view": body.manager_view,
                    "manager_map": body.manager_map,
                    "manager_collect": body.manager_collect,
                    "manager_correct": body.manager_correct,
                    "last_sequence": 0,
                    "audit": [audit],
                }
            )
        except DuplicateKeyError:
            raise HTTPException(409, "Setup changed; retry")
    return {"confirmed": True, "accounting_available": False, "scope": s}


@router.post(shop_path + "/pairing")
def pairing(shop_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)):
    _, s, c = access(request, db, shop_id, identity, "owner")
    if not c or not c["enabled"]:
        raise HTTPException(409, "Confirm setup first")
    if c.get("pair_created_at") and (now() - c["pair_created_at"]).total_seconds() < 30:
        raise HTTPException(429, "Wait before creating another pairing code")
    timestamp = now()
    expires = timestamp + timedelta(minutes=5)
    for _ in range(20):
        code = f"{secrets.randbelow(100_000_000):08d}"
        if pairing_hash(code, request) == c.get("pairing", {}).get("code_hash"):
            continue
        try:
            updated = db.radiosoft_real_integrations.find_one_and_update(
                {
                    "_id": shop_id,
                    "enabled": True,
                    "scope": s,
                    "$or": [
                        {"pair_created_at": {"$exists": False}},
                        {"pair_created_at": {"$lte": timestamp - timedelta(seconds=30)}},
                    ],
                },
                {
                    "$set": {
                        "pairing": {"code_hash": pairing_hash(code, request), "expires_at": expires},
                        "pair_created_at": timestamp,
                    },
                    "$push": {
                        "audit": {
                            "action": "PAIRING_CREATED",
                            "actor_id": identity.user["_id"],
                            "at": timestamp,
                        }
                    },
                },
            )
        except DuplicateKeyError:
            # The unique index prevents active-code collisions, including concurrent issuance.
            continue
        if not updated:
            raise HTTPException(429, "Wait before creating another pairing code")
        return {"code": code, "expires_at": expires, "scope": c["scope"]}
    raise HTTPException(503, "Could not issue a unique code. Retry shortly.")


@router.post(connector_path + "/pair", dependencies=[Depends(pairing_attempt)])
def exchange(body: RealPairRequest, request: Request, db=Depends(get_db)):
    connector_request(request)
    query = {
        "pairing.code_hash": pairing_hash(body.code, request),
        "pairing.expires_at": {"$gt": now()},
        "enabled": True,
    }
    c = db.radiosoft_real_integrations.find_one(query)
    if not c or c["scope"] != scope(request, db, c["_id"]):
        raise HTTPException(401, "Invalid or expired pairing code")
    proof = secret_hash(body.credential)
    query.update(
        {
            "_id": c["_id"],
            "$or": [{"pairing.claimed_hash": {"$exists": False}}, {"pairing.claimed_hash": proof}],
        }
    )
    if not db.radiosoft_real_integrations.find_one_and_update(
        query,
        {
            "$set": {"pairing.claimed_hash": proof, "credential_hash": proof},
            "$push": {"audit": {"action": "PAIRED", "at": now()}},
        },
    ):
        raise HTTPException(409, "Pairing already claimed")
    return binding(c)


def auth(request: Request, credentials: HTTPAuthorizationCredentials = Depends(bearer), db=Depends(get_db)):
    connector_request(request)
    c = (
        db.radiosoft_real_integrations.find_one(
            {"credential_hash": secret_hash(credentials.credentials), "enabled": True}
        )
        if credentials
        else None
    )
    if not c or c["scope"] != scope(request, db, c["_id"]):
        raise HTTPException(401, "Connector revoked or binding changed")
    return c


def source_query(c):
    return {"shop_id": c["_id"], "source_id": c["scope"]["source_id"], "generation": c["scope"]["generation"]}


def person_id(c, ref):
    return digest([*source_query(c).values(), ref])


def observation_id(c, body):
    return digest(
        [*source_query(c).values(), body.bill.key.model_dump() if body.bill else {"directory": True}]
    )


@router.post(connector_path + "/observations")
def ingest(body: RealObservation, c=Depends(auth), db=Depends(get_db)):
    s = c["scope"]
    if body.source_id != s["source_id"] or body.generation != s["generation"]:
        raise HTTPException(403, "Source/generation mismatch")
    if (body.observed_at - now()).total_seconds() > 300:
        raise HTTPException(422, "Source clock ahead")
    if body.bill and (
        body.bill.key.firm_code not in s["firm_codes"]
        or body.bill.key.invoice_type not in s["invoice_types"]
        or not s["capture_from"] <= str(body.bill.business_date) < s["capture_until"]
    ):
        raise HTTPException(403, "Outside confirmed capture scope")
    payload = body.model_dump(mode="json")
    if len(BSON.encode(payload)) > 500_000:
        raise HTTPException(413, "Observation too large; preserve queue")
    fingerprint = digest(payload)
    receipt_id = digest([c["_id"], body.source_id, body.generation, body.sequence])
    receipt = db.radiosoft_real_inbox.find_one({"_id": receipt_id})
    if receipt and receipt["digest"] != fingerprint:
        raise HTTPException(409, "Sequence already used for different bytes")
    if receipt and receipt.get("ack"):
        db.radiosoft_real_integrations.update_one(
            {"_id": c["_id"], "pending": {"sequence": body.sequence, "digest": fingerprint}},
            {"$max": {"last_sequence": body.sequence}, "$unset": {"pending": ""}},
        )
        return {**receipt["ack"], "replayed": True}
    # Durable global stream fence. A crash retains this exact pending envelope;
    # subsequent sequences cannot pass it. Materialization below is idempotent.
    pending = {"sequence": body.sequence, "digest": fingerprint}
    claimed = db.radiosoft_real_integrations.find_one_and_update(
        {
            "_id": c["_id"],
            "enabled": True,
            "credential_hash": c["credential_hash"],
            "$or": [
                {"last_sequence": body.sequence - 1, "pending": {"$exists": False}},
                {"pending": pending},
            ],
        },
        {"$set": {"pending": pending}},
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        raise HTTPException(409, "Stream continuity conflict; do not reset state")
    try:
        db.radiosoft_real_inbox.insert_one(
            {"_id": receipt_id, "digest": fingerprint, "payload": payload, "at": now()}
        )
    except DuplicateKeyError:
        pass
    key = observation_id(c, body)
    if body.bill:
        snapshot = body.bill.model_dump(mode="json")
        snapshot["lines"].sort(key=digest)  # multiset: duplicate lines survive
        bill = db.radiosoft_real_bills.find_one({"_id": key})
        if not bill or bill["sequence"] < body.sequence:
            frozen = bill["attribution"] if bill else {}
            # Freeze mapping at first bill observation; later mapping edits never
            # silently rewrite historical workers (including initially unmapped).
            if not bill:
                for line in snapshot["lines"]:
                    ref = line["salesperson_ref"]
                    if ref is not None:
                        p = db.radiosoft_real_people.find_one({"_id": person_id(c, ref)}) or {}
                        frozen[ref] = {
                            "worker_id": p.get("worker_id"),
                            "mapping_revision": p.get("revision", 0),
                        }
            version = {"sequence": body.sequence, "at": now(), "snapshot": snapshot}
            changed = not bill or bill["snapshot"] != snapshot
            patch = {
                "$set": {
                    "snapshot": snapshot,
                    "sequence": body.sequence,
                    "source_observed_at": body.observed_at,
                    "received_at": now(),
                },
                "$setOnInsert": {**source_query(c), "attribution": frozen, "events": [], "settlements": []},
            }
            projected = {
                **(bill or {}),
                **patch["$set"],
                "versions": (bill or {}).get("versions", []) + ([version] if changed else []),
            }
            if len(BSON.encode(projected)) > 8_000_000:
                raise HTTPException(409, "Source history capacity reached; preserve queue and request review")
            if changed:
                patch["$push"] = {"versions": version}
            # No replacement of events/settlements during source updates.
            try:
                db.radiosoft_real_bills.update_one(
                    {"_id": key, "sequence": {"$lt": body.sequence}}, patch, upsert=True
                )
            except DuplicateKeyError:
                pass
    else:
        for p in body.people:
            try:
                db.radiosoft_real_people.update_one(
                    {"_id": person_id(c, p.ref), "source_sequence": {"$not": {"$gte": body.sequence}}},
                    {
                        "$set": {
                            "name": p.name,
                            "last_seen": body.observed_at,
                            "source_sequence": body.sequence,
                        },
                        "$setOnInsert": {
                            **source_query(c),
                            "ref": p.ref,
                            "worker_id": None,
                            "revision": 0,
                            "audit": [],
                        },
                    },
                    upsert=True,
                )
            except DuplicateKeyError:
                pass
    ack = {"sequence": body.sequence, "bill_id": key, "accepted_at": now().isoformat(), "replayed": False}
    # Commit receipt before clearing the stream fence. Retry repairs a crash in
    # between using the same envelope; never acknowledges unmaterialized data.
    accepted = db.radiosoft_real_inbox.find_one_and_update(
        {"_id": receipt_id, "ack": {"$exists": False}},
        {"$set": {"ack": ack}},
        return_document=ReturnDocument.AFTER,
    )
    ack = (accepted or db.radiosoft_real_inbox.find_one({"_id": receipt_id}))["ack"]
    db.radiosoft_real_integrations.update_one(
        {"_id": c["_id"], "pending": pending},
        {"$set": {"last_sequence": body.sequence, "last_successful_sync": now()}, "$unset": {"pending": ""}},
    )
    return ack


@router.post(connector_path + "/health")
def health(body: RealHealth, c=Depends(auth), db=Depends(get_db)):
    db.radiosoft_real_integrations.update_one(
        {"_id": c["_id"], "credential_hash": c["credential_hash"]},
        {"$set": {"health": body.model_dump(mode="json"), "last_contact": now()}},
    )
    return {"received": True}


@router.post(shop_path + "/revoke")
def revoke(shop_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)):
    access(request, db, shop_id, identity, "owner")
    db.radiosoft_real_integrations.update_one(
        {"_id": shop_id},
        {
            "$set": {"enabled": False},
            "$unset": {"credential_hash": "", "pairing": ""},
            "$push": {"audit": {"action": "REVOKED", "at": now(), "actor_id": identity.user["_id"]}},
        },
    )
    return {"revoked": True}


@router.get(shop_path + "/availability")
def availability(shop_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)):
    _, _, c = access(request, db, shop_id, identity, "report")
    return {"enabled": bool(c and c.get("enabled"))}


@router.get(shop_path + "/status")
def status(shop_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)):
    _, s, c = access(request, db, shop_id, identity, "status")
    c = c or {}
    return {
        "connection": "DISABLED"
        if not c.get("enabled")
        else "UNPAIRED"
        if not c.get("credential_hash")
        else "CONNECTED"
        if c.get("last_contact") and (now() - c["last_contact"]).total_seconds() <= 120
        else "OFFLINE",
        "can_map": bool(c and (identity.role == "OWNER" or c.get("manager_map"))),
        "can_view": bool(c and (identity.role == "OWNER" or c.get("manager_view"))),
        "can_collect": bool(c and (identity.role == "OWNER" or c.get("manager_collect"))),
        "can_correct": bool(c and (identity.role == "OWNER" or c.get("manager_correct"))),
        "scope": s,
        "enabled": c.get("enabled", False),
        "paired": bool(c.get("credential_hash")),
        "manager_view": bool(c.get("manager_view")),
        "manager_map": bool(c.get("manager_map")),
        "manager_collect": bool(c.get("manager_collect")),
        "manager_correct": bool(c.get("manager_correct")),
        "last_contact": c.get("last_contact"),
        "last_successful_sync": c.get("last_successful_sync"),
        "health": c.get("health"),
        "accounting_available": False,
        "coverage": "Bounded polling; missing rows never imply deletion; repeated reads do not establish final save.",
    }


@router.get(shop_path + "/salespeople")
def people(shop_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)):
    _, _, c = access(request, db, shop_id, identity, "map")
    if not c:
        raise HTTPException(409, "Confirm setup first")
    rows = list(db.radiosoft_real_people.find(source_query(c)).sort("ref", 1).limit(5000))
    for row in rows:
        row["id"] = row.pop("_id")
    workers = list(
        db.memberships.find({"shop_id": shop_id, "role": "WORKER", "active": True}, {"_id": 1, "name": 1})
    )
    profiles = {
        p["membership_id"]: p.get("name", "")
        for p in db.worker_profiles.find(
            {"membership_id": {"$in": [w["_id"] for w in workers]}}, {"membership_id": 1, "name": 1}
        )
    }
    return {
        "people": rows,
        "workers": [
            {"id": w["_id"], "name": profiles.get(w["_id"]) or w.get("name") or w["_id"]} for w in workers
        ],
        "history_policy": "Mapping applies only to first observations of future bills; existing attribution stays frozen.",
    }


@router.put(shop_path + "/salespeople/{person}/mapping")
def mapping(
    shop_id: str,
    person: str,
    body: Mapping,
    request: Request,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    _, _, c = access(request, db, shop_id, identity, "map")
    if not c:
        raise HTTPException(409, "Confirm setup first")
    if body.worker_id is not None:
        worker_in_shop(db, shop_id, body.worker_id, active_only=True)
    old = db.radiosoft_real_people.find_one({"_id": person, **source_query(c)})
    if not old:
        raise HTTPException(404, "Source person not found")
    if body.not_used and body.worker_id:
        raise HTTPException(422, "A person cannot be linked and marked not used.")
    if (old.get("worker_id") or old.get("not_used")) and len(body.reason.strip()) < 2:
        raise HTTPException(422, "Give a short reason for changing an established link.")
    reason = body.reason.strip() or (
        "Owner/manager marked source person not used"
        if body.not_used
        else "Owner/manager verified first staff link"
    )
    audit = {
        "at": now(),
        "actor_id": identity.user["_id"],
        "old_worker_id": old.get("worker_id"),
        "old_not_used": old.get("not_used", False),
        "not_used": body.not_used,
        "worker_id": body.worker_id,
        "reason": reason,
        "revision": body.revision + 1,
    }
    result = db.radiosoft_real_people.update_one(
        {"_id": person, **source_query(c), "revision": body.revision},
        {
            "$set": {"worker_id": body.worker_id, "not_used": body.not_used},
            "$inc": {"revision": 1},
            "$push": {"audit": audit},
        },
    )
    if not result.modified_count:
        raise HTTPException(409, "Mapping changed; refresh")
    return {"revision": body.revision + 1, "history_policy": "FUTURE_BILLS_ONLY"}


REAL_COLLECTION_METHODS = ("CASH", "UPI", "CARD", "UNSPECIFIED")
REAL_COLLECTION_ACTIONS = {"RECEIVE", "MARK_PAID", "RECLASSIFY", "REVERSE", "NOTE"}


def effective_real_collections(ledger):
    receipts = {}
    for event in ledger.get("events", []):
        if event["action"] in {"RECEIVE", "MARK_PAID"}:
            receipts[event["id"]] = {**event, "reversed": False}
        elif event["action"] == "RECLASSIFY":
            receipts[event["collection_id"]]["allocations"] = event["allocations"]
        elif event["action"] == "REVERSE":
            receipts[event["collection_id"]]["reversed"] = True
    return list(receipts.values())


def collection_state(bill, c, ledger=None):
    snapshot = bill["snapshot"]
    net = Decimal(snapshot["net_amt"]) if snapshot["net_amt"] is not None else None
    amount = net * 100 if net is not None else None
    payable = (
        int(amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if amount is not None and 0 < amount <= 1_000_000_000_000
        else None
    )
    events = (ledger or {}).get("events", [])
    receipts = effective_real_collections(ledger or {})
    totals = {method: 0 for method in REAL_COLLECTION_METHODS}
    for receipt in receipts:
        if not receipt["reversed"]:
            for allocation in receipt["allocations"]:
                totals[allocation["method"]] += allocation["amount_paise"]
    collected = sum(totals.values())
    outstanding = payable - collected if payable is not None else None
    historical = snapshot["business_date"] < c["scope"]["tracking_from"]
    source_changed = len(bill["versions"]) > 1
    eligible = payable is not None and not historical and not source_changed
    status = (
        "SOURCE_REVIEW"
        if source_changed
        else "HISTORICAL_REVIEW"
        if historical
        else "AMOUNT_REVIEW"
        if payable is None or payable <= 0 or payable > 1_000_000_000_000
        else "OVERCOLLECTED"
        if outstanding < 0
        else "PAID"
        if outstanding == 0
        else "PARTIAL"
        if collected > 0
        else "AWAITING_COLLECTION"
    )
    state = {
        "collection_revision": (ledger or {}).get("revision", 1),
        "collection_status": status,
        "collection_payable_paise": payable,
        "collection_collected_paise": collected,
        "collection_outstanding_paise": outstanding,
        "collection_method_totals": totals,
        "collection_eligible": eligible,
        "collection_events": [
            {
                key: receipt[key]
                for key in ("id", "action", "allocations", "reversed", "at", "business_date", "actor_role")
                if key in receipt
            }
            for receipt in receipts
        ],
        "collection_notes": [
            {"id": event["id"], "text": event["note"], "at": event["at"]}
            for event in events
            if event["action"] == "NOTE"
        ],
    }
    return state


def apply_real_collection(db, bill, c, body, identity, shop):
    if body.action not in REAL_COLLECTION_ACTIONS:
        raise HTTPException(422, "This action is not available in the real DEV collection register")
    ledger_id = bill["_id"]
    ledger = db.radiosoft_real_collections.find_one({"_id": ledger_id})
    revision = ledger["revision"] if ledger else 1
    events = list((ledger or {}).get("events", []))
    fingerprint = digest(body.model_dump(mode="json"))
    for event in events:
        if event["request_id"] == body.request_id:
            if event["request_digest"] != fingerprint or event["actor_id"] != identity.user["_id"]:
                raise HTTPException(409, "Request ID already used for another action")
            return {**view(bill, c), **collection_state(bill, c, ledger)}
    if body.revision != revision:
        raise HTTPException(409, "Collection record changed. Refresh before retrying.")
    state = collection_state(bill, c, ledger)
    if body.action != "NOTE" and not state["collection_eligible"]:
        raise HTTPException(409, "This bill is historical, changed, or has an ineligible source amount")
    allocations = [allocation.model_dump() for allocation in body.allocations]
    if body.action in {"RECEIVE", "MARK_PAID"}:
        outstanding = state["collection_outstanding_paise"]
        if outstanding is None or outstanding <= 0:
            raise HTTPException(409, "This bill has no eligible outstanding balance")
        if body.action == "MARK_PAID":
            allocations = [{"method": "UNSPECIFIED", "amount_paise": outstanding}]
        amount = sum(allocation["amount_paise"] for allocation in allocations)
        if amount <= 0 or amount > outstanding:
            raise HTTPException(409, "Collection must not exceed the current outstanding amount")
    elif body.action == "RECLASSIFY":
        receipt = next(
            (r for r in effective_real_collections(ledger or {}) if r["id"] == body.collection_id), None
        )
        if not receipt or receipt["reversed"]:
            raise HTTPException(409, "Collection not found or already reversed")
        if not any(item["method"] == "UNSPECIFIED" for item in receipt["allocations"]):
            raise HTTPException(409, "Only unspecified receipts can be assigned a method")
        if sum(item["amount_paise"] for item in allocations) != sum(
            item["amount_paise"] for item in receipt["allocations"]
        ):
            raise HTTPException(409, "Reclassification must preserve the receipt amount")
    elif body.action == "REVERSE":
        receipt = next(
            (r for r in effective_real_collections(ledger or {}) if r["id"] == body.collection_id), None
        )
        if not receipt or receipt["reversed"]:
            raise HTTPException(409, "Collection not found or already reversed")
    event = {
        **body.model_dump(mode="json"),
        "id": body.request_id,
        "allocations": allocations,
        "request_digest": fingerprint,
        "actor_id": identity.user["_id"],
        "actor_role": identity.role,
        "at": now(),
        "business_date": now().astimezone(ZoneInfo(shop["timezone"])).date().isoformat(),
        "source_sequence": bill["sequence"],
        "source_snapshot_digest": digest(bill["snapshot"]),
    }
    events.append(event)
    replacement = {
        "_id": ledger_id,
        "shop_id": c["_id"],
        "source_id": c["scope"]["source_id"],
        "generation": c["scope"]["generation"],
        "business_date": event["business_date"],
        "revision": revision + 1,
        "events": events,
        "updated_at": now(),
    }
    if len(BSON.encode(replacement)) > 8_000_000:
        raise HTTPException(409, "DEV collection history capacity reached; existing history was retained")
    if ledger:
        saved = db.radiosoft_real_collections.replace_one(
            {"_id": ledger_id, "revision": revision}, replacement
        )
        if not saved.modified_count:
            raise HTTPException(409, "Collection changed concurrently. Refresh and retry.")
    else:
        try:
            db.radiosoft_real_collections.insert_one(replacement)
        except DuplicateKeyError:
            raise HTTPException(409, "Collection changed concurrently. Refresh and retry.")
    return {**view(bill, c), **collection_state(bill, c, replacement)}


def view(bill, c):
    snapshot = bill["snapshot"]
    payable = Decimal(snapshot["net_amt"]) if snapshot["net_amt"] is not None else None
    return {
        "id": bill["_id"],
        **snapshot,
        "review_required": True,
        "historical": snapshot["business_date"] < c["scope"]["tracking_from"],
        "signed_source_payable": snapshot["net_amt"],
        "owed_to_customer": format(payable.copy_abs() if payable < 0 else Decimal(0), "f")
        if payable is not None
        else None,
        "settlement_status": "UNSETTLED" if payable is not None and payable < 0 else "REVIEW_ONLY",
        "financial_actions_enabled": False,
        "source_changed": len(bill["versions"]) > 1,
        "settlement_discrepancy": bool(bill.get("settlements")) and len(bill["versions"]) > 1,
        "events": bill["events"],
        "settlements": bill.get("settlements", []),
    }


@router.get(shop_path + "/bills")
def bills(
    shop_id: str,
    request: Request,
    after: str = "",
    limit: int = Query(50, ge=1, le=100),
    business_date: Date = None,
    search: str = Query("", max_length=100),
    collection_status: str = Query("ALL", pattern="^(ALL|PENDING|PARTIAL|PAID|REVIEW)$"),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    _, _, c = access(request, db, shop_id, identity)
    if not c:
        return {"bills": [], "next_cursor": None}
    query = source_query(c)
    if business_date:
        query["snapshot.business_date"] = str(business_date)
    if search.strip():
        query["snapshot.key.invoice_no"] = {"$regex": re.escape(search.strip()), "$options": "i"}
    rows = list(db.radiosoft_real_bills.find(query).limit(2001))
    if len(rows) > 2000:
        raise HTTPException(422, "Narrow the date or bill-number search to review this DEV register")
    ledgers = {
        row["_id"]: row
        for row in db.radiosoft_real_collections.find(
            {"_id": {"$in": [bill["_id"] for bill in rows]}, **source_query(c)}
        )
    }
    views = [{**view(bill, c), **collection_state(bill, c, ledgers.get(bill["_id"]))} for bill in rows]
    views.sort(key=real_bill_order, reverse=True)
    counts = {"PENDING": 0, "PARTIAL": 0, "PAID": 0, "REVIEW": 0, "ALL": len(views)}
    for row in views:
        if row["collection_status"] in {"AWAITING_COLLECTION", "PARTIAL"}:
            counts["PENDING"] += 1
        if row["collection_status"] == "PARTIAL":
            counts["PARTIAL"] += 1
        elif row["collection_status"] == "PAID":
            counts["PAID"] += 1
        elif row["collection_status"] not in {"AWAITING_COLLECTION"}:
            counts["REVIEW"] += 1
    with localcontext() as context:
        context.prec = 100
        source_total = sum(
            (
                Decimal(row["signed_source_payable"])
                for row in views
                if row["signed_source_payable"] is not None
            ),
            Decimal(0),
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    summary = {
        "bill_count": len(views),
        "source_total": format(source_total, "f"),
        "eligible_bill_count": sum(row["collection_eligible"] for row in views),
        "payable_paise": sum(
            row["collection_payable_paise"] or 0 for row in views if row["collection_eligible"]
        ),
        "collected_paise": sum(
            row["collection_collected_paise"] for row in views if row["collection_eligible"]
        ),
        "outstanding_paise": sum(
            max(row["collection_outstanding_paise"] or 0, 0) for row in views if row["collection_eligible"]
        ),
    }
    matching = [
        row
        for row in views
        if collection_status == "ALL"
        or (collection_status == "PENDING" and row["collection_status"] in {"AWAITING_COLLECTION", "PARTIAL"})
        or row["collection_status"] == collection_status
        or (
            collection_status == "REVIEW"
            and row["collection_status"] not in {"AWAITING_COLLECTION", "PARTIAL", "PAID"}
        )
    ]
    ids = [row["id"] for row in matching]
    if after:
        if after not in ids:
            raise HTTPException(409, "Bill list changed. Return to the first page.")
        matching = matching[ids.index(after) + 1 :]
    page = matching[:limit]
    return {
        "bills": page,
        "next_cursor": page[-1]["id"] if len(matching) > limit else None,
        "counts": counts,
        "summary": summary,
    }


def real_bill_order(row):
    source_time = row.get("source_time_raw", "").strip()
    try:
        parsed = time.fromisoformat(source_time)
        time_key = (1, parsed.hour, parsed.minute, parsed.second, parsed.microsecond, "")
    except ValueError:
        time_key = (0, 0, 0, 0, 0, source_time.upper())
    invoice_no = str(row["key"]["invoice_no"])
    numeric_invoice = invoice_no.isdigit()
    return (
        row["business_date"],
        *time_key,
        int(numeric_invoice),
        int(invoice_no) if numeric_invoice else 0,
        invoice_no,
        row["key"]["fyear"],
        row["key"]["invoice_type"],
        row["key"]["firm_code"],
        row["id"],
    )


@router.get(shop_path + "/bills/{bill_id}")
def bill_detail(
    shop_id: str, bill_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)
):
    _, _, c = access(request, db, shop_id, identity)
    bill = db.radiosoft_real_bills.find_one({"_id": bill_id, **source_query(c)}) if c else None
    if not bill:
        raise HTTPException(404, "Imported bill not found")
    ledger = db.radiosoft_real_collections.find_one({"_id": bill_id, **source_query(c)})
    result = {**view(bill, c), **collection_state(bill, c, ledger)}
    result["attribution"] = bill["attribution"]
    for line in result["lines"]:
        worker = bill["attribution"].get(line["salesperson_ref"], {}).get("worker_id")
        member = (
            db.memberships.find_one({"_id": worker, "shop_id": shop_id, "role": "WORKER"}) if worker else None
        )
        if member:
            from .shops import worker_view

            line["worker_name"] = worker_view(db, member)["name"]
        else:
            line["worker_name"] = None
    return result


@router.post(shop_path + "/bills/{bill_id}/collections")
def collect_real_bill(
    shop_id: str,
    bill_id: str,
    body: CollectionAction,
    request: Request,
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    permission = (
        "correct" if body.action in {"RECLASSIFY", "REVERSE", "WAIVE", "REVERSE_WAIVER"} else "collect"
    )
    _, _, c = access(request, db, shop_id, identity, permission)
    access(request, db, shop_id, identity, "view")
    shop = db.shops.find_one({"_id": shop_id})
    bill = db.radiosoft_real_bills.find_one({"_id": bill_id, **source_query(c)}) if c else None
    if not bill:
        raise HTTPException(404, "Imported bill not found")
    return apply_real_collection(db, bill, c, body, identity, shop)


@router.get(shop_path + "/worker-sales")
def worker_sales(
    shop_id: str,
    request: Request,
    start: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    from datetime import date

    try:
        days = (date.fromisoformat(end) - date.fromisoformat(start)).days
    except ValueError:
        raise HTTPException(422, "Invalid date")
    if not 0 <= days <= 31:
        raise HTTPException(422, "Use a report window of at most 31 days")
    member, _, c = access(request, db, shop_id, identity, "report")
    if not c:
        return {"rows": []}
    worker = member["_id"] if member["role"] == "WORKER" else None
    rows, adjustments = [], []
    documents = list(
        db.radiosoft_real_bills.find(
            {**source_query(c), "snapshot.business_date": {"$gte": start, "$lt": end}}
        ).limit(2001)
    )
    if len(documents) > 2000:
        raise HTTPException(422, "Narrow the report date range")
    for b in documents:
        for i, line in enumerate(b["snapshot"]["lines"]):
            assignment = b["attribution"].get(line["salesperson_ref"], {})
            if worker and assignment.get("worker_id") != worker:
                continue
            rows.append(
                {
                    "bill_id": b["_id"],
                    "line_index": i,
                    "business_date": b["snapshot"]["business_date"],
                    "worker_id": assignment.get("worker_id"),
                    "salesperson_ref": line["salesperson_ref"],
                    "salesperson_name": line["salesperson_name"],
                    "attribution_status": line["attribution_status"],
                    "item": line["raw"].get("ItemName"),
                    "quantity": line["raw"].get("Qty"),
                    "source_item_net": line["raw"].get("NetAmt"),
                    "exact_net_sales": None,
                }
            )
        if not worker:
            adjustments.append(
                {
                    "bill_id": b["_id"],
                    "signed_source_payable": b["snapshot"]["net_amt"],
                    "unallocated": {
                        k: b["snapshot"]["raw_header"].get(k)
                        for k in ("DiscAmt", "RoundAmt", "ExchangeAmt", "AdvAmt", "CoupenDisc", "LPDiscAmt")
                    },
                    "allocation_status": "UNVALIDATED",
                }
            )
    return {
        "rows": rows,
        "bill_adjustments": adjustments,
        "exact_net_sales_available": False,
        "collections_included": False,
        "policy": "Item observations only. Discounts, rounding and exchanges remain unallocated. Exchange refunds are never charged to the replacement salesperson. Attribution frozen at first bill observation.",
    }
