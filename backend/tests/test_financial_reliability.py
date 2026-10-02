from datetime import datetime, timezone

import pytest
from test_cashbook_modes import close, entry, start

from app.routers import hishob


@pytest.mark.parametrize("mode", ["ENTRIES", "COUNTED", "BILLING", "BILLING_UNKNOWN"])
def test_september_day_closed_in_october_preserves_totals_and_rejects_stale_writes(
    client, setup_shop, monkeypatch, mode
):
    owner, shop, *_ = setup_shop
    client.app.state.db.shops.update_one(
        {"_id": shop}, {"$set": {"created_at": datetime(2026, 9, 1, tzinfo=timezone.utc)}}
    )
    monkeypatch.setattr(hishob, "now", lambda: datetime(2026, 9, 30, 12, tzinfo=timezone.utc))
    base, url, day = start(client, setup_shop, "BILLING" if mode == "BILLING_UNKNOWN" else mode)
    assert day["date"] == "2026-09-30"
    if mode == "ENTRIES":
        day = entry(client, owner, url, day, "CASH_SALE", "500")
        day = entry(client, owner, url, day, "DIGITAL_SALE", "200")
    stale = day.copy()
    day = entry(client, owner, url, day, "EXPENSE", "100")
    monkeypatch.setattr(hishob, "now", lambda: datetime(2026, 10, 2, 12, tzinfo=timezone.utc))
    extra = {"closing_bank_deposit": "200", "closing_withdrawal": "100"}
    if mode == "COUNTED":
        extra.update(digital_sales="200", credit_sales="0")
    elif mode.startswith("BILLING"):
        extra.update(billing_input="TOTAL", total_sales="700")
        if mode == "BILLING":
            extra.update(digital_sales="200", credit_sales="0")
    assert close(client, owner, url, stale, "1390", **extra).status_code == 409
    if mode in {"ENTRIES", "BILLING"}:
        assert close(client, owner, url, day, "1390", **extra).status_code == 422
    assert (
        close(client, owner, url, day, "1390", **{**extra, "closing_bank_deposit": "1500"}).status_code == 422
    )
    unchanged = client.get(url, headers=owner).json()
    assert unchanged["revision"] == day["revision"]
    assert unchanged["closing_snapshots"] == []
    extra["difference_note"] = "Counted shortage"
    response = close(client, owner, url, day, "1390", **extra)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["date"] == "2026-09-30"
    assert saved["closed_at"].startswith("2026-10-02")
    assert saved["actual_closing_cash"] == "1090.00"
    assert saved["total_sales"] == ("690.00" if mode == "COUNTED" else "700.00")
    assert saved["difference"] == ("-10.00" if mode in {"ENTRIES", "BILLING"} else None)
    assert len(saved["closing_snapshots"]) == 1
    assert close(client, owner, url, day, "1390", **extra).status_code == 409
    assert client.get(url, headers=owner).json() == saved
    report = client.get(base + "/monthly-summary?month=2026-09", headers=owner).json()
    assert report["closed_days"] == 1
    assert report["total_sales"] == saved["total_sales"]
    assert client.get(base + "/monthly-summary?month=2026-10", headers=owner).json()["closed_days"] == 0
    assert client.get(base + "/today", headers=owner).json()["suggested_opening_cash"] == "1090.00"
