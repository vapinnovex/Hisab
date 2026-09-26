from datetime import datetime, timedelta, timezone

import pytest
from conftest import login

from app.routers import hishob


def settings(client, setup, mode):
    owner, shop, *_ = setup
    path = f"/api/shops/{shop}/settings"
    config = client.get(path, headers=owner).json()
    response = client.put(path, headers=owner, json={**config, "hishob_mode": mode})
    assert response.status_code == 200, response.text


def start(client, setup, mode="ENTRIES", opening="1000"):
    settings(client, setup, mode)
    base = f"/api/shops/{setup[1]}/hishob"
    response = client.post(base + "/days", headers=setup[0], json={"opening_cash": opening})
    assert response.status_code == 201, response.text
    day = response.json()
    return base, base + f"/days/{day['id']}", day


def entry(client, auth, url, day, kind, amount, payment="CASH"):
    response = client.post(
        url + "/transactions",
        headers=auth,
        json={
            "revision": day["revision"],
            "request_id": f"entry-{day['revision']:05d}",
            "type": kind,
            "amount": amount,
            "payment_method": payment,
            "description": kind,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def close(client, auth, url, day, count, **extra):
    return client.post(
        url + "/close",
        headers=auth,
        json={
            "revision": day["revision"],
            "actual_closing_cash": count,
            **extra,
        },
    )


def test_counted_estimates_separate_sales_and_keeps_next_opening(client, setup_shop, monkeypatch):
    owner = setup_shop[0]
    base, url, day = start(client, setup_shop, "COUNTED")
    day = entry(client, owner, url, day, "EXPENSE", "500")
    day = entry(client, owner, url, day, "EXPENSE", "300", "DIGITAL")
    day = entry(client, owner, url, day, "OTHER_CASH_IN", "200")
    day = entry(client, owner, url, day, "BANK_DEPOSIT", "1000")
    response = close(
        client,
        owner,
        url,
        day,
        "4700",
        digital_sales="2000",
        credit_sales="300",
        closing_bank_deposit="2000",
        closing_withdrawal="700",
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["cash_sales"] == "5000.00" and result["total_sales"] == "7300.00"
    assert result["actual_closing_cash"] == "2000.00" and result["counted_cash"] == "4700.00"
    assert result["difference"] is None and result["expected_closing_cash"] is None
    assert result["expenses_total"] == "800.00" and result["cash_expenses"] == "500.00"
    assert result["bank_deposit"] == "3000.00"
    report = client.get(base + "/monthly-summary", headers=owner, params={"month": day["date"][:7]}).json()
    assert report["recorded_sales"] == "2300.00" and report["estimated_sales"] == "5000.00"
    assert report["total_sales"] == "7300.00" and report["difference_days"] == 0
    future = datetime.fromisoformat(day["date"] + "T12:00:00+00:00") + timedelta(days=1)
    monkeypatch.setattr(hishob, "now", lambda: future)
    next_day = client.post(base + "/days", headers=owner, json={}).json()
    assert next_day["opening_cash"] == "2000.00"


def test_billing_cash_difference_and_snapshot_reclosing(client, setup_shop):
    owner = setup_shop[0]
    base, url, day = start(client, setup_shop, "BILLING")
    day = entry(client, owner, url, day, "EXPENSE", "500")
    day = entry(client, owner, url, day, "SUPPLIER_PAYMENT", "100", "DIGITAL")
    args = dict(
        cash_sales="5000",
        digital_sales="2500",
        credit_sales="300",
        closing_bank_deposit="2000",
        closing_withdrawal="400",
    )
    assert close(client, owner, url, day, "5400", **args).status_code == 422
    response = close(client, owner, url, day, "5400", difference_note="Cash shortage", **args)
    assert response.status_code == 200, response.text
    closed = response.json()
    assert closed["expected_closing_cash"] == "3100.00" and closed["actual_closing_cash"] == "3000.00"
    assert closed["difference"] == "-100.00" and closed["total_sales"] == "7800.00"
    settings(client, setup_shop, "COUNTED")
    reopened = client.post(
        url + "/reopen", headers=owner, json={"revision": closed["revision"], "reason": "Correct report"}
    ).json()
    assert reopened["mode"] == "BILLING" and reopened["total_sales"] is None
    summary = client.get(base + "/monthly-summary", headers=owner, params={"month": day["date"][:7]}).json()
    assert summary["closed_days"] == 0 and summary["total_sales"] == "0.00"
    reclosed = close(client, owner, url, reopened, "5500", **args).json()
    assert reclosed["difference"] == "0.00" and reclosed["bank_deposit"] == "2000.00"
    assert reclosed["closing_snapshots"][0] == closed["closing_snapshots"][0]
    assert len(reclosed["closing_snapshots"]) == 2
    assert (
        client.get(base + "/monthly-summary", headers=owner, params={"month": day["date"][:7]}).json()[
            "total_sales"
        ]
        == "7800.00"
    )


def test_entries_digital_and_credit_do_not_increase_galla_and_search_stays_cash_only(client, setup_shop):
    owner = setup_shop[0]
    base, url, day = start(client, setup_shop)
    for kind, amount, payment in [
        ("CASH_SALE", "1000", "CASH"),
        ("DIGITAL_SALE", "500", "CASH"),
        ("CREDIT_SALE", "200", "CASH"),
        ("EXPENSE", "100", "DIGITAL"),
        ("SUPPLIER_PAYMENT", "300", "DIGITAL"),
        ("EXPENSE", "50", "CASH"),
    ]:
        day = entry(client, owner, url, day, kind, amount, payment)
    assert day["expected_closing_cash"] == "1950.00" and day["total_sales"] == "1700.00"
    result = client.get(base + "/transactions", headers=owner).json()
    assert result["cash_in"] == "1000.00" and result["cash_out"] == "50.00"
    assert close(client, owner, url, day, "1950", cash_sales="1000").status_code == 422
    closed = close(client, owner, url, day, "1950", closing_bank_deposit="1000").json()
    assert closed["actual_closing_cash"] == "950.00" and closed["difference"] == "0.00"


@pytest.mark.parametrize("mode", ["COUNTED", "BILLING"])
def test_non_entry_modes_reject_sale_transactions_and_invalid_closings(client, setup_shop, mode):
    owner = setup_shop[0]
    _, url, day = start(client, setup_shop, mode)
    for kind in ["CASH_SALE", "DIGITAL_SALE", "CREDIT_SALE"]:
        response = client.post(
            url + "/transactions",
            headers=owner,
            json={
                "revision": 1,
                "type": kind,
                "amount": "100",
                "description": "Sale",
                "request_id": "request-1",
            },
        )
        assert response.status_code == 422
    assert close(client, owner, url, day, "1000").status_code == 422
    args = dict(digital_sales="0", credit_sales="0", **({"cash_sales": "0"} if mode == "BILLING" else {}))
    assert close(client, owner, url, day, "1000", closing_bank_deposit="1001", **args).status_code == 422
    assert close(client, owner, url, day, "1000", closing_bank_deposit="-1", **args).status_code == 422
    if mode == "COUNTED":
        assert close(client, owner, url, day, "500", **args).status_code == 422
        assert close(client, owner, url, day, "1000", cash_sales="0", **args).status_code == 422
    assert close(client, owner, url, day, "1000", **args).status_code == 200


def test_monthly_access_validation_and_legacy_defaults(client, setup_shop):
    owner, _, _, worker = setup_shop
    base, url, day = start(client, setup_shop)
    day = entry(client, owner, url, day, "CASH_SALE", "100")
    closed = close(client, owner, url, day, "1100").json()
    db = client.app.state.db
    db.hishob_days.update_one(
        {"_id": day["id"]},
        {
            "$unset": {
                key: ""
                for key in [
                    "mode",
                    "total_sales",
                    "digital_sales",
                    "credit_sales",
                    "cash_expenses",
                    "counted_cash",
                ]
            }
        },
    )
    read = client.get(url, headers=owner).json()
    assert read["mode"] == "ENTRIES" and read["total_sales"] == "100.00"
    assert read["closing_snapshots"] == closed["closing_snapshots"]
    month = day["date"][:7]
    assert client.get(base + "/monthly-summary", headers=worker, params={"month": month}).status_code == 403
    outsider = login(client, "+919876549999")
    assert client.get(base + "/monthly-summary", headers=outsider, params={"month": month}).status_code == 403
    for bad in ["2026-13", "2026-1", "0000-01", "anything"]:
        assert client.get(base + "/monthly-summary", headers=owner, params={"month": bad}).status_code == 422
    summary = client.get(base + "/monthly-summary", headers=owner, params={"month": month}).json()
    assert summary["total_sales"] == "100.00" and summary["estimated_sales"] == "0.00"


def test_month_boundary_uses_shop_date_not_utc_and_excludes_open_days(client, setup_shop, monkeypatch):
    # A March 31 UTC timestamp belongs to April in India.
    clock = datetime(2027, 3, 31, 20, tzinfo=timezone.utc)
    monkeypatch.setattr(hishob, "now", lambda: clock)
    owner = setup_shop[0]
    base, url, day = start(client, setup_shop, "BILLING")
    assert day["date"] == "2027-04-01"
    result = close(
        client, owner, url, day, "1000.01", cash_sales="0.01", digital_sales="0.02", credit_sales="0.03"
    )
    assert result.status_code == 200, result.text
    april = client.get(base + "/monthly-summary", headers=owner, params={"month": "2027-04"}).json()
    march = client.get(base + "/monthly-summary", headers=owner, params={"month": "2027-03"}).json()
    assert april["total_sales"] == "0.06" and april["closed_days"] == 1 and march["total_sales"] == "0.00"
    monkeypatch.setattr(hishob, "now", lambda: clock + timedelta(days=1))
    client.post(base + "/days", headers=owner, json={})
    report = client.get(base + "/monthly-summary", headers=owner, params={"month": "2027-04"}).json()
    assert report["open_days"] == 1 and report["total_sales"] == "0.06"


def test_mixed_month_keeps_estimates_separate_and_reopened_days_out(client, setup_shop, monkeypatch):
    owner = setup_shop[0]
    clock = datetime(2027, 4, 10, 8, tzinfo=timezone.utc)
    monkeypatch.setattr(hishob, "now", lambda: clock)
    base, url, day = start(client, setup_shop)
    day = entry(client, owner, url, day, "CASH_SALE", "100")
    assert close(client, owner, url, day, "1100").status_code == 200
    settings(client, setup_shop, "COUNTED")
    clock += timedelta(days=1)
    day = client.post(base + "/days", headers=owner, json={}).json()
    url = base + f"/days/{day['id']}"
    closed = close(client, owner, url, day, "1300", digital_sales="50", credit_sales="0").json()
    report = client.get(base + "/monthly-summary", headers=owner, params={"month": "2027-04"}).json()
    assert report["total_sales"] == "350.00"
    assert report["recorded_sales"] == "150.00" and report["estimated_sales"] == "200.00"
    assert report["closed_days"] == 2 and report["estimated_days"] == 1
    reopened = client.post(
        url + "/reopen", headers=owner, json={"revision": closed["revision"], "reason": "Check expense"}
    ).json()
    assert reopened["closing_snapshots"][0]["cash_sales"] == "200.00"
    report = client.get(base + "/monthly-summary", headers=owner, params={"month": "2027-04"}).json()
    assert (
        report["total_sales"] == "100.00" and report["open_days"] == 1 and report["estimated_sales"] == "0.00"
    )


def test_digital_expense_correction_and_deletion_recalculate_cash(client, setup_shop):
    owner = setup_shop[0]
    _, url, day = start(client, setup_shop)
    day = entry(client, owner, url, day, "EXPENSE", "250", "DIGITAL")
    assert day["expected_closing_cash"] == "1000.00"
    transaction = day["transactions"][0]
    edited = client.patch(
        url + f"/transactions/{transaction['id']}",
        headers=owner,
        json={
            "revision": day["revision"],
            "type": "EXPENSE",
            "amount": "250",
            "description": "Supplies",
            "payment_method": "CASH",
            "reason": "Actually paid cash",
        },
    ).json()
    assert edited["cash_expenses"] == "250.00" and edited["digital_expenses"] == "0.00"
    assert edited["expected_closing_cash"] == "750.00"
    removed = client.post(
        url + f"/transactions/{transaction['id']}/delete",
        headers=owner,
        json={
            "revision": edited["revision"],
            "reason": "Duplicate expense",
        },
    ).json()
    assert removed["expected_closing_cash"] == "1000.00" and removed["expenses_total"] == "0.00"


def test_monthly_report_respects_live_manager_permission(client, setup_shop):
    owner, shop, *_ = setup_shop
    base, _, day = start(client, setup_shop)
    response = client.post(
        f"/api/shops/{shop}/managers", headers=owner, json={"name": "Manager", "mobile": "+919876549888"}
    )
    assert response.status_code == 201
    manager = login(client, "+919876549888", "MANAGER")
    endpoint = base + "/monthly-summary?month=" + day["date"][:7]
    assert client.get(endpoint, headers=manager).status_code == 403
    config = client.get(f"/api/shops/{shop}/settings", headers=owner).json()
    client.put(
        f"/api/shops/{shop}/settings", headers=owner, json={**config, "manager_can_access_hishob": True}
    )
    assert client.get(endpoint, headers=manager).status_code == 200
    client.put(f"/api/shops/{shop}/settings", headers=owner, json=config)
    assert client.get(endpoint, headers=manager).status_code == 403


def test_total_only_billing_preserves_unknowns_and_can_be_refined(client, setup_shop):
    owner = setup_shop[0]
    base, url, day = start(client, setup_shop, "BILLING")
    day = entry(client, owner, url, day, "EXPENSE", "500")
    result = close(
        client,
        owner,
        url,
        day,
        "5400",
        billing_input="TOTAL",
        total_sales="7000",
        closing_bank_deposit="2000",
    )
    assert result.status_code == 200, result.text
    closed = result.json()
    assert closed["total_sales"] == closed["unallocated_sales"] == "7000.00"
    assert all(
        closed[key] is None
        for key in ["cash_sales", "digital_sales", "credit_sales", "expected_closing_cash", "difference"]
    )
    assert closed["actual_closing_cash"] == "3400.00"
    report_url = base + "/monthly-summary?month=" + day["date"][:7]
    report = client.get(report_url, headers=owner).json()
    assert report["total_sales"] == report["recorded_sales"] == report["unallocated_sales"] == "7000.00"
    assert report["unallocated_days"] == 1 and report["difference_days"] == 0
    assert report["estimated_sales"] == "0.00"
    reopened = client.post(
        url + "/reopen",
        headers=owner,
        json={"revision": closed["revision"], "reason": "Received digital totals"},
    ).json()
    assert reopened["total_sales"] is None and reopened["unallocated_sales"] == "0.00"
    assert client.get(report_url, headers=owner).json()["unallocated_days"] == 0
    args = dict(
        billing_input="TOTAL",
        total_sales="7000",
        digital_sales="2000",
        credit_sales="0",
        closing_bank_deposit="2000",
    )
    assert close(client, owner, url, reopened, "5400", **args).status_code == 422
    refined = close(client, owner, url, reopened, "5400", difference_note="Short count", **args).json()
    assert refined["cash_sales"] == "5000.00" and refined["difference"] == "-100.00"
    assert refined["unallocated_sales"] == "0.00"
    assert refined["closing_snapshots"][0] == closed["closing_snapshots"][0]
    report = client.get(report_url, headers=owner).json()
    assert report["unallocated_days"] == 0 and report["difference_days"] == 1
    assert report["total_sales"] == "7000.00" and report["cash_sales"] == "5000.00"


@pytest.mark.parametrize(
    "extra",
    [
        {},
        {"total_sales": "100", "cash_sales": "100"},
        {"total_sales": "100", "digital_sales": "0"},
        {"total_sales": "100", "credit_sales": "0"},
        {"total_sales": "100", "digital_sales": "80", "credit_sales": "21"},
        {"total_sales": "-1"},
    ],
)
def test_total_billing_rejects_ambiguous_or_invalid_values(client, setup_shop, extra):
    _, url, day = start(client, setup_shop, "BILLING")
    assert close(client, setup_shop[0], url, day, "1000", billing_input="TOTAL", **extra).status_code == 422
    assert client.get(url, headers=setup_shop[0]).json()["status"] == "OPEN"


@pytest.mark.parametrize("mode", ["ENTRIES", "COUNTED", "BILLING"])
def test_billing_total_requires_explicit_total_method(client, setup_shop, mode):
    _, url, day = start(client, setup_shop, mode)
    assert close(client, setup_shop[0], url, day, "1000", total_sales="100").status_code == 422
    if mode != "BILLING":
        assert (
            close(
                client, setup_shop[0], url, day, "1000", total_sales="100", billing_input="TOTAL"
            ).status_code
            == 422
        )


@pytest.mark.parametrize(
    "total,digital,credit,cash",
    [
        ("0.06", "0.02", "0.03", "0.01"),
        ("100", "100", "0", "0.00"),
        ("100", "0", "0", "100.00"),
    ],
)
def test_total_billing_known_payments_calculate_cash_exactly(
    client, setup_shop, total, digital, credit, cash
):
    _, url, day = start(client, setup_shop, "BILLING", opening="0")
    result = close(
        client,
        setup_shop[0],
        url,
        day,
        cash,
        billing_input="TOTAL",
        total_sales=total,
        digital_sales=digital,
        credit_sales=credit,
    )
    assert result.status_code == 200, result.text
    assert result.json()["cash_sales"] == cash and result.json()["difference"] == "0.00"


def test_zero_total_with_unknown_breakdown_does_not_claim_reconciliation(client, setup_shop):
    base, url, day = start(client, setup_shop, "BILLING")
    result = close(client, setup_shop[0], url, day, "999", billing_input="TOTAL", total_sales="0")
    assert result.status_code == 200, result.text
    assert result.json()["difference"] is None and result.json()["total_sales"] == "0.00"
    summary = client.get(base + "/monthly-summary?month=" + day["date"][:7], headers=setup_shop[0]).json()
    assert summary["unallocated_days"] == 1 and summary["unallocated_sales"] == "0.00"
