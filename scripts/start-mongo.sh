#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local/mongo
exec mongod --dbpath "$PWD/.local/mongo" --bind_ip 127.0.0.1 --port 27018
