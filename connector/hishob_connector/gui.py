"""Elevated, local Tk interface. No local HTTP listener, browser secrets or SQL controls."""

import json
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .contract import normalize_pairing_code
from .security import DPAPI
from .store import Store
from .synthetic import SCENARIOS


def show(directory):
    root = tk.Tk()
    root.title("Hishob Connector — Synthetic Preview")
    root.geometry("780x800")
    frame = ttk.Frame(root, padding=18)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="Synthetic preview only", font=("Segoe UI", 16, "bold")).pack(anchor="w")
    ttk.Label(
        frame,
        text="The Windows service keeps running when this window closes.\n"
        "Use a dedicated local development Hishob backend and fake shop.",
    ).pack(anchor="w", pady=8)
    api = tk.StringVar(value="http://127.0.0.1:8000")
    code = tk.StringVar()
    ttk.Label(frame, text="Local development API").pack(anchor="w")
    ttk.Entry(frame, textvariable=api).pack(fill="x", pady=4)
    ttk.Label(
        frame,
        text="Owner-issued eight-digit pairing code (hidden; expires after five minutes)",
    ).pack(anchor="w")
    ttk.Entry(frame, textvariable=code, show="•").pack(fill="x", pady=4)

    def action(fn):
        store = None
        try:
            store = Store(directory, DPAPI())
            fn(store)
        except (ValueError, RuntimeError) as exc:
            messagebox.showerror("Action unavailable", str(exc))
        except Exception:
            messagebox.showerror(
                "State unavailable",
                "Run the installed status app as administrator. "
                "Preserve state files if recovery is required.",
            )
        finally:
            if store:
                store.close()

    def pair(store):
        store.queue_pair(api.get().strip(), normalize_pairing_code(code.get()))
        code.set("")

    ttk.Button(frame, text="Pair with synthetic backend", command=lambda: action(pair)).pack(
        anchor="w", pady=4
    )
    ttk.Button(
        frame,
        text="Cancel uncertain pairing (then issue a new owner code)",
        command=lambda: action(lambda s: s.cancel_pair()),
    ).pack(anchor="w", pady=4)

    def retry(store):
        # Never change sequence, envelope or credentials. Hard failures need review.
        with store.transaction():
            if store.get("mode") == "PAIRING":
                pending = store.get("pending_pair")
                pending["retry_at"] = 0
                store.put("pending_pair", pending)
            elif store.get("mode") == "RUNNING":
                store.db.execute(
                    "UPDATE outbox SET retry_at=0 WHERE sequence=(SELECT MIN(sequence) FROM outbox)"
                )
            else:
                raise ValueError(
                    "This state needs re-pairing or recovery review; retries cannot skip a rejected bill."
                )

    ttk.Button(frame, text="Retry unchanged pending request", command=lambda: action(retry)).pack(
        anchor="w", pady=4
    )

    def export(store):
        from .diagnostics import redacted_status

        path = filedialog.asksaveasfilename(
            defaultextension=".json", initialfile="hishob-redacted-status.json"
        )
        if path:
            from pathlib import Path

            Path(path).write_text(json.dumps(redacted_status(store), indent=2), encoding="utf-8")

    ttk.Button(frame, text="Export redacted diagnostics", command=lambda: action(export)).pack(
        anchor="w", pady=4
    )
    ttk.Label(
        frame,
        text="Local source inspection: use the separate HishobLocalInspector app.\n"
        "It uses a SELECT-only Windows identity; it cannot pair, queue or upload records.",
    ).pack(anchor="w", pady=4)
    scenario = tk.StringVar(value="baseline")
    ttk.Label(frame, text="Fake bill scenario (never changes RadioSoft)").pack(anchor="w", pady=(10, 0))
    ttk.Combobox(frame, textvariable=scenario, values=SCENARIOS, state="readonly").pack(anchor="w")

    def change(store):
        with store.transaction():
            store.put("scenario", scenario.get())
            store.put("last_scan", 0)

    ttk.Button(frame, text="Apply scenario", command=lambda: action(change)).pack(anchor="w", pady=4)
    status = tk.Text(frame, height=17, wrap="word", state="disabled")
    status.pack(fill="both", expand=True, pady=10)

    def refresh():
        store = None
        try:
            store = Store(directory, DPAPI())
            data = store.status()
            text = "Worker active\n" if data["worker_alive"] else "WORKER STOPPED / NO RECENT TICK\n"
            text += "Windows service: " + data["scm_service_state"] + "\n"
            text += "STALE\n" if data["stale"] else "Recent delivery and observation\n"
            text += json.dumps(data, indent=2)
        except Exception:
            text = "State unavailable. Install/initialize first and run status as administrator."
        finally:
            if store:
                store.close()
        status.configure(state="normal")
        status.delete("1.0", "end")
        status.insert("1.0", text)
        status.configure(state="disabled")
        root.after(2000, refresh)

    refresh()
    root.mainloop()
