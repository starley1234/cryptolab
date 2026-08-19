# NanoTask — $TASK

> **The Minimalist Micropayment & Escrow Standard for Autonomous Agents.**
> *ERC-20 для агентных задач: «заморозил → сделал → подтвердил → 98% воркеру, 1% burn, 1% treasury».*

NanoTask — атомарный цикл **create → submit → approve | timeout → split**.  
Optimistic auto-timeout (воркер забирает оплату если клиент молчит), стейк воркеров с slash, EIP-712 gasless, EIP-2612 permit.

```
[AI Заказчик] ──create_task(hash, reward, timeout)──▶ [TaskEscrow] (freeze)
      │  Event TaskCreated ─────────────────────────▶ [AI Исполнитель*] *stake ≥50 TASK
      │  ◀──submit_result(resultHash, EIP712)── (off-chain sig, платит релейер)
      ▼  approve()  или  timeout → claimTimeout()
         split: 98% worker · 1% burn · 1% treasury   ·  challenge() → slash
```

* **Optimistic Settlement:** не оспорил за N сек → воркер `claimTimeout()` автоматически.
* **Staked Workers:** без 50 TASK стейка `submit` невозможен; спам → `challenge()` → половина стейка burn.
* **Gasless:** воркер подписывает `Result(taskId, resultHash)` оффчейн, релейер сабмитит.
* **Velocity Sink:** In-Flight задачи замораживают ликвидность в эскроу.

Токеномика: `R_worker = R·(1-f)`, `Burn = R·f/2`, `Treasury = R·f/2`, `f=2%` → 98/1/1. Fixed supply 1B, без минта.

---

## Быстрый старт — 10 секунд (крайне просто)

> **Ноль зависимостей.** `Node 18+` уже хватает. Docker — опционально.

```bash
cd projects/NanoTask

# Самый простой способ — один процесс, один порт
npm start
# → открой http://localhost:8788  (лендинг + консоль агента)

# Проверка что жив
curl http://localhost:8788/healthz   # {ok:true, mem:{...}}
curl http://localhost:8788/api/stats | python3 -m json.tool
```

**Без браузера (3 строки):**
```bash
./scripts/try-demo.sh
# создаст alice+ bob, задачу 120 TASK, submit, approve, покажет wall
```

**Docker — одна команда:**
```bash
docker build -t nanotask . && docker run --rm -p 8788:8788 nanotask
# → http://localhost:8788
```

<details><summary>Ещё 2 команды для проверки качества</summary>

```bash
npm test
# → 27+ кейсов: success, timeout, slash, cancel, EIP712, invariants

npm run sim
# или
python3 simulations/burn_sim.py        # дефляция 18%/год при 1M tasks/day
python3 simulations/load_test_sim.py   # 10k tasks, p95, газ
```

</details>

Порт `PORT=8788` (по умолчанию), хост `HOST=0.0.0.0`.  
`./start.sh` — one-button launcher с проверкой Node.  
`./scripts/try-demo.sh` — демо без браузера.  
`QUICKSTART.md` — шпаргалка с curl + SDK.

> **Hardened:** валидация, rate-limit `6/min` faucet, XSS-экранирование, 256KB body limit — демо не падает на презентации. См. `HARDENING_REPORT.md`.

---

## Что умеет демо-шлюз

* создать агента (адрес + стейк + демо-баланс) — ключ в `localStorage`
* кран +250 TASK, до-стейк +20
* создать задачу (freeze reward в эскроу), сабмит результата, approve / claim / challenge / cancel
* доска задач, стена сеттлов, лента событий, графики supply/burn/inFlight
* EIP-712 gasless: воркер подписывает, любой релейер сабмитит
* API: `GET /healthz`, `/api/stats`, `/api/tasks`, `/api/wall`, `/api/events`, `POST /api/agents|tasks|...`

---

## Структура проекта (Template Standard)

```
projects/nanotask/
├── README.md               # архитектура + quick start
├── project.json            # метаданные
├── package.json            # npm start/test/sim
├── start.sh
├── contracts/              # минимизм <200 строк
│   ├── NanoToken.sol       # ERC-20 $TASK + EIP-2612 permit + burn
│   ├── TaskEscrow.sol      # эскроу 98/1/1 + timeout + slash + EIP-712
│   └── interfaces/ITaskEscrow.sol
│   ├── lib/protocol.js     # JS-референс экономики (зеркало Solidity)
│   └── test/protocol.test.js
├── backend/                # gateway + UI
│   ├── server.js
│   ├── src/app.js
│   ├── src/escrow.js
│   └── public/index.html
├── sdk/                    # клиенты для агентов
│   ├── index.js            # @nanotask/sdk (JS, zero-dep)
│   ├── client.py           # Python NanoTaskClient
│   ├── wallet.py           # eth-account wrapper + EIP712
│   └── nanotask.py
├── simulations/
│   ├── burn_sim.py         # дефляция при росте агентов
│   └── load_test_sim.py    # 10k параллельных задач
└── tests/
    ├── test_escrow.py      # success/timeout/slash (python)
    └── conftest.py
```

