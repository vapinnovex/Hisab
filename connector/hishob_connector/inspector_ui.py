"""Separate local-only app. No transport, outbox, token or synthetic-source imports."""

import json
import threading
import time
import tkinter as tk
from datetime import date, datetime, timezone
from tkinter import filedialog, ttk

from .extractor import ExtractionReview, Reader, open_local_readonly


def show():
    root = tk.Tk()
    root.title("Hishob — Local RadioSoft inspection only (no upload)")
    root.geometry("800x760")
    frame = ttk.Frame(root, padding=16)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="LOCAL REAL SOURCE — NEVER UPLOADED", font=("Segoe UI", 14, "bold")).pack(
        anchor="w"
    )
    ttk.Label(
        frame,
        text="Run as an administrator-provisioned SELECT-only Windows identity.\n"
        "The existing RadioSoft application login/password is not used.\n"
        "Connection settings apply only to this window; they never configure the synthetic service.",
    ).pack(anchor="w", pady=8)
    fields = {}
    for label, value in (
        ("Local SQL instance", r".\SQLEXPRESS"),
        ("Database", "RsDB"),
        ("ODBC driver", "SQL Server Native Client 10.0"),
        ("Approved firm", "0"),
        ("Invoice type (0/1)", "0"),
        ("Invoice number", ""),
        ("FYear (verbatim)", ""),
        ("Approved date from", "2026-11-01"),
        ("Approved date until (exclusive)", "2027-04-01"),
    ):
        row = ttk.Frame(frame)
        row.pack(fill="x", pady=2)
        ttk.Label(row, text=label, width=28).pack(side="left")
        fields[label] = tk.StringVar(value=value)
        ttk.Entry(row, textvariable=fields[label]).pack(side="left", fill="x", expand=True)
    output = tk.Text(frame, height=16, wrap="word", state="disabled")
    diagnostics = {"mode": "LOCAL_ONLY", "attempted": False, "uploaded": False}
    busy = False
    results = []

    def display(text):
        output.configure(state="normal")
        output.delete("1.0", "end")
        output.insert("1.0", text)
        output.configure(state="disabled")

    def inspect(directory=False):
        nonlocal busy
        if busy:
            return
        values = {k: v.get() for k, v in fields.items()}
        busy = True
        display("Reading locally with bounded SELECT queries…")

        def job():
            connection = None
            started = time.monotonic()
            report = {
                "mode": "LOCAL_ONLY",
                "attempted": True,
                "uploaded": False,
                "at_utc": datetime.now(timezone.utc).isoformat(),
            }
            try:
                start, end = (
                    date.fromisoformat(values["Approved date from"]),
                    date.fromisoformat(values["Approved date until (exclusive)"]),
                )
                if start >= end:
                    raise ValueError("Date bounds")
                firm = int(values["Approved firm"])
                if firm < 0:
                    raise ValueError("Firm")
                connection = open_local_readonly(
                    values["Local SQL instance"], values["Database"], values["ODBC driver"]
                )
                reader = Reader(connection, [firm], str(start), str(end))
                reader.verify_schema()
                if directory:
                    people = reader.salespeople_page(limit=100)
                    # Names/numbers visible locally only, never in exported diagnostics.
                    text = "Assigned salesperson numbers and names (first 100; local only):\n"
                    text += "\n".join(f"{row['SLNo']} — {row['SLName'] or '[blank name]'}" for row in people)
                    text += "\nMore pages may exist. No active/inactive or staff-account inference."
                    report.update(
                        result="DIRECTORY_PAGE_OBSERVED", row_count=len(people), coverage="FIRST_PAGE_ONLY"
                    )
                else:
                    snapshot = reader.inspect_bill(
                        int(values["Invoice number"]),
                        values["FYear (verbatim)"],
                        int(values["Invoice type (0/1)"]),
                        firm,
                    )
                    bill_date = datetime.fromisoformat(snapshot.header["InvoiceDate"]).date()
                    if not start <= bill_date < end:
                        raise ExtractionReview("BILL_OUTSIDE_APPROVED_DATES")
                    text = f"Local stable reread only. Save boundary and payable mapping remain UNVALIDATED.\nItem count: {len(snapshot.lines)}\n"
                    text += "Source salesperson number — name — lookup status:\n"
                    text += "\n".join(
                        sorted(
                            {
                                f"{x['salesperson_ref']} — {x['salesperson_name'] or '[unresolved]'} — {x['attribution_status']}"
                                for x in snapshot.lines
                            }
                        )
                    )
                    text += "\nNo records uploaded; billing operator remains separate."
                    report.update(
                        result="STABLE_REREAD_NOT_FINALITY",
                        line_count=len(snapshot.lines),
                        mapping="UNVALIDATED",
                    )
                report.update(query_count=reader.query_count, max_query_seconds=reader.max_query_seconds)
            except ExtractionReview as exc:
                report["result"] = str(exc)  # Application-defined codes, never SQL server error text.
                text = "Inspection stopped: " + str(exc)
            except Exception:
                report["result"] = "CONNECTION_OR_INPUT_ERROR"
                text = "Inspection unavailable. Check approved SELECT-only identity, local driver, scope and inputs. No SQL error text or records exported."
            finally:
                if connection:
                    connection.close()
            report["elapsed_seconds"] = round(time.monotonic() - started, 3)
            results.append((text, report))

        threading.Thread(target=job, daemon=True).start()

    def refresh():
        nonlocal busy, diagnostics
        if results:
            text, diagnostics = results.pop()
            display(text)
            busy = False
        root.after(200, refresh)

    def export():
        path = filedialog.asksaveasfilename(
            defaultextension=".json", initialfile="local-inspection-redacted.json"
        )
        if path:
            from pathlib import Path

            Path(path).write_text(json.dumps(diagnostics, indent=2), encoding="utf-8")

    ttk.Button(frame, text="Inspect one existing bill locally", command=inspect).pack(anchor="w", pady=5)
    ttk.Button(frame, text="Read salesperson numbers and names locally", command=lambda: inspect(True)).pack(
        anchor="w", pady=5
    )
    ttk.Button(frame, text="Export minimal redacted diagnostics", command=export).pack(anchor="w", pady=5)
    output.pack(fill="both", expand=True)
    refresh()
    root.mainloop()
