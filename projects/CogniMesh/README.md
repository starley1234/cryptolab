# CogniMesh — $COGNI

> **The Settlement & Verification Layer for the Autonomous Machine Economy.**

Родная финансовая среда для AI-агентов: субцентовые стрим-платежи, ончейн-идентичность, слэш за мусорный инференс, flash-compute кредиты под репутацию.

```
[ Agent A ] ── task + stream ──► [ Agent B ]
     │                                  │
     ▼                                  ▼
 ┌──────────────────────────────────────────┐
 │  CogniMesh                               │
 │  AgentRegistry · StreamPayment · Slash   │
 │  FlashCompute · Burn-on-settle           │
 └──────────────────────────────────────────┘
```

## Почему это деньги, а не мем

Человек делает 1–5 tx/день. Агент — **10⁴ микроплатежей/час**. GPU-маркеты (Render, Akash) продают железо, но не **проверяют работу** и не **стримят оплату за токен**. Кошельки 2026 (Trust Wallet Agent Kit, Mesh, EIP-8004) дают identity — нам нужен **клиринг**.

## Структура

| Папка | Содержание |
|---|---|
| `contracts/` | CogniToken, AgentRegistry, StreamPayment, SlashManager, FlashCompute |
| `backend/` | Mesh Gateway + лендинг (zero-dep Node) |
| `sdk/` | Python + JS клиент агента |
| `simulations/` | A2A экономика (burn, slash, кредиты) |
| `marketing/` | вайтпейпер, запуск, контент, KPI |
| `docs/` | продакшен-ранбук |

## Быстрый старт

```bash
cd projects/CogniMesh/contracts && npm install && npm test
cd ../backend && npm test && npm start
# http://0.0.0.0:8787
cd ../simulations && python3 a2a_economy_sim.py
```

## Токеномика (кратко)

- Фикс **1 000 000 000 COGNI**, mint нет.
- Сеттл стрима: **70% провайдеру / 20% казна / 10% burn**.
- Стейк агента слэшится при провале верификации (PoVT).
- Flash-compute: беззалог до `reputation * stake / 1e6`.

Полная математика: [whitepaper.md](whitepaper.md).

## Статус

- ✅ Контракты + тесты
- ✅ Шлюз A2A + лендинг
- ✅ SDK, симуляция, маркетинг
- ⬜ Аудит → testnet → TGE

NFA / DYOR.
