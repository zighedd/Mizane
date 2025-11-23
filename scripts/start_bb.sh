#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BACKEND="$ROOT/BB/backend"
FRONT="$ROOT/BB/frontend/harvester-ui"

cd "$BACKEND"

if [[ ! -d venv ]]; then
  python3 -m venv venv
fi

source venv/bin/activate
pip install -r ../requirements.txt

python3 api.py &
backend_pid=$!

trap 'kill "$backend_pid"' EXIT

cd "$FRONT"
npm install
npm run dev -- --host 0.0.0.0 --port 3001
