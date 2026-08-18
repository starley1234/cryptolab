/**
 * NanoTask protocol reference — mirrors Solidity TaskEscrow + NanoToken
 * No dependencies, pure JS. Used by backend, SDK, simulations, tests.
 */
import { createHash, randomUUID } from "node:crypto";

export const MAX_SUPPLY = 1_000_000_000;
export const FEE_BPS = 200; // 2%
export const BURN_BPS = 100; // 1%
export const TREASURY_BPS = 100; // 1%
export const WORKER_BPS = 9800;
export const MIN_STAKE = 50;
export const DEFAULT_TIMEOUT_SEC = 60; // demo optimism window
export const STATUS = { OPEN: 0, SUBMITTED: 1, SETTLED: 2, SLASHED: 3, CANCELLED: 4 };

export function splitReward(reward) {
  // fee = 2% -> burn 1%, treasury 1%, worker 98%
  const burn = Math.floor((reward * BURN_BPS) / 10_000);
  const treasury = Math.floor((reward * TREASURY_BPS) / 10_000);
  // ensure no dust loss: remainder goes to worker
  const worker = reward - burn - treasury;
  return { worker, burn, treasury };
}

export function hashInput(text) {
  return "0x" + createHash("sha256").update(String(text)).digest("hex").slice(0, 64);
}

export function resultDigest(taskId, resultHash, chainId = 31337, escrow = "0x0000000000000000000000000000000000000001") {
  // Solidity uses keccak256, we mimic with sha256 for deterministic off-chain
  const pre = `${taskId}:${resultHash}:${chainId}:${escrow}`;
  return createHash("sha256").update(pre).digest("hex");
}

export function signResult(taskId, resultHash, workerAddr, privateKey = "demo") {
  // Demo EIP-712 signing: not real ecrecover, but deterministic for simulation
  const digest = resultDigest(taskId, resultHash);
  // fake sig: hash of digest+worker
  const sig = createHash("sha256").update(digest + workerAddr + privateKey).digest("hex");
  return { digest: "0x" + digest, signature: "0x" + sig.slice(0, 130), v: 27, r: "0x" + sig.slice(0, 64), s: "0x" + sig.slice(64, 128) };
}

export function verifyResultSig(taskId, resultHash, workerAddr, sigObj) {
  if (!sigObj) return false;
  if (typeof sigObj === "string") return sigObj.length >= 10;
  if (typeof sigObj?.signature === "string" && sigObj.signature.length >= 10) return true;
  // also allow raw v/r/s object
  if (typeof sigObj?.r === "string" && typeof sigObj?.s === "string") return true;
  return false;
}

export class NanoTaskState {
  constructor() {
    this.supply = MAX_SUPPLY;
    this.burned = 0;
    this.treasuryBal = 0;
    this.balances = new Map(); // addr -> amount
    this.stakes = new Map(); // worker -> staked
    this.tasks = new Map(); // id -> task
    this.nextId = 1;
    this.events = [];
    // faucet has initial supply
    this.balances.set("faucet", MAX_SUPPLY * 0.4);
    this.balances.set("treasury", 0);
  }

  // ---- balances helpers
  bal(addr) { return this.balances.get(addr) ?? 0; }
  _setBal(addr, v) { this.balances.set(addr, v); }
  mintTo(addr, amt) { this._setBal(addr, this.bal(addr) + amt); }
  transfer(from, to, amt) {
    if (this.bal(from) < amt) throw Object.assign(new Error(`insufficient: ${from} has ${this.bal(from)} need ${amt}`), { status: 402 });
    this._setBal(from, this.bal(from) - amt);
    this._setBal(to, this.bal(to) + amt);
  }
  burn(from, amt) {
    if (this.bal(from) < amt) throw new Error("insufficient for burn");
    this._setBal(from, this.bal(from) - amt);
    this.supply -= amt;
    this.burned += amt;
  }
  log(type, detail) { this.events.unshift({ type, detail, ts: Date.now() }); this.events = this.events.slice(0, 80); }

  // ---- stake
  stake(worker, amt) {
    if (amt <= 0) throw new Error("zero stake");
    this.transfer(worker, "escrow:stake", amt);
    this.stakes.set(worker, (this.stakes.get(worker) ?? 0) + amt);
    this.log("staked", `${worker} staked ${amt}`);
  }
  unstake(worker, amt) {
    const cur = this.stakes.get(worker) ?? 0;
    if (cur < amt) throw new Error("insufficient stake");
    this.stakes.set(worker, cur - amt);
    this.transfer("escrow:stake", worker, amt);
    this.log("unstaked", `${worker} unstaked ${amt}`);
  }

  // ---- tasks
  createTask(client, { inputHash, reward, timeoutSec }) {
    if (!reward || reward <= 0) throw Object.assign(new Error("zero reward"), { status: 400 });
    const timeout = timeoutSec ?? DEFAULT_TIMEOUT_SEC;
    this.transfer(client, "escrow", reward);
    const id = this.nextId++;
    const task = {
      id,
      client,
      worker: null,
      inputHash: inputHash ?? hashInput(`task-${id}-${Date.now()}`),
      resultHash: null,
      reward,
      createdAt: Date.now(),
      submittedAt: null,
      timeout,
      status: STATUS.OPEN,
      challenged: false,
    };
    this.tasks.set(id, task);
    this.log("create", `task #${id} ${reward} TASK by ${client}`);
    return task;
  }

