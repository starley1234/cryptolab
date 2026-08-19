# NanoTask — аудит качества и план доведения до идеала

> Дата: 2026-08-18 · Ветка `arena/01a0173e-cryptolab` · Статус до правок: `prototype`

Цель: сделать NanoTask **launch-ready** — чтобы демо не падало, экономика не рассинхронивалась, контракты не имели дыр, SDK не зависал.

---

## 1. Резюме (TL;DR)

Проект уже силен: 2 контракта <200 строк, gateway zero-deps, понятный флоу `create → submit → approve | timeout → split 98/1/1`, 30+ тестов зеленые. Главные риски — не баги-шоустопперы, а **расхождение референса и Solidity**, отсутствие валидации/лимитов в gateway, хрупкий фронтенд и SDK без таймаутов.

После правок из этого плана проект проходит критерий **«идеально»**: детерминированная экономика, защита от спама/слипа, воспроизводимость тестов, ноль падений gateway при плохом вводе, фронт не ломается при потерянном ключе.

---

## 2. Что уже идеально

- **Лаконичность**: 2 контракта, no deps, custom errors, gas 120k/task.
- **Покрытие happy-path**: success / timeout / slash / cancel / EIP-712 — всё тестируется JS + Python.
- **Zero-deps gateway**: `node backend/server.js` без `npm i`.
- **Ясная токеномика**: 98/1/1, графики burn/inFlight в UI, симуляции с проекцией 18% burn/год при 1M tasks/day.

---

## 3. Найденные проблемы по приоритетам

### P0 — критично для стабильности

| # | Зона | Проблема | Риск |
|---|------|----------|------|
| 1 | `protocol.js` vs `TaskEscrow.sol` | Математика slash расходится: Solidity `sl = min(stake, 25)` (половина minStake) сжигает `sl/2` и отправляет `sl/2` клиенту; JS `sl = 37.5` (плавающее) и `mintTo(client)` вместо `transfer`. При нагрузке 5% bad_rate burned в симуляции занижен/завышен на ~30%. | Инвариант `supply + burned = const` ломается при сравнении цепей, симуляция врёт. |
| 2 | `protocol.js` `verifyResultSig` | Принимает любую строку `length>=10` как валидную подпись. Gasless `submitWithSig` можно заспамить без приватника. | Ложное ощущение EIP-712. |
| 3 | `protocol.js` `hash` | JS `sha256` vs Solidity `keccak256` — дайджесты никогда не совпадут, `ecrecover` в Solidity всегда фейлится если подключить реальный кошелек. | Невозможен переход на реальную сеть. |
| 4 | `backend/src/app.js` | `readBody` без лимита размера + `JSON.parse` без try в ряде роутов → OOM/краш при `Content-Length: 10MB`. | DoS демо. |
| 5 | `backend/src/escrow.js` | `createAgent`/`createTask` не валидируют `reward`, `timeout`, `label`. `reward=NaN`, `reward=1e12`, `label=<img onerror>` проходят, `label` рендерится в UI через `innerHTML` без экранирования → XSS. | Падение баланса в `NaN`, XSS в публичной демке. |
| 6 | `backend/src/app.js` | Нет rate-limit для `/api/faucet` и `/api/agents`. Один скрипт может накрутить `agents=10k`, память gateway утекет. | Память, `inFlight` взлетит. |
| 7 | `backend/src/app.js` | `file.startsWith(publicDir)` — классическая path traversal защита, но `normalize(join(publicDir, path))` для `/..%2f` может обойти на Windows. Отсутствуют security headers. | Низкий, но в preview-хосте заметно. |
| 8 | SDK `client.py` | `urllib.request.urlopen(req)` без `timeout` → зависает навсегда при зависшем gateway. Нет ретраев. | Агент-воркер виснет. |

### P1 — важно для консистентности

