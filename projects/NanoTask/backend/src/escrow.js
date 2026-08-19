import { randomUUID } from "node:crypto";
import { NanoTaskState, splitReward, hashInput, signResult, STATUS, MIN_STAKE, validateLabel, validateResultHash } from "../../contracts/lib/protocol.js";

function escapeLabel(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])).slice(0, 32);
}

export class Gateway {
  constructor({ persist } = {}) {
    this.state = new NanoTaskState();
    this.keys = new Map(); // apiKey -> {addr, label, created, capabilities}
    this.startedAt = Date.now();
    this.faucetBuckets = new Map(); // addr -> {count, resetAt}
    this.presence = new Map(); // addr -> {label, lastHeartbeat, waitingSince, capabilities, idleEarned, tasksDone}
    this._persist = persist || null;
    this._seedDemo();
  }
  setPersist(persist){ this._persist=persist; }
  _touch(){ this._persist?.schedule(); }

  _seedDemo() {
    const names = ["alice-agent", "bob-worker", "carol-executor", "dave-oracle", "eve-crawler"];
    for (const n of names) this.createAgent(n, { seed: true, balance: 800, stake: 80 });
    const keys = [...this.keys.keys()];
    const demoClient = this.auth(`Bearer ${keys[0]}`);
    if (demoClient) {
      try {
        this.createTask(`Bearer ${keys[0]}`, { input: "parse 10k rows CSV → JSON", reward: 120, timeout: 45 });
        this.createTask(`Bearer ${keys[0]}`, { input: "review PR #42 for reentrancy", reward: 80, timeout: 60 });
      } catch {}
      const tasks = this.state.listTasks();
      if (tasks[0] && keys[1]) {
        try { this.submitResult(`Bearer ${keys[1]}`, tasks[0].id, hashInput("result-demo-1")); } catch {}
      }
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
    let clean;
    try { clean = validateLabel(label); } catch (e) {
      if (seed) clean = "agent";
      else throw e;
    }
    const safeLabel = escapeLabel(clean);
    const bal = Math.min(100000, Math.max(0, Math.floor(Number(balance) || 500)));
    const st = Math.min(100000, Math.max(0, Math.floor(Number(stake) || 0)));
    const key = "nt_" + randomUUID().replace(/-/g, "").slice(0, 24);
    const addr = "0x" + randomUUID().replace(/-/g, "").slice(0, 40);
    this.state.mintTo(addr, bal);
    const toStake = Math.min(st, this.state.bal(addr));
    if (toStake >= MIN_STAKE) {
      this.state.stake(addr, toStake);
    } else if (toStake > 0) {
      this.state.mintTo(addr, MIN_STAKE - toStake);
      this.state.stake(addr, MIN_STAKE);
    } else if (!seed) {
      // ensure at least min stake for usability
      this.state.mintTo(addr, MIN_STAKE);
      this.state.stake(addr, MIN_STAKE);
    }
    this.keys.set(key, { addr, label: safeLabel, created: Date.now(), seed, capabilities: [] });
    this.log("register", `${safeLabel} staked ${toStake} TASK`);
    this._touch();
    return { apiKey: key, addr, label: safeLabel, balance: this.state.bal(addr), stake: this.state.stakes.get(addr) ?? 0 };
  }

  auth(header) {
    const k = String(header ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!k) return null;
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

  _checkFaucetRate(addr) {
    const now = Date.now();
    const b = this.faucetBuckets.get(addr) ?? { count: 0, resetAt: now + 60_000 };
    if (now > b.resetAt) { b.count = 0; b.resetAt = now + 60_000; }
    b.count += 1;
    this.faucetBuckets.set(addr, b);
    if (b.count > 6) throw Object.assign(new Error("faucet rate limit: 6/min"), { status: 429 });
  }

  faucet(header, amount = 250) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    this._checkFaucetRate(me.addr);
    const raw = Number(amount);
    let amt = Number.isFinite(raw) ? Math.floor(raw) : 250;
    amt = Math.min(1000, Math.max(10, amt));
    this.state.mintTo(me.addr, amt);
    this.log("faucet", `${me.label} +${amt} TASK`);
    this._touch();
    return { balance: this.state.bal(me.addr), toppedUp: amt };
  }

  stakeMore(header, amount) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const raw = Number(amount);
    if (!Number.isFinite(raw) || raw <= 0) throw Object.assign(new Error("stake amount must be >0"), { status: 400 });
    const amt = Math.floor(raw);
    if (amt <= 0) throw Object.assign(new Error("stake amount must be >0"), { status: 400 });
    if (amt > 100000) throw Object.assign(new Error("stake too large"), { status: 400 });
    if (this.state.bal(me.addr) < amt) throw Object.assign(new Error("not enough TASK to stake"), { status: 402 });
    this.state.stake(me.addr, amt);
    this._touch();
    return { stake: this.state.stakes.get(me.addr), balance: this.state.bal(me.addr) };
  }

