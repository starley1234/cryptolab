// NanoTask persistent store — JSON file, atomic write, zero deps
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function storePathFromEnv(env = process.env) {
  return env.NANOTASK_STATE_FILE || env.STATE_FILE || join(process.cwd(), "data", "nanotask-state.json");
}

export class Persist {
  constructor(file, gateway) {
    this.file = file;
    this.gw = gateway;
    this._scheduled = false;
    this._timer = null;
  }

  load() {
    if (!existsSync(this.file)) return false;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      // restore state
      const s = this.gw.state;
      if (raw.supply != null) s.supply = raw.supply;
      if (raw.burned != null) s.burned = raw.burned;
      if (raw.treasuryBal != null) s.treasuryBal = raw.treasuryBal;
      if (raw.balances) s.balances = new Map(Object.entries(raw.balances));
      if (raw.stakes) s.stakes = new Map(Object.entries(raw.stakes));
      if (raw.tasks) {
        s.tasks = new Map(raw.tasks.map(t => [t.id, this._reviveTask(t)]));
        s.nextId = raw.nextId ?? (Math.max(0, ...[...s.tasks.keys()]) + 1);
      }
      if (raw.keys) this.gw.keys = new Map(Object.entries(raw.keys));
      if (raw.events) s.events = raw.events.slice(0,80);
      if (raw.faucetBuckets) this.gw.faucetBuckets = new Map(Object.entries(raw.faucetBuckets));
      return true;
    } catch (e) {
      console.error("[store] load failed, starting fresh:", e.message);
      return false;
    }
  }

  _reviveTask(t) {
    // ensure numeric fields
    return {
      ...t,
      id: Number(t.id),
      reward: Number(t.reward),
      createdAt: Number(t.createdAt),
      submittedAt: t.submittedAt ? Number(t.submittedAt) : null,
      settledAt: t.settledAt ? Number(t.settledAt) : null,
      timeout: Number(t.timeout),
      status: Number(t.status),
    };
  }

  snapshot() {
    const s = this.gw.state;
    return {
      version: 2,
      savedAt: new Date().toISOString(),
      supply: s.supply,
      burned: s.burned,
      treasuryBal: s.treasuryBal,
      balances: Object.fromEntries(s.balances),
      stakes: Object.fromEntries(s.stakes),
      tasks: [...s.tasks.values()],
      nextId: s.nextId,
      keys: Object.fromEntries(this.gw.keys),
      events: s.events,
      faucetBuckets: Object.fromEntries(this.gw.faucetBuckets),
    };
  }

  flush() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      writeFileSync(tmp, JSON.stringify(this.snapshot()));
      renameSync(tmp, this.file);
      return true;
    } catch (e) {
      console.error("[store] flush failed:", e.message);
      return false;
    }
  }

  schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._scheduled = false;
      this.flush();
    }, 500);
    // don't keep process alive
    this._timer.unref?.();
  }

  // start periodic flush every 5s + on signals
  startAuto() {
    this._interval = setInterval(() => this.flush(), 5000);
    this._interval.unref?.();
    const handler = () => this.flush();
    process.on("SIGTERM", handler);
    process.on("SIGINT", handler);
  }

  stopAuto() {
    clearInterval(this._interval);
  }
}
