"""Separate real-preview executable; all secrets entered interactively, never argv."""

import argparse
import json
import threading
from pathlib import Path

from . import service
from .real import RealEngine, RealStore, https_origin, validate_binding
from .security import DPAPI, ProcessLock


def run(directory, stop):
    with ProcessLock(directory):
        store = RealStore(directory, DPAPI())
        try:
            if store.get("pilot_kind") != "REAL_DEV":
                raise ValueError("Wrong state kind")
            RealEngine(store).run(stop)
        finally:
            store.close()


def main():
    service.SERVICE_NAME = "HishobRadioSoftDev"
    service.default_directory = lambda: (
        Path(__import__("os").environ.get("PROGRAMDATA", r"C:\ProgramData")) / "HishobConnectorDev"
    )
    service.run = run
    parser = argparse.ArgumentParser(description="RadioSoft real DEV display-only pilot")
    parser.add_argument(
        "command",
        choices=["init", "configure", "pair", "cancel-pair", "run", "service", "status", "resume-health"],
    )
    parser.add_argument("--state", type=Path, default=service.default_directory())
    parser.add_argument("--binding", type=Path)
    parser.add_argument("--origin")
    args = parser.parse_args()
    if args.command == "init":
        store = RealStore.initialize(args.state, DPAPI())
        store.put("pilot_kind", "REAL_DEV")
        store.close()
    elif args.command == "service":
        if args.state != service.default_directory():
            parser.error("Service state path is fixed")
        service.dispatch()
    elif args.command == "pair":
        from .pairing_ui import show

        show(args.state)
    elif args.command == "resume-health":
        with ProcessLock(args.state):
            store = RealStore(args.state, DPAPI())
            try:
                RealEngine(store).resume_health_upgrade()
                print("Health contract accepted. State preserved; start the existing service.")
            finally:
                store.close()
    elif args.command == "run":
        run(args.state, threading.Event())
    else:
        store = RealStore(args.state, DPAPI())
        try:
            if args.command == "configure":
                b = validate_binding(json.loads(args.binding.read_text(encoding="utf-8-sig")))
                origin = https_origin(args.origin)
                with store.transaction():
                    if store.get("expected_binding") not in (None, b) or store.get("api") not in (
                        None,
                        origin,
                    ):
                        raise ValueError("Binding/origin locked; reviewed recovery required")
                    store.put("expected_binding", b)
                    store.put("api", origin)
            elif args.command == "cancel-pair":
                store.cancel_pair()
            else:
                print(json.dumps(store.status(), indent=2))
        finally:
            store.close()


if __name__ == "__main__":
    main()
