"""Hard-coded fake source only. No file input, SQL access or real-to-synthetic adapter."""

from dataclasses import dataclass
from datetime import datetime, timezone

SCENARIOS = (
    "baseline",
    "increase",
    "decrease",
    "missing",
    "cancelled",
    "source_outage",
    "salesperson_change",
    "multiple_salespeople",
    "missing_salesperson",
    "duplicate_items",
    "reordered_items",
)


@dataclass(frozen=True)
class SyntheticScan:
    snapshots: tuple


def scan(identity, binding, scenario):
    if scenario not in SCENARIOS:
        raise ValueError("Unknown synthetic scenario")
    if scenario == "source_outage":
        raise OSError("Synthetic source unavailable")
    business_date = max(datetime.now(timezone.utc).date().isoformat(), binding["tracking_from"])
    # Stable generated numbers per initialized state; scope/generation still comes from pairing.
    first = 100000000 + int(identity[:12], 16) % 800000000
    rows = []
    for index, amount in enumerate(("1000.00", "750.00", "1500.00")):
        if index == 0 and scenario in {"increase", "decrease"}:
            amount = "1200.00" if scenario == "increase" else "800.00"
        state = {"missing": "MISSING_REVIEW", "cancelled": "CANCELLED"}.get(scenario, "CURRENT")
        if index:
            state = "CURRENT"
        lines = [
            {
                "description": "Synthetic item",
                "quantity": "1",
                "amount": amount,
                "salesperson_ref": "101",
                "salesperson_name": "Synthetic seller A",
            }
        ]
        if index == 0:
            if scenario == "salesperson_change":
                lines[0].update(salesperson_ref="102", salesperson_name="Synthetic seller B")
            if scenario == "missing_salesperson":
                lines[0].update(salesperson_ref="999", salesperson_name="")
            if scenario in {"multiple_salespeople", "duplicate_items", "reordered_items"}:
                lines[0]["amount"] = "500.00"
                lines.append({**lines[0], "salesperson_ref": "102", "salesperson_name": "Synthetic seller B"})
            if scenario in {"duplicate_items", "reordered_items"}:
                lines[0]["amount"] = "250.00"
                lines.append(dict(lines[0]))
            if scenario == "reordered_items":
                lines.reverse()
        rows.append(
            {
                "synthetic": True,
                "mapping_version": "synthetic-net-v1",
                "key": {
                    "invoice_no": str(first + index),
                    "fyear": "SYNTHETIC-2026-27",
                    "invoice_type": 0,
                    "firm_code": binding["firm_codes"][0],
                },
                "business_date": business_date,
                "source_time_raw": "",
                "amounts": {"net_amt": amount},
                "lines": lines,
                "source_status": state,
                "lifecycle_evidence": ""
                if state == "CURRENT"
                else "Synthetic simulator action; no real lifecycle claim",
            }
        )
    return SyntheticScan(tuple(rows))
