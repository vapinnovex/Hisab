from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from test_radiosoft_real import configure, envelope, send

from app.db import now
from app.radiosoft import secret_hash


def reissue(client, setup_shop):
    owner, shop, _, _ = setup_shop
    db = client.app.state.db
    db.radiosoft_real_integrations.update_one({"_id": shop}, {"$unset": {"pair_created_at": ""}})
    return client.post(f"/api/shops/{shop}/radiosoft-real/pairing", headers=owner)


def exchange(client, code, proof="B" * 43):
    return client.post("/api/radiosoft/real-connector/pair", json={"code": code, "credential": proof})


def test_short_codes_collision_expiry_legacy_and_reissue(client, setup_shop, monkeypatch):
    path, auth, _ = configure(client, setup_shop)
    db = client.app.state.db
    shop = setup_shop[1]
    monkeypatch.setattr("app.routers.radiosoft_real.secrets.randbelow", lambda _: 1234)
    first = reissue(client, setup_shop).json()
    assert first["code"] == "00001234"
    assert exchange(client, " 0000\t1234 \n").status_code == 200
    # Same-proof retries recover a lost server response; other claims cannot rotate it.
    assert exchange(client, first["code"]).status_code == 200
    assert exchange(client, first["code"], "C" * 43).status_code == 409
    row = db.radiosoft_real_integrations.find_one({"_id": shop})
    assert row["pairing"]["code_hash"] != first["code"]
    assert row["pairing"]["code_hash"] != secret_hash(first["code"])
    assert "code" not in row["pairing"]
    assert send(client, {"Authorization": "Bearer " + "B" * 43}, envelope()).status_code == 200
    monkeypatch.setattr("app.routers.radiosoft_real.secrets.randbelow", lambda _: 1235)
    replacement = reissue(client, setup_shop).json()["code"]
    assert exchange(client, first["code"]).status_code == 401
    # Existing paired credential and sequencing survive issuance, before new claim.
    current = db.radiosoft_real_integrations.find_one({"_id": shop})
    assert current["credential_hash"] == row["credential_hash"] and current["last_sequence"] == 1
    db.radiosoft_real_integrations.update_one(
        {"_id": shop}, {"$set": {"pairing.expires_at": now() - timedelta(seconds=1)}}
    )
    assert exchange(client, replacement).status_code == 401
    # Outstanding old-server codes remain valid during the rollout.
    db.radiosoft_real_integrations.update_one(
        {"_id": shop},
        {
            "$set": {
                "pairing": {"code_hash": secret_hash("X" * 32), "expires_at": now() + timedelta(minutes=5)}
            }
        },
    )
    assert exchange(client, "X" * 32).status_code == 200


def test_pair_guess_limits_include_malformed_requests_and_are_global(client, setup_shop):
    configure(client, setup_shop)
    db = client.app.state.db
    for _ in range(9):
        assert exchange(client, "invalid").status_code == 422
    assert exchange(client, "00000000").status_code == 429
    # Clearing only the peer counter cannot bypass the global pilot ceiling.
    db.radiosoft_pair_limits.delete_many({"_id": {"$regex": "^peer:"}})
    db.radiosoft_pair_limits.update_many({"_id": {"$regex": "^global:"}}, {"$set": {"count": 100}})
    assert exchange(client, "00000000").status_code == 429


def test_pair_concurrent_claims_and_issuance(client, setup_shop):
    configure(client, setup_shop)
    code = reissue(client, setup_shop).json()["code"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda proof: exchange(client, code, proof), ["B" * 43, "C" * 43]))
    assert sorted(r.status_code for r in replies) == [200, 409]
    proof = "B" * 43 if replies[0].status_code == 200 else "C" * 43
    assert exchange(client, code, proof).json() == next(r.json() for r in replies if r.status_code == 200)
    db = client.app.state.db
    db.radiosoft_real_integrations.update_one({"_id": setup_shop[1]}, {"$unset": {"pair_created_at": ""}})
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(
            pool.map(
                lambda _: client.post(
                    f"/api/shops/{setup_shop[1]}/radiosoft-real/pairing", headers=setup_shop[0]
                ),
                range(2),
            )
        )
    assert sorted(r.status_code for r in replies) == [200, 429]


def test_bill_filters_detail_and_not_used_preserve_history(client, setup_shop):
    base, auth, _ = configure(client, setup_shop)
    owner, shop, worker, worker_auth = setup_shop
    person_body = envelope()
    person_body.update(
        kind="DIRECTORY",
        bill=None,
        people=[{"ref": "0", "name": "Same name"}, {"ref": "1", "name": "Same name"}],
    )
    assert send(client, auth, person_body).status_code == 200
    person = client.get(base + "/salespeople", headers=owner).json()["people"][0]
    assert (
        client.put(
            base + f"/salespeople/{person['id']}/mapping",
            headers=owner,
            json={"revision": 0, "worker_id": worker, "reason": ""},
        ).status_code
        == 200
    )
    assert send(client, auth, envelope(2, "-61", "17")).status_code == 200
    assert send(client, auth, envelope(3, "0", "18")).status_code == 200
    rows = client.get(base + "/bills?business_date=2026-11-03&search=17&limit=1", headers=owner).json()
    assert len(rows["bills"]) == 1 and rows["bills"][0]["key"]["invoice_no"] == "17"
    bid = rows["bills"][0]["id"]
    detail = client.get(base + "/bills/" + bid, headers=owner).json()
    assert detail["attribution"]["0"]["worker_id"] == worker
    assert client.get(base + "/bills/" + bid, headers=worker_auth).status_code == 403
    assert client.get(base + "/bills?business_date=2026-11-04", headers=owner).json()["bills"] == []
    update = {"revision": 1, "worker_id": None, "not_used": True, "reason": "Old directory entry"}
    assert (
        client.put(base + f"/salespeople/{person['id']}/mapping", headers=owner, json=update).status_code
        == 200
    )
    assert (
        client.put(base + f"/salespeople/{person['id']}/mapping", headers=owner, json=update).status_code
        == 409
    )
    assert client.get(base + "/bills/" + bid, headers=owner).json()["attribution"] == detail["attribution"]
    assert len(client.get(base + "/bills", headers=owner).json()["bills"]) == 2
    rows = client.get(base + "/bills?limit=1", headers=owner).json()
    assert (
        client.get(base + "/bills?limit=1&after=" + rows["next_cursor"], headers=owner).json()["bills"][0][
            "id"
        ]
        != rows["bills"][0]["id"]
    )
