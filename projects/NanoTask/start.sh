#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8788}"
HOST="${HOST:-0.0.0.0}"
export PORT HOST
echo "▸ NanoTask → http://${HOST}:${PORT}"
echo "  API: /healthz /api/stats /api/tasks"
exec node backend/server.js