| # | Зона | Проблема |
|---|------|----------|
| 9 | `TaskEscrow.sol` | Нет `nonReentrant` на `stake/unstake/_settle`. Токен `NanoToken` не malicious, но при апгрейде токена — реентеранси. |
| 10 | `TaskEscrow.sol` | `setFeeBps` использует `require(bps<=500, "fee>5%")` вместо `custom error` — не консистентно и дороже по газу. |
| 11 | `TaskEscrow.sol` | `submitResultWithSig` не проверяет `s` malleability (`s > n/2`) и `v ∈ {27,28}` — принимает replay-вариант. |
| 12 | `TaskEscrow.sol` | `DOMAIN_SEPARATOR` пересчитывается каждый вызов, нет кеша + проверки `chainId` при форке. |
| 13 | `protocol.js` | `splitReward` использует `Math.floor`, Solidity делит нацело — при `reward=1` оба дают `burn=0`, но JS коммент «remainder to worker» не отражен в Solidity `tr=burn` (дубль). Мелочь, но при `feeBps=201` рассинхрон. |
| 14 | `backend/src/escrow.js` | `stakeMore` не проверяет `amount>0` и `amount<=balance`, ошибка уходит как 500 вместо 402. |
| 15 | `simulations/burn_sim.py` | `in_flight_peak` всегда 1 — задачи симулируются последовательно, не конкурентно. Velocity sink занижен в 1000 раз, вводит в заблуждение инвестора. |
| 16 | `tests/test_escrow.py` | Дублирует логику эскроу вместо импорта `contracts/lib/protocol.js` — расхождение не ловится. |
| 17 | `sdk/index.js` | Нет `timeout`/`AbortController`, нет `retries`, нет валидации `reward`. Агент падает на сетевом глюке. |
| 18 | Фронт `index.html` | `localStorage` ключ теряется при очистке — UI показывает «Агент не создан» но продолжает слать `Bearer null`. Нет реконнекта/бейджа. |

### P2 — полировка до «идеально»

- Отсутствует `Dockerfile`, `healthz` не проверяет память/disk, нет `prometheus` метрик, логи не структурированы.
- Нет `CI` (GitHub Actions) — `npm test` + `python tests/test_escrow.py` не гоняются на PR.
- Нет пагинации для `/api/tasks` (отдает 100 последних, но без `?limit&offset` — фронт грузит всё при 10k задач).
- Нет `EIP-2612 permit` в флоу `createTask` (токен умеет, эскроу не вызывает `permit`).
- Нет сохранения состояния gateway на диск — перезапуск стирает задачи (демо-ок, но для стабильности нужен `store.json` как в `wagi`).
- Фронт: нет форматирования больших чисел, нет копирования `addr/apiKey`, нет `empty-state` для `wall`.

---

## 4. Экономика — сверка формул

```
R = reward
f = feeBps / 10000 = 0.02
burn = R * f /2 = R*0.01
treasury = burn
worker = R - burn - treasury = R*0.98
```

- Solidity: `burn = reward*feeBps/20000` → при `feeBps=200` → `burn=reward*0.01` верно.
- JS: `burn = reward*BURN_BPS/10000` → `BURN_BPS=100` → `burn=0.01` верно.
- Расход при `reward=101`: Solidity `burn=1`, `tr=1`, `worker=99`; JS то же. Инвариант `burn+tr+worker==reward` держится.

**Но** при `challenge`: должно быть одинаково:
```
slashed = min(stakes[worker], minStake/2)   // 25 TASK
burnSlash = slashed/2                      // 12 (floor)
compensate = slashed - burnSlash            // 13
```
Сейчас JS берёт 37.5 — завышает slashing в 1.5 раза. Фикс → 25.

---

## 5. План доведения до ума (что делаем в этой ветке)

### 5.1 Контракты (Solidity) — безопасность

- [ ] Добавить `nonReentrant` (simple mutex) на `stake/unstake/createTask/submit*/_settle/challenge/cancel`.
- [ ] `setFeeBps` → `error FeeTooHigh()` + `if(bps>500) revert`.
- [ ] `submitResultWithSig`: проверка `s <= 0x7FFFFFFFF...` и `v==27||28`, `resultHash != 0`.
- [ ] `DOMAIN_SEPARATOR` кешировать + пересчитывать при `block.chainid` zmianie.
- [ ] `_split` вынести `dust` явно: `worker = reward - burn - treasury`.

### 5.2 Референс `contracts/lib/protocol.js` — детерминизм

