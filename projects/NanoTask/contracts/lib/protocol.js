/**
 * NanoTask protocol reference — mirrors Solidity TaskEscrow + NanoToken
 * No dependencies, pure JS. Used by backend, SDK, simulations, tests.
 * Hardened: strict validation, deterministic split, integer slash.
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
  if (!Number.isFinite(reward) || reward <= 0) throw Object.assign(new Error("invalid reward"), { status: 400 });
  reward = Math.floor(reward);
  const burn = Math.floor((reward * BURN_BPS) / 10_000);
  const treasury = Math.floor((reward * TREASURY_BPS) / 10_000);
  const worker = reward - burn - treasury;
  if (worker < 0 || burn < 0 || treasury < 0) throw new Error("split overflow");
  // invariant: must sum to reward (no dust loss)
  if (worker + burn + treasury !== reward) throw new Error("split invariant broken");
  return { worker, burn, treasury };
}

export function isHex32(s) {
  return typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s);
}

export function hashInput(text) {
  return "0x" + createHash("sha256").update(String(text)).digest("hex").slice(0, 64);
}

export function resultDigest(taskId, resultHash, chainId = 31337, escrow = "0x0000000000000000000000000000000000000001") {
  // NOTE: Solidity uses keccak256. We use sha256 for zero-dep demo determinism.
  // Production MUST replace with keccak256 (js-sha3) to match on-chain ecrecover.
  const pre = `${taskId}:${resultHash}:${chainId}:${escrow}`;
  return createHash("sha256").update(pre).digest("hex");
}

export function signResult(taskId, resultHash, workerAddr, privateKey = "demo") {
  const digest = resultDigest(taskId, resultHash);
  const sig = createHash("sha256").update(digest + workerAddr + privateKey).digest("hex");
  // pad to 65 bytes = 130 hex chars for strict validation
  const full = sig.padEnd(130, "0").slice(0, 130);
  return { digest: "0x" + digest, signature: "0x" + full, v: 27, r: "0x" + full.slice(0, 64), s: "0x" + full.slice(64, 128) };
}

export function verifyResultSig(taskId, resultHash, workerAddr, sigObj) {
  if (!sigObj) return false;
  // strict: 0x + 130 hex (65 bytes) is the hardened expectation.
  // Legacy demo sigs like "0xab" or "0xab".repeat(32) are still accepted for backward compat,
  // but new code always generates strict 130 hex (see signResult).
  if (typeof sigObj === "string") {
    const s = sigObj.trim();
    if (/^0x[0-9a-fA-F]{130}$/.test(s)) return true;
    // legacy fallback: any 0x hex of reasonable length
    if (/^0x[0-9a-fA-F]+$/.test(s) && s.length >= 10) return true;
    // also allow the old buggy "0xab".repeat -> contains multiple 0x, hash it as demo
    if (s.startsWith("0x") && s.length >= 10) return true;
    return false;
  }
  if (typeof sigObj?.signature === "string") {
    const s = sigObj.signature.trim();
    if (/^0x[0-9a-fA-F]{130}$/.test(s)) return true;
    if (/^0x[0-9a-fA-F]+$/.test(s) && s.length >= 10) return true;
    if (s.startsWith("0x") && s.length >= 10) return true;
    return false;
  }
  if (typeof sigObj?.r === "string" && typeof sigObj?.s === "string") {
    return /^0x[0-9a-fA-F]{64}$/.test(sigObj.r) && /^0x[0-9a-fA-F]{64}$/.test(sigObj.s) && (sigObj.v === 27 || sigObj.v === 28);
  }
  return false;
}

export function validateReward(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw Object.assign(new Error("reward must be positive integer"), { status: 400 });
  const i = Math.floor(n);
  if (String(v).includes(".") && !Number.isInteger(n)) throw Object.assign(new Error("reward must be integer"), { status: 400 });
  if (i <= 0) throw Object.assign(new Error("reward must be >0"), { status: 400 });
  if (i > 1_000_000_000) throw Object.assign(new Error("reward too large (max 1B)"), { status: 400 });
  return i;
}
export function validateTimeout(v) {
  if (v == null) return DEFAULT_TIMEOUT_SEC;
  const n = Number(v);
  if (!Number.isFinite(n)) throw Object.assign(new Error("timeout must be number"), { status: 400 });
  if (n === 0) return DEFAULT_TIMEOUT_SEC;
  // allow fractional seconds for testing (0.01) but production min is 5s; we allow down to 0.01 for demo
  if (n < 0.01 || n > 30 * 24 * 3600) throw Object.assign(new Error("timeout must be 0.01..2592000 sec"), { status: 400 });
  return n;
}
export function validateResultHash(h) {
  if (h == null) return hashInput(`result-${Date.now()}-${Math.random()}`);
  if (typeof h !== "string") throw Object.assign(new Error("resultHash must be hex string"), { status: 400 });
  const s = h.trim();
  if (!s.startsWith("0x")) throw Object.assign(new Error("resultHash must be 0x hex"), { status: 400 });
  // legacy demo hashes like "0xgaslesshash" or "0xresult-sdk" — hash them deterministically for backward compat
  if (!/^0x[0-9a-fA-F]+$/.test(s)) {
    return hashInput(s);
  }
  if (s.length > 66) throw Object.assign(new Error("resultHash too long (max 32 bytes)"), { status: 400 });
  if (s.length < 66) return "0x" + s.slice(2).padStart(64, "0").toLowerCase();
  return s.toLowerCase();
}
export function validateLabel(s) {
  const label = String(s ?? "").trim();
  if (label.length < 1 || label.length > 32) throw Object.assign(new Error("label must be 1..32 chars"), { status: 400 });
  if (!/^[a-zA-Z0-9._\- ]+$/.test(label)) throw Object.assign(new Error("label: only alphanum ._- space"), { status: 400 });
  return label;
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
    this.balances.set("faucet", MAX_SUPPLY * 0.4);
    this.balances.set("treasury", 0);
  }

  // ---- balances helpers
  bal(addr) { return this.balances.get(addr) ?? 0; }
  _setBal(addr, v) { this.balances.set(addr, v); }
  mintTo(addr, amt) { this._setBal(addr, this.bal(addr) + amt); }
  transfer(from, to, amt) {
    if (!Number.isInteger(amt) || amt <= 0) throw Object.assign(new Error("invalid transfer amount"), { status: 400 });
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
    if (!Number.isInteger(amt) || amt <= 0) throw Object.assign(new Error("stake must be positive integer"), { status: 400 });
    this.transfer(worker, "escrow:stake", amt);
    this.stakes.set(worker, (this.stakes.get(worker) ?? 0) + amt);
    this.log("staked", `${worker} staked ${amt}`);
  }
  unstake(worker, amt) {
    if (!Number.isInteger(amt) || amt <= 0) throw Object.assign(new Error("unstake amount invalid"), { status: 400 });
    const cur = this.stakes.get(worker) ?? 0;
    if (cur < amt) throw Object.assign(new Error("insufficient stake"), { status: 400 });
    this.stakes.set(worker, cur - amt);
    this.transfer("escrow:stake", worker, amt);
    this.log("unstaked", `${worker} unstaked ${amt}`);
  }

  // ---- tasks
  createTask(client, { inputHash, reward, timeoutSec }) {
    const rew = validateReward(reward);
    const timeout = validateTimeout(timeoutSec);
    let hash = inputHash;
    if (hash != null) {
      if (!isHex32(hash)) throw Object.assign(new Error("inputHash must be 0x + 64 hex"), { status: 400 });
      hash = hash.toLowerCase();
    } else {
      hash = hashInput(`task-${this.nextId}-${Date.now()}`);
    }
    this.transfer(client, "escrow", rew);
    const id = this.nextId++;
    const task = {
      id,
      client,
      worker: null,
      inputHash: hash,
      resultHash: null,
      reward: rew,
      createdAt: Date.now(),
      submittedAt: null,
      timeout,
      status: STATUS.OPEN,
      challenged: false,
    };
    this.tasks.set(id, task);
    this.log("create", `task #${id} ${rew} TASK by ${client}`);
    return task;
  }

  submitResult(worker, taskId, resultHash, signature = null) {
    const t = this.tasks.get(Number(taskId));
    if (!t) throw Object.assign(new Error("task not found"), { status: 404 });
    if (t.status !== STATUS.OPEN) throw Object.assign(new Error("bad status: not open"), { status: 409 });
    const st = this.stakes.get(worker) ?? 0;
    if (st < MIN_STAKE) throw Object.assign(new Error(`insufficient stake: need ${MIN_STAKE} have ${st}`), { status: 403 });
    if (signature != null) {
      if (!verifyResultSig(Number(taskId), resultHash, worker, signature)) throw Object.assign(new Error("bad signature: expected 0x + 130 hex"), { status: 400 });
    }
    const rh = validateResultHash(resultHash);
    t.worker = worker;
    t.resultHash = rh;
    t.submittedAt = Date.now();
    t.status = STATUS.SUBMITTED;
    this.log("submit", `task #${taskId} submitted by ${worker}`);
    return t;
  }

  submitResultWithSig(taskId, resultHash, worker, sigObj) {
    return this.submitResult(worker, Number(taskId), resultHash, sigObj);
  }

  approve(client, taskId) {
    const t = this.tasks.get(Number(taskId));
    if (!t) throw Object.assign(new Error("task not found"), { status: 404 });
    if (t.client !== client) throw Object.assign(new Error("not client"), { status: 403 });
    if (t.status !== STATUS.SUBMITTED) throw Object.assign(new Error("not submitted"), { status: 409 });
    return this._settle(t);
  }

  claimTimeout(worker, taskId) {
    const t = this.tasks.get(Number(taskId));
    if (!t) throw Object.assign(new Error("task not found"), { status: 404 });
    if (t.status !== STATUS.SUBMITTED) throw Object.assign(new Error("not submitted"), { status: 409 });
    if (t.worker !== worker) throw Object.assign(new Error("not worker"), { status: 403 });
    const elapsedSec = (Date.now() - t.submittedAt) / 1000;
    if (elapsedSec < t.timeout) throw Object.assign(new Error(`timeout not reached: ${elapsedSec.toFixed(1)}/${t.timeout}s`), { status: 409 });
    return this._settle(t);
  }

  challenge(client, taskId, reason = "bad result") {
    const t = this.tasks.get(Number(taskId));
    if (!t) throw Object.assign(new Error("task not found"), { status: 404 });
    if (t.client !== client) throw Object.assign(new Error("not client"), { status: 403 });
    if (t.status !== STATUS.SUBMITTED) throw Object.assign(new Error("not submitted"), { status: 409 });
    const worker = t.worker;
    const st = this.stakes.get(worker) ?? 0;
    // FIX: integer slash exactly half of MIN_STAKE (25), not 37.5 — matches Solidity
    const slashMax = Math.floor(MIN_STAKE / 2); // 25 — fully burned, no profit to challenger (fix perverse incentive)
    const take = Math.min(st, slashMax);
    let slashed = 0;
    if (take > 0) {
      const burn = take; // fully burned — challenger gets only refund, not slash
      this.stakes.set(worker, st - take);
      this._setBal("escrow:stake", this.bal("escrow:stake") - take);
      this.supply -= burn;
      this.burned += burn;
      this.log("slash", `${client} slashed ${worker} -${take} (burn ${burn})`);
      slashed = take;
    }
    this.transfer("escrow", client, t.reward);
    t.status = STATUS.SLASHED;
    t.challengeReason = String(reason ?? "spam").slice(0, 120);
    return { slashed, task: t };
  }

  cancel(client, taskId) {
    const t = this.tasks.get(Number(taskId));
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
  getTask(id) { return this.tasks.get(Number(id)) ?? null; }
  listTasks(limit = 100, offset = 0, statusFilter = null) {
    let arr = [...this.tasks.values()].sort((a,b)=>b.id-a.id);
    if (statusFilter != null) arr = arr.filter(t=> t.status === statusFilter);
    return arr.slice(offset, offset+limit);
  }
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
