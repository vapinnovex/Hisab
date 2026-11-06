"""DEV-only real preview. Separate collections, credentials and routes from v1."""

import re
import secrets
from datetime import date as Date
from datetime import timedelta
from decimal import Decimal

from bson import BSON
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from pymongo.write_concern import WriteConcern

from ..db import get_db as application_db
from ..db import now
from ..radiosoft import digest, secret_hash
from ..radiosoft_real_schemas import Mapping, RealHealth, RealObservation, RealPairRequest, Setup
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
            permission in {"view", "map"}
            and member["role"] in {"MANAGER", "ADMIN"}
            and config
            and config.get("manager_" + permission)
        )
        or (permission == "report" and member["role"] == "WORKER")
    )
    if permission == "status" and member["role"] in {"MANAGER", "ADMIN"}:
        allowed = bool(config and (config.get("manager_view") or config.get("manager_map")))
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
    audit = {"action": "SETUP_CONFIRMED", "actor_id": identity.user["_id"], "at": now(), "scope": s}
    if old:
        db.radiosoft_real_integrations.update_one(
            {"_id": shop_id},
            {
                "$set": {"enabled": True, "manager_view": body.manager_view, "manager_map": body.manager_map},
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
        "scope": s,
        "enabled": c.get("enabled", False),
        "paired": bool(c.get("credential_hash")),
        "manager_view": bool(c.get("manager_view")),
        "manager_map": bool(c.get("manager_map")),
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
    identity=Depends(current_identity),
    db=Depends(get_db),
):
    _, _, c = access(request, db, shop_id, identity)
    if not c:
        return {"bills": [], "next_cursor": None}
    query = {**source_query(c), "_id": {"$gt": after}}
    if business_date:
        query["snapshot.business_date"] = str(business_date)
    if search.strip():
        query["snapshot.key.invoice_no"] = {"$regex": re.escape(search.strip()), "$options": "i"}
    rows = list(db.radiosoft_real_bills.find(query).sort("_id", 1).limit(limit + 1))
    return {
        "bills": [view(b, c) for b in rows[:limit]],
        "next_cursor": rows[limit - 1]["_id"] if len(rows) > limit else None,
    }


@router.get(shop_path + "/bills/{bill_id}")
def bill_detail(
    shop_id: str, bill_id: str, request: Request, identity=Depends(current_identity), db=Depends(get_db)
):
    _, _, c = access(request, db, shop_id, identity)
    bill = db.radiosoft_real_bills.find_one({"_id": bill_id, **source_query(c)}) if c else None
    if not bill:
        raise HTTPException(404, "Imported bill not found")
    result = view(bill, c)
    result["attribution"] = bill["attribution"]
    for line in result["lines"]:
        worker = bill["attribution"].get(line["salesperson_ref"], {}).get("worker_id")
        member = db.memberships.find_one({"_id": worker, "shop_id": shop_id, "role": "WORKER"}) if worker else None
        if member:
            from .shops import worker_view

            line["worker_name"] = worker_view(db, member)["name"]
        else:
            line["worker_name"] = None
    return result


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
