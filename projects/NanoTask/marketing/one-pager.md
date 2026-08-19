# NanoTask $TASK — One-Pager

**Slogan:** *The Minimalist Micropayment & Escrow Standard for Autonomous Agents.*

> Заморозил → Сделал → Подтвердил → **98% воркеру, 1% burn, 1% treasury.**

---

## Проблема

AI-агенты уже тратят больше газа, чем люди, но платят через карты и CEX-рейлы. Нет стандарта для микроплатежа **за факт выполнения задачи** с защитой от спама и без доверия.

- Платить за инференс/парсинг по $0.001 — дорого на L1.
- Воркер может прислать галлюцинацию и забрать деньги.
- Клиент может не заплатить после работы.

## Решение — NanoTask

Атомарный цикл `create → submit → approve | timeout → split 98/1/1` в **2 контрактах <200 строк**:

- **Optimistic timeout:** молчит N сек → воркер `claimTimeout()` сам.
- **Staked workers 50 TASK:** спам → `challenge()` → slash 25 (fully burned (no profit) клиенту).
- **Gasless EIP-712:** воркер подписывает `Result(taskId, resultHash)` оффчейн, платит релейер.
- **Velocity sink:** задачи в escrow замораживают ликвидность.

Токеномика: `1B fixed`, без минта. Каждый сеттл сжигает 1%. При `1M tasks/day ×50 TASK` → `500k burn/day → 18.25%/год`.

## Почему сейчас

- Агентные кошельки (Trust Agent Kit, EIP-8004) только стартуют — нужен settlement.
- DePIN GPU-рынки не проверяют качество вывода — NanoTask даёт оплату за результат.
- На Base газ 120k/task → 200 TPS, батчинг -30%.

## Тракшн (демо)

- Gateway zero-deps: `npm start → http://localhost:8788` 10 сек.
- 27+ тестов зелёных, симуляции 10k tasks, p95 1s.
- SDK JS + Python + MCP для Claude/Cursor, `try-demo.sh` одна команда.
- Persist `data/nanotask-state.json`, `/metrics` для Grafana.

## Архитектура

- **NanoToken** (`ERC-20 + EIP-2612 permit + burn`) — 1B → treasury.
- **TaskEscrow** (98/1/1, timeout, slash, `Result` EIP-712) — reentrancy guard, domain cache.
- **Gateway** (Node 22, zero-deps) — валидация, rate-limit 6/min faucet, 256KB limit, XSS защита.
- **SDK / MCP** — `connect(base, label)` → `createTask → submitResult → approve`.

## Go-to-Market

1. **Dev**: `npx nanotask-mcp` в Claude → агент сам платит за задачи.
2. **Community**: прогресс-бар burn + стена сеттлов (как WAGI), лидерборд воркеров.
3. **Partners**: CogniMesh (zk-пруфы), WenAGI (метрики), ProofGrid (GPU слоты).

## Метрики через 3 месяца

- 1k активных агентов, 50k задач, `burned >10k TASK`, `inFlight >500`.
- <1% slashed, p95 <2s, газ <100k с батчингом.
- 3 интеграции: Eliza, OpenAI tool, LangChain.

## Команда

CryptoLab — R&D хаб (CogniMesh флагман, WAGI burn-on-inference). NanoTask — базовый стандарт, форк CogniMesh 70/20/10 → 98/1/1 ultra-minimal.

**Next:** `Base Sepolia deploy` + `store.json prod` + `batchSettle`.

---

*Контакты: github.com/starley1234/cryptolab/projects/NanoTask · NFA/DYOR*
