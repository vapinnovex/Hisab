"""Isolated preview ledger. No writes or reads contributing to galla or customer dues."""

import hashlib
import json
from decimal import ROUND_HALF_UP, Decimal

from bson import BSON
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from .db import now, public

METHODS = ("CASH", "UPI", "CARD", "UNSPECIFIED")


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def secret_hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


def to_paise(value):
    return int((Decimal(value) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def canonical(body):
    snapshot = body.model_dump(mode="json", exclude={"sequence", "observed_at"})
    # Multiset, not set: duplicates matter; line order has no verified source meaning.
    snapshot["lines"] = sorted(snapshot["lines"], key=lambda line: json.dumps(line, sort_keys=True))
    return snapshot


def bill_id(config, key):
    return digest([config["_id"], config["source_id"], config["generation"], key])


def effective_collections(bill):
    receipts = {}
    for event in bill["events"]:
        if event["action"] in {"RECEIVE", "MARK_PAID"}:
            receipts[event["id"]] = {**event, "reversed": False}
        elif event["action"] == "RECLASSIFY":
            receipts[event["collection_id"]]["allocations"] = event["allocations"]
        elif event["action"] == "REVERSE":
            receipts[event["collection_id"]]["reversed"] = True
    return list(receipts.values())


def bill_view(bill, config, detail=False):
    receipts = effective_collections(bill)
    totals = {method: 0 for method in METHODS}
    for receipt in receipts:
        if not receipt["reversed"]:
            for allocation in receipt["allocations"]:
                totals[allocation["method"]] += allocation["amount_paise"]
    snapshot = bill["snapshot"]
    amounts = snapshot["amounts"]
    unresolved = any(
        Decimal(amounts[key]) != 0
        for key in ("card_pay_charges", "round_amt", "advance_amt", "coupon_discount", "loyalty_discount")
    )
    payable = None if unresolved else to_paise(amounts["net_amt"])
    collected = sum(totals.values())
    outstanding = None if payable is None else payable - collected
    historical = snapshot["business_date"] < config["tracking_from"]
    status = (
        "HISTORICAL_REVIEW"
        if historical
        else "MAPPING_REVIEW"
        if unresolved
        else "OVERCOLLECTED"
        if outstanding < 0
        else "PAID"
        if outstanding == 0
        else "PARTIAL"
        if collected
        else "AWAITING_COLLECTION"
    )
    view = {
        "id": bill["_id"],
        "revision": bill["revision"],
        "key": snapshot["key"],
        "business_date": snapshot["business_date"],
        "source_status": snapshot["source_status"],
        "source_changed": len(bill["versions"]) > 1,
        "collection_status": status,
        "payable_paise": payable,
        "collected_paise": collected,
        "outstanding_paise": outstanding,
        "method_totals": totals,
        "last_observed_at": bill["observed_at"],
        "source_observed_at": bill["source_observed_at"],
        "review_required": historical
        or unresolved
        or (outstanding is not None and outstanding < 0)
        or snapshot["source_status"] != "CURRENT",
        "salespeople": sorted(
            {line["salesperson_name"] or line["salesperson_ref"] for line in snapshot["lines"]} - {""}
        ),
        "bank_verified": False,
    }
    if detail:
        view.update(snapshot=snapshot, versions=bill["versions"], events=bill["events"], collections=receipts)
    return view


def save_bill(db, bill, previous_revision):
    if len(BSON.encode(bill)) > 8_000_000:
        raise HTTPException(
            409, "Pilot bill history limit reached. Stop and contact support; history was retained."
        )
    if previous_revision == 0:
        try:
            db.radiosoft_bills.insert_one(bill)
            return
        except DuplicateKeyError:
            pass
    elif db.radiosoft_bills.replace_one(
        {"_id": bill["_id"], "revision": previous_revision}, bill
    ).modified_count:
        return
    raise HTTPException(409, "Bill changed concurrently. Refresh before retrying.")


def ingest(db, config, body):
    if (body.observed_at - now()).total_seconds() > 300:
        raise HTTPException(422, "Observation clock is more than five minutes ahead")
    if body.source_id != config["source_id"] or body.generation != config["generation"]:
        raise HTTPException(403, "Credential source/generation mismatch")
    if body.key.firm_code not in config["firm_codes"]:
        raise HTTPException(403, "Firm outside approved source scope")
    snapshot = canonical(body)
    fingerprint = digest(snapshot)
    envelope_digest = digest(body.model_dump(mode="json"))
    key = bill_id(config, snapshot["key"])
    bill = db.radiosoft_bills.find_one({"_id": key})
    previous_revision = bill["revision"] if bill else 0
    if bill and body.sequence <= bill["sequence"]:
        if body.sequence == bill["sequence"] and envelope_digest == bill["envelope_digest"]:
            return {
                "bill_id": key,
                "sequence": body.sequence,
                "replayed": True,
                "accepted_at": bill["observed_at"],
            }
        raise HTTPException(409, "Stale or conflicting observation. Do not reset the durable sequence.")
    timestamp = now()
    if not bill:
        bill = {
            "_id": key,
            "shop_id": config["_id"],
            "source_id": config["source_id"],
            "generation": config["generation"],
            "versions": [],
            "events": [],
        }
    if bill.get("digest") != fingerprint:
        bill["versions"].append(
            {"sequence": body.sequence, "digest": fingerprint, "snapshot": snapshot, "received_at": timestamp}
        )
    bill.update(
        snapshot=snapshot,
        digest=fingerprint,
        sequence=body.sequence,
        observed_at=timestamp,
        source_observed_at=body.observed_at,
        envelope_digest=envelope_digest,
        revision=previous_revision + 1,
    )
    save_bill(db, bill, previous_revision)
    # Freshness derives directly from this committed bill; there is no separate
    # sync-timestamp write to lose after the receipt commits.
    return {"bill_id": key, "sequence": body.sequence, "replayed": False, "accepted_at": timestamp}


def apply_collection(db, bill, config, body, identity, business_date):
    fingerprint = digest(body.model_dump(mode="json"))
    for event in bill["events"]:
        if event["request_id"] == body.request_id:
            if event["request_digest"] != fingerprint or event["actor_id"] != identity.user["_id"]:
                raise HTTPException(409, "Request ID already used for another action")
            return bill_view(bill, config, True)
    if bill["revision"] != body.revision:
        raise HTTPException(409, "Bill changed. Refresh and review the outstanding amount.")
    view = bill_view(bill, config)
    allocations = [a.model_dump() for a in body.allocations]
    if body.action in {"RECEIVE", "MARK_PAID"}:
        if view["review_required"]:
            raise HTTPException(409, "This bill needs source/history review before collection")
        outstanding = view["outstanding_paise"]
        if body.action == "MARK_PAID":
            allocations = [{"method": "UNSPECIFIED", "amount_paise": outstanding}]
        amount = sum(a["amount_paise"] for a in allocations)
        if amount <= 0 or amount > outstanding:
            raise HTTPException(409, "Collection must not exceed the current outstanding amount")
    else:
        receipt = next((r for r in effective_collections(bill) if r["id"] == body.collection_id), None)
        if not receipt or receipt["reversed"]:
            raise HTTPException(409, "Collection not found or already reversed")
        if body.action == "RECLASSIFY":
            if not any(a["method"] == "UNSPECIFIED" for a in receipt["allocations"]):
                raise HTTPException(409, "Only unspecified receipts can be assigned a method")
            if sum(a["amount_paise"] for a in allocations) != sum(
                a["amount_paise"] for a in receipt["allocations"]
            ):
                raise HTTPException(409, "Reclassification must preserve the receipt amount")
    event = {
        **body.model_dump(mode="json"),
        "id": body.request_id,
        "allocations": allocations,
        "request_digest": fingerprint,
        "actor_id": identity.user["_id"],
        "actor_role": identity.role,
        "at": now(),
        "business_date": business_date,
        "source_sequence": bill["sequence"],
    }
    bill["events"].append(event)
    bill["revision"] += 1
    save_bill(db, bill, body.revision)
    return bill_view(bill, config, True)


def evidence_view(document):
    return public({key: value for key, value in document.items() if key != "request_digest"})
