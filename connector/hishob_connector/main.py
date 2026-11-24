import argparse
import json
import threading
from pathlib import Path

from .security import DPAPI
from .service import default_directory, dispatch, run
from .store import Store


def main():
    parser = argparse.ArgumentParser(description="Hishob synthetic connector; no real ingestion")
    parser.add_argument("command", choices=["service", "gui", "init", "run", "status"])
    parser.add_argument("--state", type=Path, default=default_directory())
    args = parser.parse_args()
    if args.command == "service":
        if args.state != default_directory():
            parser.error("Service state path is fixed by this package")
        dispatch()
    elif args.command == "gui":
        from .gui import show

        show(args.state)
    elif args.command == "init":
        Store.initialize(args.state, DPAPI()).close()
    elif args.command == "status":
        store = Store(args.state, DPAPI())
        try:
            print(json.dumps(store.status(), indent=2))
        finally:
            store.close()
    else:
        run(args.state, threading.Event())


if __name__ == "__main__":
    main()
