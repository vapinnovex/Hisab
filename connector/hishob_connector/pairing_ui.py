"""Real DEV pairing only: no scanning, secrets in argv, or success on queue acceptance."""

import threading
import time

from .contract import normalize_pairing_code
from .real import RealEngine, RealStore
from .security import DPAPI, ProcessLock


def normalize_code(value):
    return normalize_pairing_code(value)


def pairing_state(store):
    mode, error = store.get("mode"), store.get("error", "") or ""
    if store.get("pending_pair"):
        if error == "PAIRING_HTTP_401":
            return "Expired code", "The code is invalid or expired. Create a replacement in Hishob."
        if mode != "PAIRING" or error:
            return "Connection failed", "Retry the same request. If the code expired, replace it in Hishob."
        return "Pairing", "Waiting for the server to confirm this PC and shop."
    if (
        mode == "RUNNING"
        and store.get("credential")
        and store.get("binding") == store.get("expected_binding")
    ):
        return "Connected", "Pairing confirmed by the server. Source sync runs in the Windows service."
    return "Not paired", "Enter the code shown in Hishob on your phone."


def exchange_pending(directory, vault):
    # The service owns this lock while running. If stopped, exchange only; never read SQL.
    try:
        with ProcessLock(directory):
            store = RealStore(directory, vault)
            try:
                pending = store.get("pending_pair")
                if pending and store.get("mode") == "PAIRING":
                    RealEngine(store).pair(pending, time.time())
            finally:
                store.close()
    except OSError:
        pass  # service performs the exchange; the dialog observes committed state


def show(directory):
    import tkinter as tk
    from tkinter import messagebox, ttk

    root = tk.Tk()
    root.title("Hishob — Connect shop PC")
    root.geometry("540x380")
    frame = ttk.Frame(root, padding=24)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="Connect your shop PC", font=("Segoe UI", 20, "bold")).pack(anchor="w")
    ttk.Label(frame, text="Enter the eight-digit code shown in Hishob.\nCodes last five minutes.").pack(
        anchor="w", pady=12
    )
    code = tk.StringVar()
    entry = ttk.Entry(frame, textvariable=code, font=("Consolas", 26), width=14)
    entry.pack(anchor="w")
    title, detail = tk.StringVar(), tk.StringVar()
    ttk.Label(frame, textvariable=title, font=("Segoe UI", 16, "bold")).pack(anchor="w", pady=(16, 4))
    ttk.Label(frame, textvariable=detail, wraplength=480).pack(anchor="w")
    working = False

    def action(replace=False):
        store = None
        try:
            store = RealStore(directory, DPAPI())
            if not store.get("expected_binding"):
                raise ValueError("Configure the owner-confirmed binding first.")
            pending = store.get("pending_pair")
            if replace:
                value = normalize_code(code.get())  # validate before cancelling anything
                if not messagebox.askyesno(
                    "Replace pairing attempt?",
                    "Use the newly issued code? The old pending attempt will be cancelled. Queued bills are preserved.",
                ):
                    return
                store.cancel_pair()
                store.queue_pair(store.get("api"), value)
            elif not pending:
                if store.get("mode") == "RUNNING":
                    return  # already paired; never rotate automatically
                store.queue_pair(store.get("api"), normalize_code(code.get()))
            else:
                with store.transaction():
                    # Retry retains exactly the existing proof and honours backoff.
                    store.put("mode", "PAIRING")
            code.set("")
        except ValueError as exc:
            messagebox.showerror("Pairing", str(exc))
        except Exception:
            messagebox.showerror(
                "Connection failed",
                "Cannot open protected connector state. Run as administrator; preserve the state directory.",
            )
        finally:
            if store:
                store.close()

    ttk.Button(frame, text="Pair / Retry", command=action).pack(anchor="w", pady=8)
    ttk.Button(frame, text="Use replacement code", command=lambda: action(True)).pack(anchor="w")

    def exchange():
        nonlocal working
        try:
            exchange_pending(directory, DPAPI())
        except Exception:
            pass  # UI reports durable state; never log raw exceptions or request secrets
        finally:
            working = False

    def poll():
        nonlocal working
        store = None
        try:
            store = RealStore(directory, DPAPI())
            state, hint = pairing_state(store)
            title.set(state)
            detail.set(hint)
            if store.get("mode") == "PAIRING" and not working:
                working = True
                threading.Thread(target=exchange, daemon=True).start()
        except Exception:
            title.set("Connection failed")
            detail.set("Protected state unavailable. Run this dialog as administrator.")
        finally:
            if store:
                store.close()
        root.after(1000, poll)

    poll()
    root.mainloop()