  createTask(header, { input, inputHash, reward, timeout }) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const rewRaw = reward ?? 10;
    const rew = Math.floor(Number(rewRaw));
    if (!Number.isFinite(rew) || rew <= 0) throw Object.assign(new Error("reward must be positive integer"), { status: 400 });
    if (rew > 1_000_000) throw Object.assign(new Error("reward too large"), { status: 400 });
    if (this.state.bal(me.addr) < rew) throw Object.assign(new Error("not enough TASK to escrow reward"), { status: 402 });
    // sanitize input
    let safeInput = null;
    if (input != null) {
      safeInput = String(input).slice(0, 180).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
      if (safeInput.length === 0) safeInput = "task";
    }
    let hash = inputHash;
    if (hash != null) {
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash.trim())) throw Object.assign(new Error("inputHash must be 0x + 64 hex"), { status: 400 });
      hash = hash.trim().toLowerCase();
    } else {
      hash = hashInput(safeInput ?? `task-${Date.now()}`);
    }
    const t = this.state.createTask(me.addr, { inputHash: hash, reward: rew, timeoutSec: timeout != null ? Number(timeout) : 60 });
    t.clientLabel = me.label;
    t.input = safeInput ?? hash.slice(0, 18);
    this._touch();
    // notify wait pool (smart dispatch)
    try { this._notifyPool(t); } catch {}
    return t;
  }

  submitResult(header, taskId, resultHash, signature) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("invalid taskId"), { status: 400 });
    let rh = resultHash;
    if (rh != null) {
      try { rh = validateResultHash(rh); } catch (e) { throw e; }
    } else {
      rh = hashInput(`result-${id}-${me.addr}-${Date.now()}`);
    }
    const t = this.state.submitResult(me.addr, id, rh, signature);
    t.workerLabel = me.label;
    // presence tasksDone
    const pres = this.presence.get(me.addr);
    if (pres) pres.tasksDone = (pres.tasksDone||0)+1;
    this._touch();
    return t;
  }

  submitWithSig(header, taskId, { resultHash, worker, signature }) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("invalid taskId"), { status: 400 });
    if (typeof worker !== "string" || !/^0x[0-9a-fA-F]{32,40}$/.test(worker)) throw Object.assign(new Error("worker must be 0x hex (32-40)"), { status: 400 });
    const rh = validateResultHash(resultHash);
    // signature must be valid format; state will verify again
    if (!signature) throw Object.assign(new Error("signature required"), { status: 400 });
    const t = this.state.submitResult(worker.toLowerCase(), id, rh, signature);
    t.workerLabel = [...this.keys.values()].find(k => k.addr === worker.toLowerCase())?.label ?? worker.slice(0, 10);
    t.relayedBy = me.label;
    this._touch();
    return t;
  }

  approve(header, taskId) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("invalid taskId"), { status: 400 });
    return this.state.approve(me.addr, id);
    this._touch();
  }

  claimTimeout(header, taskId) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("invalid taskId"), { status: 400 });
    return this.state.claimTimeout(me.addr, id);
    this._touch();
  }

  challenge(header, taskId, reason) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("invalid taskId"), { status: 400 });
    const cleanReason = String(reason ?? "spam").slice(0, 120).replace(/[\x00-\x1F]/g, "");
    const { slashed, task } = this.state.challenge(me.addr, id, cleanReason);
    return { task, slashed };
    this._touch();
  }

  cancel(header, taskId) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("invalid taskId"), { status: 400 });
    return this.state.cancel(me.addr, id);
    this._touch();
  }

  tasksPublic(limit = 80, offset = 0, statusFilter = null) {
    const lim = Math.min(100, Math.max(1, Math.floor(Number(limit) || 80)));
    const off = Math.max(0, Math.floor(Number(offset) || 0));
    let sf = null;
    if (statusFilter != null && statusFilter !== "") {
      const n = Number(statusFilter);
      if (Number.isInteger(n) && n >= 0 && n <= 4) sf = n;
    }
    return this.state.listTasks(lim, off, sf).map(t => ({
      ...t,
      clientLabel: t.clientLabel ?? [...this.keys.values()].find(k=>k.addr===t.client)?.label ?? t.client.slice(0, 10),
      workerLabel: t.workerLabel ?? (t.worker ? [...this.keys.values()].find(k=>k.addr===t.worker)?.label ?? t.worker.slice(0, 10) : null),
    }));
  }

  wall(limit = 40) {
    const lim = Math.min(100, Math.max(1, Math.floor(Number(limit) || 40)));
    return [...this.state.tasks.values()]
      .filter(t=> t.status===STATUS.SETTLED)
      .sort((a,b)=> (b.settledAt??0)-(a.settledAt??0))
      .slice(0, lim)
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

  signHelper(header, taskId, resultHash) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const rh = validateResultHash(resultHash ?? hashInput("0xdeadbeef"));
    return signResult(Number(taskId), rh, me.addr);
  }

  // ---- presence pool (WAIT MODE) ----
  setCapabilities(header, caps) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    if (!Array.isArray(caps)) throw Object.assign(new Error("capabilities must be array"), { status: 400 });
    if (caps.length > 10) throw Object.assign(new Error("max 10 capabilities"), { status: 400 });
    const clean = caps.map(s => String(s).trim().toLowerCase().slice(0,32)).filter(s=> s.length>=2 && s.length<=32 && /^[a-z0-9._\- ]+$/.test(s));
    if (clean.length !== caps.length) throw Object.assign(new Error("each capability 2..32 alnum ._- space"), { status: 400 });
    const keyInfo = this.keys.get(me.apiKey);
    if (keyInfo) keyInfo.capabilities = clean;
    // also update presence if online
    const pres = this.presence.get(me.addr);
    if (pres) pres.capabilities = clean;
    this._touch();
    return { addr: me.addr, label: me.label, capabilities: clean };
  }

  heartbeat(header) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    if ((this.state.stakes.get(me.addr) ?? 0) < MIN_STAKE) throw Object.assign(new Error(`need stake >=${MIN_STAKE} to be in WAIT pool`), { status: 403 });
    const now = Date.now();
    let entry = this.presence.get(me.addr);
    let idleReward = 0;
    if (!entry) {
      entry = { addr: me.addr, label: me.label, lastHeartbeat: now, waitingSince: now, capabilities: this.keys.get(me.apiKey)?.capabilities || [], idleEarned: 0, tasksDone: 0, lastRewardAt: 0 };
      this.presence.set(me.addr, entry);
    } else {
      // idle bonus: 0.2 TASK per 60s online (from treasury faucet, limited to 0.2/min to prevent farm)
      if (now - (entry.lastRewardAt || 0) >= 60000) {
        idleReward = 0.2;
        // mint as presence bonus (demo: from faucet, in prod from treasury yield)
        this.state.mintTo(me.addr, idleReward);
        entry.idleEarned = (entry.idleEarned || 0) + idleReward;
        entry.lastRewardAt = now;
        this.log("presence", `${me.label} +${idleReward} idle bonus (online ${(now-entry.waitingSince)/1000|0}s)`);
      }
      entry.lastHeartbeat = now;
      entry.label = me.label; // keep fresh
    }
    // also touch persist
    this._touch();
    const pool = this.poolPublic();
    return { ok: true, addr: me.addr, label: me.label, waitingSince: entry.waitingSince, lastHeartbeat: entry.lastHeartbeat, idleEarned: entry.idleEarned, idleReward, poolSize: pool.length, capabilities: entry.capabilities };
  }

  poolPublic() {
    const now = Date.now();
    const ONLINE_TTL = 90000; // 90s
    // prune offline (>90s)
    for (const [addr, e] of this.presence.entries()) {
      if (now - e.lastHeartbeat > ONLINE_TTL) {
        // keep entry but mark offline? For now delete so pool shows only live
        // this.presence.delete(addr);
      }
    }
    return [...this.presence.values()]
      .filter(e => now - e.lastHeartbeat < ONLINE_TTL)
      .sort((a,b)=> a.waitingSince - b.waitingSince)
      .map(e => ({
        addr: e.addr,
        label: e.label,
        capabilities: e.capabilities || [],
        waitingSince: e.waitingSince,
        waitingSec: Math.floor((now - e.waitingSince)/1000),
        lastHeartbeat: e.lastHeartbeat,
        idleEarned: e.idleEarned || 0,
        tasksDone: e.tasksDone || 0,
        stake: this.state.stakes.get(e.addr) ?? 0,
        balance: this.state.bal(e.addr),
      }));
  }

  presenceStats() {
    const pool = this.poolPublic();
    const totalIdle = pool.reduce((s,e)=> s + (e.idleEarned||0), 0);
    return { online: pool.length, totalIdleEarned: totalIdle, pool };
  }

  // try to find best waiting worker for a task (capability match)
  findBestWorker(taskInput) {
    const pool = this.poolPublic();
    if (!pool.length) return null;
    const input = String(taskInput||"").toLowerCase();
    // score by capability match + waiting time
    let best = null, bestScore = -1;
    for (const w of pool) {
      const caps = w.capabilities || [];
      let match = 0;
      if (caps.length) {
        for (const c of caps) if (input.includes(c)) match += 2;
        // if no cap matches, score 0 but still eligible as generic
      } else {
        match = 0.5; // generic worker
      }
      const waitingBonus = Math.min(10, w.waitingSec / 60); // up to 10 points for waiting 10min
      const stakeBonus = Math.min(2, w.stake / 50);
      const score = match*10 + waitingBonus + stakeBonus;
      if (score > bestScore) { bestScore = score; best = w; }
    }
    // require at least some score if capabilities specified and no match? still allow generic
    return best;
  }

  // when a task is created, try to notify best worker (log)
  _notifyPool(task) {
    const best = this.findBestWorker(task.input);
    if (best) {
      this.log("dispatch", `task #${task.id} "${task.input.slice(0,30)}" → best wait ${best.label} (${best.capabilities.join(",")||"generic"})`);
      // increment tasksDone for that worker when they later submit? track via submitResult
    }
  }
}


export { splitReward, STATUS, MIN_STAKE, hashInput, signResult };
