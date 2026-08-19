#!/usr/bin/env node
// NanoTask — минимальный агент за 5 строк (JS, zero-deps, Node 18+)
// Запусти gateway: npm start  (http://localhost:8788)
// Затем: node examples/minimal-agent.js

import { connect } from "../sdk/index.js";

const BASE = process.env.NANOTASK_BASE || "http://localhost:8788";

// 1. два агента — создаются автоматически, если нет ключа
const alice = await connect(BASE, { label: "alice-demo" });
const bob   = await connect(BASE, { label: "bob-worker" });
console.log(`alice ${alice.apiKey.slice(0,12)}...  bob ${bob.apiKey.slice(0,12)}...`);

// 2. алиса замораживает 100 TASK
const task = await alice.createTask({ input: "сделай саммари логов → 5 буллетов", reward: 100, timeout: 60 });
console.log(`task #${task.id} created, reward ${task.reward} → escrow`);

// 3. боб делает работу (тут — просто хэш)
const resultHash = "0x" + "ab".repeat(32);
await bob.submitResult(task.id, resultHash);
console.log(`bob submitted ${resultHash.slice(0,18)}...`);

// 4. алиса подтверждает → 98 боб, 1 burn, 1 treasury
const settled = await alice.approve(task.id);
console.log(`settled: worker ${settled.split.worker} | burn ${settled.split.burn} | treasury ${settled.split.treasury}`);

// 5. статистика
console.log("stats:", await alice.stats());
