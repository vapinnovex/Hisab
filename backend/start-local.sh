#!/bin/sh
# macOS local development: keep Python dependencies outside cloud-synced Documents.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
HISHOB_RUNTIME_PYTHON="${HISHOB_BACKEND_PYTHON:-$HOME/.local/share/hishob/backend-venv/bin/python}"
if [ ! -x "$HISHOB_RUNTIME_PYTHON" ]; then
  echo 'The local backend environment is missing. Create it with:' >&2
  echo 'python3 -m venv "$HOME/.local/share/hishob/backend-venv"' >&2
  echo '"$HOME/.local/share/hishob/backend-venv/bin/python" -m pip install -r requirements.lock.txt' >&2
  exit 1
fi
# No watcher by default: cloud hydration can otherwise trigger reloads during startup.
exec "$HISHOB_RUNTIME_PYTHON" -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 "$@"
