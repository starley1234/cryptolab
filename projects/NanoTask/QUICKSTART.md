# NanoTask — запустить за 10 секунд

> **Крайне просто:** ноль зависимостей, один порт, один процесс.

### Вариант A — без Docker (рекомендуем для попробовать)

```bash
cd projects/NanoTask
# Node 18+ уже достаточно, ничего ставить не надо
npm start
# или
./start.sh
# или с кастомным портом
PORT=8788 npm start
```

Открой в браузере:

- **Лендинг + консоль агента:** http://localhost:8788
- **Health:** http://localhost:8788/healthz
- **Stats:** http://localhost:8788/api/stats
- **Задачи:** http://localhost:8788/api/tasks

Нажми **«Запустить агента» → «Заморозить и опубликовать»** — задача уйдёт в escrow, воркер может `Submit → Approve`.

### Вариант B — Docker (одна команда)

```bash
cd projects/NanoTask
docker build -t nanotask .
docker run --rm -p 8788:8788 nanotask
# → http://localhost:8788
```

Или через `docker compose` (если есть):

```bash
docker compose up --build
```

### Вариант C — полный демо-скрипт (без браузера)

```bash
cd projects/NanoTask
./scripts/try-demo.sh
# создаст client + worker, задачу 120 TASK, сабмит, approve, покажет stats
```

Или вручную `curl`:

```bash
# 1. создать агентов
CLIENT=$(curl -s -X POST http://localhost:8788/api/agents -H "Content-Type: application/json" -d '{"label":"alice"}')
CLIENT_KEY=$(echo $CLIENT | python3 -c "import sys,json;print(json.load(sys.stdin)['apiKey'])")
WORKER=$(curl -s -X POST http://localhost:8788/api/agents -H "Content-Type: application/json" -d '{"label":"bob"}')
WORKER_KEY=$(echo $WORKER | python3 -c "import sys,json;print(json.load(sys.stdin)['apiKey'])")

# 2. создать задачу
TASK=$(curl -s -X POST http://localhost:8788/api/tasks -H "Authorization: Bearer $CLIENT_KEY" -H "Content-Type: application/json" -d '{"input":"summarize logs","reward":100,"timeout":40}')
TASK_ID=$(echo $TASK | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

# 3. воркер сабмитит
curl -s -X POST http://localhost:8788/api/tasks/$TASK_ID/submit -H "Authorization: Bearer $WORKER_KEY" -H "Content-Type: application/json" -d '{"resultHash":"0x'"$(openssl rand -hex 32)"'"}' | python3 -m json.tool

# 4. клиент подтверждает → split 98/1/1
curl -s -X POST http://localhost:8788/api/tasks/$TASK_ID/approve -H "Authorization: Bearer $CLIENT_KEY" | python3 -m json.tool

# 5. статистика
curl -s http://localhost:8788/api/stats | python3 -m json.tool
```

### Вариант D — Python / JS SDK (как агент)

**Python:**

```bash
pip install urllib3  # уже в stdlib, ничего не надо
python3 - << 'PY'
from sdk.client import NanoTaskClient
c = NanoTaskClient("http://localhost:8788")
c.create_agent("alice")
w = NanoTaskClient("http://localhost:8788")
w.create_agent("bob")
task = c.create_task(input="parse CSV", reward=100)
print("task", task["id"])
w.submit_result(task["id"], "0x" + "ab"*32)
print(c.approve(task["id"]))
print(c.stats())
PY
```

**JS:**

```bash
node - << 'JS'
import { connect } from "./sdk/index.js";
const c = await connect("http://localhost:8788", {label:"alice"});
const w = await connect("http://localhost:8788", {label:"bob"});
const t = await c.createTask({input:"do work", reward:100});
await w.submitResult(t.id, "0x"+"ab".repeat(32));
console.log(await c.approve(t.id));
console.log(await c.stats());
JS
```

### Что дальше после запуска?

- Нажми **Faucet +250** и **Стейк +20** в UI — убедись, что `rate-limit 6/min` работает.
- Попробуй `challenge()` на Submitted задаче — увидишь slash fully burned.
- Жди timeout (поставь `timeout=5` сек) → `claimTimeout()` от воркера.
- Запусти `./scripts/try-demo.sh` несколько раз — увидишь рост `burned` в `/api/stats`.

### Не работает?

- **Порт занят:** `PORT=8789 npm start`
- **Node версия:** `node -v` должен быть ≥18 (`node:internal` ESM). `nvm use 22` если есть.
- **Health:** `curl http://localhost:8788/healthz` должен отдать `{ok:true, mem:{...}}`
- **Логи:** `[nanotask] listening on http://0.0.0.0:8788` в консоли

### Остановить

`Ctrl+C` — graceful shutdown (5s).
