"""Production mode: shop scopes come only from the database and the operator command."""

import pytest
from test_radiosoft_real import envelope, send

from app.radiosoft_real_scope import parse_args, run


def approve(db, shop, *extra):
    args = parse_args(
        [
            "create",
            "--shop-id",
            shop,
            "--source-id",
            "pc-installation",
            "--generation",
            "db-generation",
            "--tracking-from",
            "2026-11-03",
            "--capture-from",
            "2026-01-01",
            "--capture-until",
            "2027-01-01",
            *extra,
        ]
    )
    return run(db, args, "production")


def command(db, *argv):
    return run(db, parse_args(list(argv)), "production")


@pytest.fixture
def production(client):
    settings = client.app.state.settings
    settings.app_env, settings.radiosoft_real_enabled = "production", True
    yield client.app.state.db
    settings.app_env, settings.radiosoft_real_enabled = "test", False


def connect(client, owner, shop):
    path = f"/api/shops/{shop}/radiosoft-real"
    status = client.get(path + "/status", headers=owner).json()
    assert status["available"] and status["enabled"] is False
    r = client.post(
        path + "/setup", headers=owner, json={"scope": status["scope"], "confirm_source_and_scope": True}
    )
    assert r.status_code == 200, r.text
    code = client.post(path + "/pairing", headers=owner).json()["code"]
    r = client.post("/api/radiosoft/real-connector/pair", json={"code": code, "credential": "B" * 43})
    assert r.status_code == 200, r.text
    return path, {"Authorization": "Bearer " + "B" * 43}


def test_shop_without_scope_sees_quiet_unavailable_not_error(client, setup_shop, production):
    owner, shop, _, worker = setup_shop
    path = f"/api/shops/{shop}/radiosoft-real"
    assert client.get(path + "/status", headers=owner).json() == {"available": False, "enabled": False}
    assert client.get(path + "/availability", headers=worker).json() == {"available": False, "enabled": False}
    assert client.get(path + "/bills", headers=owner).status_code == 403
    # The development allowlist is ignored in production.
    client.app.state.settings.radiosoft_real_pilots.append("ignored")
    try:
        assert client.get(path + "/status", headers=owner).json()["available"] is False
    finally:
        client.app.state.settings.radiosoft_real_pilots.clear()


def test_non_member_cannot_probe_availability(client, setup_shop, production):
    owner, shop, _, _ = setup_shop
    other = client.post("/api/shops", headers=owner, json={"name": "Other", "timezone": "Asia/Kolkata"})
    stranger_shop = other.json()["id"]
    # The worker belongs to the first shop only.
    worker = setup_shop[3]
    r = client.get(f"/api/shops/{stranger_shop}/radiosoft-real/availability", headers=worker)
    assert r.status_code in (403, 404)


def test_database_scope_pairs_and_ingests_in_production(client, setup_shop, production, capsys):
    owner, shop, _, _ = setup_shop
    db = production
    assert approve(db, shop) == 0  # preview only
    assert db.radiosoft_real_scopes.count_documents({}) == 0
    assert "Preview only" in capsys.readouterr().out
    assert approve(db, shop, "--yes") == 0
    path, auth = connect(client, owner, shop)
    assert send(client, auth, envelope()).status_code == 200
    assert client.get(path + "/bills", headers=owner).json()["bills"]
    with pytest.raises(SystemExit, match="already has a scope"):
        approve(db, shop, "--yes")


def test_revoke_and_restore_stop_and_resume_the_connector(client, setup_shop, production, capsys):
    owner, shop, _, _ = setup_shop
    db = production
    approve(db, shop, "--yes")
    path, auth = connect(client, owner, shop)
    command(db, "revoke", "--shop-id", shop)  # preview only
    assert send(client, auth, envelope()).status_code == 200
    command(db, "revoke", "--shop-id", shop, "--yes")
    assert send(client, auth, envelope(2)).status_code in (401, 403)
    assert client.get(path + "/status", headers=owner).json()["available"] is False
    command(db, "restore", "--shop-id", shop, "--yes")
    assert send(client, auth, envelope(2)).status_code == 200
    command(db, "show", "--shop-id", shop)
    shown = capsys.readouterr().out
    assert '"paired": true' in shown and "hash" not in shown


@pytest.mark.parametrize(
    "extra,message",
    [
        (["--capture-from", "2026-12-01"], "Dates must satisfy"),
        (["--firm-codes", "-1"], "Firm codes cannot be negative"),
        (["--invoice-types", "7"], "Invalid scope"),
    ],
)
def test_create_refuses_bad_scopes(client, setup_shop, production, extra, message):
    with pytest.raises(SystemExit, match=message):
        approve(production, setup_shop[1], *extra, "--yes")
    assert production.radiosoft_real_scopes.count_documents({}) == 0


def test_create_refuses_unknown_shop_or_inactive_owner(client, setup_shop, production):
    db = production
    with pytest.raises(SystemExit, match="No shop"):
        approve(db, "missing", "--yes")
    shop = setup_shop[1]
    db.memberships.update_many({"shop_id": shop, "role": "OWNER"}, {"$set": {"active": False}})
    with pytest.raises(SystemExit, match="not an active owner"):
        approve(db, shop, "--yes")


def test_capture_until_defaults_to_two_years(client, setup_shop, production):
    db = production
    run(
        db,
        parse_args(
            ["create", "--shop-id", setup_shop[1], "--source-id", "pc", "--generation", "g"]
            + ["--tracking-from", "2028-02-29", "--yes"]
        ),
        "production",
    )
    scope = db.radiosoft_real_scopes.find_one({"_id": setup_shop[1]})["scope"]
    assert (scope["capture_from"], scope["capture_until"]) == ("2028-02-29", "2030-02-28")