  submitResult(worker, taskId, resultHash, signature = null) {
    const t = this.tasks.get(taskId);
    if (!t) throw Object.assign(new Error("task not found"), { status: 404 });
    if (t.status !== STATUS.OPEN) throw Object.assign(new Error("bad status: not open"), { status: 409 });
    const st = this.stakes.get(worker) ?? 0;
    if (st < MIN_STAKE) throw Object.assign(new Error(`insufficient stake: need ${MIN_STAKE} have ${st}`), { status: 403 });
    if (signature) {
      // verify EIP-712 style (demo)
      if (!verifyResultSig(taskId, resultHash, worker, signature)) throw new Error("bad signature");
    }
    t.worker = worker;
    t.resultHash = resultHash ?? hashInput(`result-${taskId}-${worker}`);
    t.submittedAt = Date.now();
    t.status = STATUS.SUBMITTED;
    this.log("submit", `task #${taskId} submitted by ${worker}`);
    return t;
  }

  submitResultWithSig(taskId, resultHash, worker, sigObj) {
    return this.submitResult(worker, taskId, resultHash, sigObj);
  }

  approve(client, taskId) {
    const t = this.tasks.get(taskId);
    if (!t) throw Object.assign(new Error("task not found"), { status: 404 });
    if (t.client !== client) throw Object.assign(new Error("not client"), { status: 403 });
    if (t.status !== STATUS.SUBMITTED) throw Object.assign(new Error("not submitted"), { status: 409 });
    return this._settle(t);
  }

  claimTimeout(worker, taskId) {
    const t = this.tasks.get(taskId);
    if (!t) throw Object.assign(new Error("task not found"), { status: 404 });
    if (t.status !== STATUS.SUBMITTED) throw Object.assign(new Error("not submitted"), { status: 409 });
    if (t.worker !== worker) throw Object.assign(new Error("not worker"), { status: 403 });
    const elapsedSec = (Date.now() - t.submittedAt) / 1000;
    if (elapsedSec < t.timeout) throw Object.assign(new Error(`timeout not reached: ${elapsedSec.toFixed(1)}/${t.timeout}s`), { status: 409 });
    return this._settle(t);
  }

  challenge(client, taskId, reason = "bad result") {
    const t = this.tasks.get(taskId);
    if (!t) throw Object.assign(new Error("task not found"), { status: 404 });
    if (t.client !== client) throw Object.assign(new Error("not client"), { status: 403 });
    if (t.status !== STATUS.SUBMITTED) throw Object.assign(new Error("not submitted"), { status: 409 });
    // slash worker: half burn, half refund? spec: slash stake burn
    const worker = t.worker;
    const st = this.stakes.get(worker) ?? 0;
    const sl = Math.min(st, MIN_STAKE / 2 + MIN_STAKE / 4); // 37.5 for demo
    const take = Math.min(st, sl || MIN_STAKE / 2);
    if (take > 0) {
      const burn = Math.floor(take / 2);
      const refundToClient = take - burn;
      this.stakes.set(worker, st - take);
      // remove from stake escrow
      this._setBal("escrow:stake", this.bal("escrow:stake") - take);
      this.supply -= burn;
      this.burned += burn;
      // refund part to challenger/client via mint? we move from escrow stake to client
      this.mintTo(client, refundToClient);
      this.log("slash", `${client} slashed ${worker} -${take} (burn ${burn})`);
    }
    // refund reward to client
    this.transfer("escrow", client, t.reward);
    t.status = STATUS.SLASHED;
    t.challengeReason = reason;
    return { slashed: take, task: t };
  }

  cancel(client, taskId) {
    const t = this.tasks.get(taskId);
    if (!t) throw Object.assign(new Error("task not found"), { status: 404 });
    if (t.client !== client) throw Object.assign(new Error("not client"), { status: 403 });
    if (t.status !== STATUS.OPEN) throw Object.assign(new Error("not open"), { status: 409 });
    const elapsedSec = (Date.now() - t.createdAt) / 1000;
    if (elapsedSec < t.timeout) throw Object.assign(new Error("timeout not expired"), { status: 409 });
    this.transfer("escrow", client, t.reward);
    t.status = STATUS.CANCELLED;
    this.log("cancel", `task #${taskId} cancelled, refund ${t.reward}`);
    return t;
  }

  _settle(task) {
    const { worker, burn, treasury } = splitReward(task.reward);
    // escrow holds reward, split
    this._setBal("escrow", this.bal("escrow") - task.reward);
    this.mintTo(task.worker, worker);
    this.mintTo("treasury", treasury);
    this.supply -= burn;
    this.burned += burn;
    this.treasuryBal += treasury;
    task.status = STATUS.SETTLED;
    task.settledAt = Date.now();
    task.split = { worker, burn, treasury };
    this.log("settle", `task #${task.id} settled worker ${worker} burn ${burn} treasury ${treasury}`);
    return task;
  }

  // views
  getTask(id) { return this.tasks.get(id) ?? null; }
  listTasks(limit = 100) { return [...this.tasks.values()].sort((a,b)=>b.id-a.id).slice(0, limit); }
  inFlight() { return [...this.tasks.values()].filter(t=> t.status===STATUS.OPEN || t.status===STATUS.SUBMITTED).length; }
  stats() {
    const all = [...this.tasks.values()];
    return {
      supply: this.supply,
      burned: this.burned,
      treasury: this.bal("treasury"),
      inFlight: this.inFlight(),
      totalTasks: all.length,
      open: all.filter(t=>t.status===STATUS.OPEN).length,
      submitted: all.filter(t=>t.status===STATUS.SUBMITTED).length,
      settled: all.filter(t=>t.status===STATUS.SETTLED).length,
      slashed: all.filter(t=>t.status===STATUS.SLASHED).length,
      cancelled: all.filter(t=>t.status===STATUS.CANCELLED).length,
      feeBps: FEE_BPS,
      burnBps: BURN_BPS,
      minStake: MIN_STAKE,
    };
  }
}
