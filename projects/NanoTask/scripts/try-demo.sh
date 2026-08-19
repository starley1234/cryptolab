#!/usr/bin/env bash
set -euo pipefail
# NanoTask — one-click demo without browser
# Требует: запущенный gateway (npm start) на $BASE
BASE="${BASE:-http://localhost:8788}"
echo "▸ NanoTask demo → $BASE"
echo "  проверяем health..."
if ! curl -fs "$BASE/healthz" >/dev/null; then
  echo "✗ gateway не отвечает на $BASE/healthz"
  echo "  запусти в другом терминале: cd projects/NanoTask && npm start"
  exit 1
fi
echo "✓ healthz ok"
echo

# helper: json extract via python (zero deps)
jget() { python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))"; }

echo "→ создаём агентов..."
CLIENT_RESP=$(curl -fs -X POST "$BASE/api/agents" -H "Content-Type: application/json" -d '{"label":"alice-demo","balance":1200,"stake":80}')
CLIENT_KEY=$(echo "$CLIENT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['apiKey'])")
CLIENT_ADDR=$(echo "$CLIENT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['addr'])")
echo "  client alice: $CLIENT_ADDR  key ${CLIENT_KEY:0:12}..."

WORKER_RESP=$(curl -fs -X POST "$BASE/api/agents" -H "Content-Type: application/json" -d '{"label":"bob-worker","balance":800,"stake":80}')
WORKER_KEY=$(echo "$WORKER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['apiKey'])")
WORKER_ADDR=$(echo "$WORKER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['addr'])")
echo "  worker bob: $WORKER_ADDR  key ${WORKER_KEY:0:12}..."
echo

echo "→ создаём задачу (freeze 120 TASK, timeout 30s)..."
TASK_RESP=$(curl -fs -X POST "$BASE/api/tasks" -H "Authorization: Bearer $CLIENT_KEY" -H "Content-Type: application/json" -d '{"input":"parse 10k CSV → JSON, 5 bullets","reward":120,"timeout":30}')
TASK_ID=$(echo "$TASK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "  task #$TASK_ID создан, reward 120 → escrow"
echo "$TASK_RESP" | python3 -m json.tool | head -n 20
echo

echo "→ воркер сабмитит результат (EIP-712 demo sig ok)..."
# ген. 32-byte hex
RAND=$(openssl rand -hex 32 2>/dev/null || python3 -c "import os; print(os.urandom(32).hex())")
RESULT_HASH="0x$RAND"
SUBMIT_RESP=$(curl -fs -X POST "$BASE/api/tasks/$TASK_ID/submit" -H "Authorization: Bearer $WORKER_KEY" -H "Content-Type: application/json" -d "{\"resultHash\":\"$RESULT_HASH\"}")
echo "  submitted: $RESULT_HASH"
echo "$SUBMIT_RESP" | python3 -m json.tool | head -n 15
echo

echo "→ клиент approve → split 98/1/1..."
APPROVE_RESP=$(curl -fs -X POST "$BASE/api/tasks/$TASK_ID/approve" -H "Authorization: Bearer $CLIENT_KEY")
echo "$APPROVE_RESP" | python3 -m json.tool
SPLIT_WORKER=$(echo "$APPROVE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('split',{}).get('worker',''))")
SPLIT_BURN=$(echo "$APPROVE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('split',{}).get('burn',''))")
echo "  → settled: worker +$SPLIT_WORKER, burn $SPLIT_BURN, treasury $SPLIT_BURN"
echo

echo "→ stats & wall..."
curl -fs "$BASE/api/stats" | python3 -m json.tool
echo
echo "→ wall (последние сеттлы):"
curl -fs "$BASE/api/wall" | python3 -m json.tool | head -n 30
echo
echo "✓ demo done — открой $BASE в браузере, увидишь эту задачу в Доска задач / Стена сеттлов"
echo "  tip: BASE=http://localhost:8788 bash scripts/try-demo.sh  — кастомный хост"
