import { randomUUID } from "node:crypto";
import { NanoTaskState, splitReward, hashInput, signResult, STATUS, MIN_STAKE } from "../../contracts/lib/protocol.js";

export class Gateway {
  constructor() {
    this.state = new NanoTaskState();
    this.keys = new Map(); // apiKey -> {addr, label, created}
    this.startedAt = Date.now();
    this._seedDemo();
  }

  _seedDemo() {
    // demo treasury mint already via faucet allocation
    const names = ["alice-agent", "bob-worker", "carol-executor", "dave-oracle", "eve-crawler"];
    for (const n of names) this.createAgent(n, { seed: true, balance: 800, stake: 80 });
    const keys = [...this.keys.keys()];
    // create a couple tasks
    const demoClient = this.auth(`Bearer ${keys[0]}`);
    if (demoClient) {
      try {
        this.createTask(`Bearer ${keys[0]}`, { input: "parse 10k rows CSV → JSON", reward: 120, timeout: 45 });
        this.createTask(`Bearer ${keys[0]}`, { input: "review PR #42 for reentrancy", reward: 80, timeout: 60 });
      } catch {}
      // let bob submit one
      const tasks = this.state.listTasks();
      if (tasks[0] && keys[1]) {
        try { this.submitResult(`Bearer ${keys[1]}`, tasks[0].id, hashInput("result-demo-1")); } catch {}
      }
      // settle second via approve demo
      if (tasks[1] && keys[1]) {
        try {
          this.submitResult(`Bearer ${keys[1]}`, tasks[1].id, hashInput("result-demo-2"));
          this.approve(`Bearer ${keys[0]}`, tasks[1].id);
        } catch {}
      }
    }
  }

  log(t, d) { this.state.log(t, d); }

  createAgent(label = "agent", { seed = false, balance = 500, stake = 60 } = {}) {
    const key = "nt_" + randomUUID().replace(/-/g, "").slice(0, 24);
    const addr = "0x" + randomUUID().replace(/-/g, "").slice(0, 40);
    this.state.mintTo(addr, balance);
    // auto stake portion
    const toStake = Math.min(stake, this.state.bal(addr));
    if (toStake >= MIN_STAKE) {
      this.state.stake(addr, toStake);
    } else if (toStake > 0) {
      // keep low but still stake what we can, tests require min
      this.state.mintTo(addr, MIN_STAKE - toStake);
      this.state.stake(addr, MIN_STAKE);
    }
    this.keys.set(key, { addr, label: String(label).slice(0, 32), created: Date.now(), seed });
    this.log("register", `${label} staked ${toStake} TASK`);
    return { apiKey: key, addr, label, balance: this.state.bal(addr), stake: this.state.stakes.get(addr) ?? 0 };
  }

  auth(header) {
    const k = String(header ?? "").replace(/^Bearer\s+/i, "");
    const info = this.keys.get(k);
    if (!info) return null;
    return { ...info, apiKey: k, balance: this.state.bal(info.addr), stake: this.state.stakes.get(info.addr) ?? 0 };
  }

  agentsPublic() {
    return [...this.keys.values()].map((info) => ({
      addr: info.addr,
      label: info.label,
      balance: this.state.bal(info.addr),
      stake: this.state.stakes.get(info.addr) ?? 0,
    }));
  }

  faucet(header, amount = 250) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const amt = Math.min(1000, Math.max(10, Number(amount) || 250));
    this.state.mintTo(me.addr, amt);
    this.log("faucet", `${me.label} +${amt} TASK`);
    return { balance: this.state.bal(me.addr), toppedUp: amt };
  }

  stakeMore(header, amount) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const amt = Number(amount) || 20;
    if (this.state.bal(me.addr) < amt) throw Object.assign(new Error("not enough TASK to stake"), { status: 402 });
    this.state.stake(me.addr, amt);
    return { stake: this.state.stakes.get(me.addr), balance: this.state.bal(me.addr) };
  }

  createTask(header, { input, inputHash, reward, timeout }) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const rew = Number(reward) || 10;
    if (this.state.bal(me.addr) < rew) throw Object.assign(new Error("not enough TASK to escrow reward"), { status: 402 });
    const hash = inputHash ?? hashInput(input ?? `task-${Date.now()}`);
    const t = this.state.createTask(me.addr, { inputHash: hash, reward: rew, timeoutSec: Number(timeout) || 60 });
    // attach labels for UI
    t.clientLabel = me.label;
    t.input = String(input ?? hash).slice(0, 180);
    return t;
  }

  submitResult(header, taskId, resultHash, signature) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const t = this.state.submitResult(me.addr, Number(taskId), resultHash ?? hashInput(`result-${taskId}-${me.addr}-${Date.now()}`), signature);
    t.workerLabel = me.label;
    return t;
  }

  submitWithSig(header, taskId, { resultHash, worker, signature }) {
    // gasless: relayer submits on behalf of worker via EIP712
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    // verify sig matches worker
    const t = this.state.submitResult(worker, Number(taskId), resultHash, signature);
    t.workerLabel = [...this.keys.values()].find(k => k.addr === worker)?.label ?? worker.slice(0,10);
    t.relayedBy = me.label;
    return t;
  }

  approve(header, taskId) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const t = this.state.approve(me.addr, Number(taskId));
    return t;
  }

  claimTimeout(header, taskId) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const t = this.state.claimTimeout(me.addr, Number(taskId));
    return t;
  }

  challenge(header, taskId, reason) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const { slashed, task } = this.state.challenge(me.addr, Number(taskId), reason);
    return { task, slashed };
  }

  cancel(header, taskId) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const t = this.state.cancel(me.addr, Number(taskId));
    return t;
  }

  tasksPublic(limit = 80) {
    return this.state.listTasks(limit).map(t => ({
      ...t,
      clientLabel: t.clientLabel ?? [...this.keys.values()].find(k=>k.addr===t.client)?.label ?? t.client.slice(0,10),
      workerLabel: t.workerLabel ?? (t.worker ? [...this.keys.values()].find(k=>k.addr===t.worker)?.label ?? t.worker.slice(0,10) : null),
    }));
  }

  wall(limit = 40) {
    return [...this.state.tasks.values()]
      .filter(t=> t.status===STATUS.SETTLED)
      .sort((a,b)=> (b.settledAt??0)-(a.settledAt??0))
      .slice(0, limit)
      .map(t=> ({
        id: t.id,
        input: t.input ?? t.inputHash.slice(0,18),
        reward: t.reward,
        split: t.split,
        from: t.clientLabel ?? t.client.slice(0,8),
        to: t.workerLabel ?? t.worker.slice(0,8),
        ts: t.settledAt,
      }));
  }

  stats() {
    const s = this.state.stats();
    return {
      ...s,
      agents: this.keys.size,
      uptimeSec: Math.round((Date.now()-this.startedAt)/1000),
      wall: this.wall(5),
    };
  }

  // for demo: sign helper for frontend
  signHelper(header, taskId, resultHash) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    return signResult(taskId, resultHash, me.addr);
  }
}

export { splitReward, STATUS, MIN_STAKE, hashInput, signResult };
