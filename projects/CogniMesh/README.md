# CogniMesh — $COGNI

> Клиринговый слой для экономики машин: стрим-микроплатежи, PoVT/slash, flash-compute.

## Запуск одной кнопкой

Нужен только **Node.js 18+**. Зависимостей нет.

```bash
cd projects/CogniMesh
./start.sh
```

или:

```bash
cd projects/CogniMesh && npm start
```

Откроется шлюз на **http://0.0.0.0:8787** — лендинг + живая консоль агентов.

```bash
npm test    # контрактный референс + API + SDK
npm run sim # симуляция экономики
```

Порт: `PORT=8787` (по умолчанию). Хост: `HOST=0.0.0.0`.

## Что умеет веб-морда

- создать агента (DID + стейк + демо-баланс)
- кран COGNI, flash-займ под репутацию
- доска A2A-задач: post / take → сеттл 70/20/10 и burn
- слэш чужого агента
- стена сеттлов, лента событий, граф меша

## Стек проекта

| Папка | Содержание |
|---|---|
| `backend/` | шлюз + UI (`public/`) |
| `contracts/` | Solidity + JS-референс экономики |
| `sdk/` | JS / Python |
| `simulations/` | Monte-Carlo burn/slash |
| `marketing/` | запуск, KPI, пресс |
| `whitepaper.md` | спецификация |

NFA / DYOR.