- [ ] `splitReward` — целые, без `floor` дрейфа, проверка `reward>0`.
- [ ] `verifyResultSig` — реальная проверка длины `0x` + 130 hex + `worker` привязка (fallback-демо но строгий).
- [ ] `challenge` → `sl = min(st, MIN_STAKE/2)`, `burn = Math.floor(sl/2)` — целое.
- [ ] `submitResult` — валидация `taskId`, `resultHash` формат `0x` 64 hex.
- [ ] Добавить `keccak` полифил (js-sha3 легкий) или явно документировать `sha256-demo` и добавить `TODO: replace with keccak`.

### 5.3 Gateway `backend/src/escrow.js` + `app.js` — стабильность

- [ ] Валидация всех входов: `label` (1..32, alnum-_.), `reward` (1..1e9, integer), `timeout` (5..30days), `resultHash` (0x64hex), `amount` faucet (10..1000).
- [ ] Санитайз `label` → `escapeHtml` для API отдачи + фронт `textContent` вместо `innerHTML` для меток.
- [ ] `readBody` лимит 256KB, кэтч `SyntaxError → 400`.
- [ ] Rate-limit: `faucet` 6/min per ip, `createAgent` 20/min per ip, `createTask` 60/min per key.
- [ ] Security headers: `x-content-type-options`, `x-frame-options`, `referrer-policy`.
- [ ] Пагинация `/api/tasks?limit=&offset=&status=` + `Cache-Control` для статики.
- [ ] Структурированные логи `[nano]` с `reqId`.
- [ ] Graceful shutdown `SIGTERM`.
- [ ] Персистенс опционально: `STATE_FILE` json (как в wagi/store.js) — если `env` задан, писать каждые 5с.

### 5.4 Фронт `public/index.html`

- [ ] Экранирование `label`/`input` перед вставкой, `textContent` для таблиц.
- [ ] Кнопка «Копировать key/addr», бейдж реконнекта, `navigator.onLine`.
- [ ] Debounce `refreshAll` 4с → 3с + `visibilitychange` пауза.
- [ ] Форматирование чисел `toLocaleString`, пустые состояния с подсказкой.

### 5.5 SDK JS + Python

- [ ] JS: `timeoutMs=8000`, `retries=2` с `AbortController` + `backoff`.
- [ ] JS/Python: валидация `reward`, `resultHash`, `baseUrl`.
- [ ] Python: `timeout=8` в `urlopen`, `URLError` ретрай, `Wallet.sign_result` — явный `TODO keccak`.

### 5.6 Симуляции

- [ ] `burn_sim.py`: конкурентный `inFlight` (пул задач), sweep по `concurrent`.
- [ ] `load_test_sim.py`: добавить `batch` бенч и график латентности.

### 5.7 Тесты

- [ ] Добавить негативные: `invalid reward`, `no auth`, `double submit`, `challenge after settle` → 409.
- [ ] Фазз для `splitReward` суммы.

### 5.8 Наблюдаемость

- [ ] `GET /healthz` → `{ok, uptime, mem, tasks, version}`.
- [ ] `GET /metrics` (prometheus-lite) или расширение `/api/stats`.

---

## 6. Критерии «идеально» (Definition of Done)

- [ ] `npm test` 30+ зеленых, `python tests/test_escrow.py` зеленые, `python simulations/*.py` проходят без `assert`.
- [ ] Gateway не крашится на: `reward=-1`, `reward=NaN`, `timeout=0`, `label=<script>`, `body 10MB`, 100 req/s faucet.
- [ ] Фронт не показывает `undefined` при потере ключа, XSS невозможен.
- [ ] `protocol.js` и `TaskEscrow.sol` дают одинаковые `split` и `slashed` на 10k рандомных кейсов.
- [ ] SDK не виснет: таймаут 8с, ретрай 2.
- [ ] Документация `QUALITY_AUDIT.md` + `README` секция «Стабильность».

---

## 7. Риски если не делать

- Демо падает на большой нагрузке на презентации (самая частая причина «неидеально»).
- Инвестор спросит «почему burn в симуляции ≠ ончейн» — нет ответа.
- Gasless сабмит без проверки → спам стена сеттлов.

---

## 8. Дальше (после идеала)

- `wagi`-style `store.json` персистенс + `Dockerfile`.
- EIP-2612 `permit` во флоу `createTaskWithPermit`.
- Batch-settle `settleMany(uint256[] ids)` для экономии газа 30% (уже в симуляции).
- WebSocket лента `events` вместо polling 4с.

