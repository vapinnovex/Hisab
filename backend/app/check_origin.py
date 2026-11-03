"""Read-only deployment diagnostic: python -m app.check_origin <browser-origin>."""

import argparse

from .config import get_settings


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check exact membership in the API origin allowlist.")
    parser.add_argument("origin")
    args = parser.parse_args(argv)
    try:
        recognized = args.origin in get_settings().cors_origins
    except Exception:
        # Settings errors can include input values. Never print exceptions or settings.
        print("Settings could not be loaded; configuration values withheld.")
        return 2
    print(f"Origin recognized: {str(recognized).lower()}")
    return 0 if recognized else 1


if __name__ == "__main__":
    raise SystemExit(main())
