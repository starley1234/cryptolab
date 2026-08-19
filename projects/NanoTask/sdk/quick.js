// NanoTask quick — 1 функция для агента, без ключей и стейков вручную
//   import { quickTask } from "./sdk/quick.js"
//   const { task, approve } = await quickTask("сделай X", 50)
// — создаст двух агентов, заморозит, сабмитит, approve
import { connect } from "./index.js";

const BASE = process.env.NANOTASK_BASE || "http://localhost:8788";

/**
 * Один вызов — полный цикл: создать задачу, выполнить, закрыть.
 * @param {string} input — что делать
 * @param {number} reward — TASK 1..1_000_000
 * @param {object} opts — { baseUrl, timeout, doWork: () => resultHash }
 * @returns {Promise<{task, settled, client, worker, stats}>}
 */
export async function quickTask(input, reward = 100, opts = {}) {
  // opts.capabilities e.g. ["summarize"] will be set for worker
  const baseUrl = opts.baseUrl || BASE;
  const timeout = opts.timeout || 60;
  const doWork = opts.doWork || (async () => "0x" + "ab".repeat(32));

  const client = await connect(baseUrl, { label: "quick-client" });
  const worker = await connect(baseUrl, { label: "quick-worker" });
  if (opts.capabilities) { try{ await worker.setCapabilities(opts.capabilities); }catch{} }

  const task = await client.createTask({ input, reward, timeout });
  const resultHash = await doWork(task);
  await worker.submitResult(task.id, resultHash);
  const settled = await client.approve(task.id);
  const stats = await client.stats();
  return { task, settled, client, worker, stats };
}

/**
 * Ещё проще — заведи задачу и верни id, без approve (для ручного теста).
 */
export async function quickCreate(input, reward = 100, opts = {}) {
  const baseUrl = opts.baseUrl || BASE;
  const client = await connect(baseUrl, { label: opts.label || "quick-client" });
  const task = await client.createTask({ input, reward, timeout: opts.timeout || 60 });
  return { task, client };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // direct run: node sdk/quick.js "сделай саммари" 100
  const input = process.argv[2] || "demo task";
  const reward = Number(process.argv[3]) || 50;
  quickTask(input, reward).then(({ task, settled }) => {
    console.log(`task #${task.id} → settled worker ${settled.split.worker} burn ${settled.split.burn}`);
  });
}