---

## Контракты

| Файл | Назначение |
|---|---|
| `NanoToken.sol` | ERC-20 fixed 1B, no mint, burn, permit (EIP-2612) |
| `TaskEscrow.sol` | create/submit/approve/claimTimeout/challenge/cancel, split 98/1/1, stake 50, EIP-712 `Result` |
| `ITaskEscrow.sol` | интерфейс + события + ошибки |

Газ-оптимизированы, без внешних зависимостей, custom errors.

**Флоу в Solidity:**
```solidity
stake(50 ether);
id = escrow.createTask(inputHash, 100 ether, 60);
escrow.submitResult(id, resultHash); // или submitResultWithSig(id, hash, worker, v,r,s)
escrow.approve(id); // 98 → worker, 1 → burn, 1 → treasury
// или воркер: escrow.claimTimeout(id) после timeout
// или клиент: escrow.challenge(id) → slash
```

---

## SDK за 10 секунд

**JS:**
```js
import { connect } from "./sdk/index.js";
const client = await connect("http://localhost:8788", { label: "alice" });
const worker = await connect("http://localhost:8788", { label: "bob" });

const task = await client.createTask({ input: "summarize logs", reward: 100 });
await worker.submitResult(task.id, "0x" + "ab".repeat(32));
await client.approve(task.id); // settled: 98/1/1
console.log(await client.stats()); // supply, burned, inFlight
```

**Python:**
```py
from sdk.client import NanoTaskClient
from sdk.wallet import Wallet

c = NanoTaskClient("http://localhost:8788")
c.create_agent("alice")
w = NanoTaskClient("http://localhost:8788")
w.create_agent("bob")

task = c.create_task(input="parse CSV", reward=100)
# EIP-712 подпись (опционально)
wallet = Wallet.random()
sig = wallet.sign_result(task["id"], "0xdeadbeef")
w.submit_result(task["id"], "0xdeadbeef", signature=sig["signature"])
c.approve(task["id"])
print(c.stats())
```

---

## API

```
GET  /healthz
GET  /api/stats            # supply, burned, treasury, inFlight, fee
GET  /api/tasks            # все задачи
GET  /api/tasks/:id
POST /api/agents           # {label} → {apiKey, addr}
GET  /api/me               # Bearer apiKey
POST /api/faucet           # {amount}
POST /api/stake            # {amount}
POST /api/tasks            # {input, reward, timeout}
POST /api/tasks/:id/submit           # {resultHash, signature?}
POST /api/tasks/:id/submitWithSig    # {resultHash, worker, signature}
POST /api/tasks/:id/approve
POST /api/tasks/:id/claim
POST /api/tasks/:id/challenge        # {reason}
POST /api/tasks/:id/cancel
GET  /api/wall
GET  /api/events
```

---

## Симуляции

* **burn_sim.py** — как burn и velocity sink масштабируются с числом агентов. Показывает дефляцию `1M tasks/day ×50 TASK → ~18k TASK/day burn ≈ 0.66%/год`, и заморозку при `10k concurrent ×100 = 1M TASK (0.1% supply)` locked.
* **load_test_sim.py** — 10k задач: throughput, p95 latency, газ (120k/task, батчи -30%).

---

## Тесты

```bash
npm test                 # node --test: protocol + api + sdk (20+ кейсов)
python3 tests/test_escrow.py  # python: success/timeout/slash/cancel
python3 simulations/burn_sim.py
```

Покрыты: happy path, timeout claim, challenge slash, cancel refund, stake guard, EIP-712, invariants (escrow accounting).

---

## Почему NanoTask — идеальная база?

| Критерий | Что даёт |
|---|---|
| **Лаконичность** | 2 контракта <200 строк, деплой за секунды |
| **Самодостаточность** | Готовый микросервис: агенты платят за инференс/парсинг сегодня |
| **Расширяемость** | zk-пруфы → **CogniMesh**, метрики моделей → **WenAGI**, GPU-токены → **ProofGrid** |

---

## Дисклеймер

Демо-прототип. Не финансовый совет. NFA / DYOR.
