#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8788}"
HOST="${HOST:-0.0.0.0}"
export PORT HOST

# проверка Node
if ! command -v node >/dev/null 2>&1; then
  echo "✗ node не найден — поставь Node 18+ (https://nodejs.org)"
  exit 1
fi
NODE_V=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_V" -lt 18 ]; then
  echo "✗ node $(node -v) слишком старый — нужен 18+"
  exit 1
fi

echo "▸ NanoTask \$TASK — hardened escrow"
echo "  Node $(node -v)  PORT $PORT  HOST $HOST"
echo "  Zero deps — ничего ставить не надо"
echo ""
echo "  → http://${HOST}:${PORT}          (лендинг + консоль)"
echo "  → http://localhost:${PORT}/healthz  (проверка)"
echo "  → http://localhost:${PORT}/api/stats (экономика)"
echo ""
echo "  Попробовать без браузера:"
echo "    ./scripts/try-demo.sh           (создаст агентов, задачу, approve)"
echo "    BASE=http://localhost:${PORT} bash scripts/try-demo.sh"
echo ""
echo "  Остановить: Ctrl+C (graceful 5s)"
echo "────────────────────────────────────────────"
exec node backend/server.js
