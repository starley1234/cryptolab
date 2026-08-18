#!/usr/bin/env bash
# One-button CogniMesh
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8787}"
HOST="${HOST:-0.0.0.0}"
export PORT HOST
echo "▸ CogniMesh → http://${HOST}:${PORT}"
exec node backend/server.js
