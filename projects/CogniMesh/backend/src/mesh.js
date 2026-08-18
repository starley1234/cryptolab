import { randomUUID } from "node:crypto";
import { MeshState, splitStream, creditLimit, REPUTATION_SCALE } from "../../contracts/lib/protocol.js";

export class Gateway {
  constructor() {
    this.mesh = new MeshState();
    this.mesh.mintTo("faucet", 50_000_000);
    this.keys = new Map();
    this.jobs = [];
    this.wall = [];
  }

  createAgent(label = "agent") {
    const key = "cm_" + randomUUID().replace(/-/g, "").slice(0, 24);
    const addr = "0x" + randomUUID().replace(/-/g, "").slice(0, 40);
    this.mesh.mintTo(addr, 5_000);
    this.mesh.register(addr, 200);
    this.keys.set(key, { addr, label, created: Date.now() });
    return { apiKey: key, addr, label, balance: this.mesh.bal(addr), stake: 200 };
  }

  auth(header) {
    const k = String(header ?? "").replace(/^Bearer\s+/i, "");
    const info = this.keys.get(k);
    if (!info) return null;
    const ag = this.mesh.agents.get(info.addr);
    return { ...info, balance: this.mesh.bal(info.addr), agent: ag };
  }

  postJob(payerKey, { title, budget, workTokens }) {
    const p = this.auth(payerKey);
    if (!p) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const job = {
      id: "job_" + randomUUID().slice(0, 8),
      title: String(title ?? "inference").slice(0, 80),
      budget: Number(budget) || 10,
      workTokens: Number(workTokens) || 100,
      payer: p.addr,
      status: "open",
      ts: Date.now(),
    };
    this.jobs.unshift(job);
    return job;
  }

  takeJob(providerKey, jobId) {
    const pr = this.auth(providerKey);
    if (!pr) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || job.status !== "open") throw Object.assign(new Error("job gone"), { status: 404 });
    const nonce = Date.now();
    const deposit = job.budget;
    if (this.mesh.bal(job.payer) < deposit) throw Object.assign(new Error("payer broke"), { status: 402 });
    const ch = this.mesh.openChannel(job.payer, pr.addr, deposit, nonce);
    const split = this.mesh.settle(ch, deposit);
    this.mesh.success(pr.addr);
    job.status = "settled";
    job.provider = pr.addr;
    job.split = split;
    this.wall.unshift({
      q: job.title,
      burn: split.burn,
      tokens: job.workTokens,
      ts: Date.now(),
    });
    this.wall = this.wall.slice(0, 40);
    return { job, split, channel: ch, providerBalance: this.mesh.bal(pr.addr) };
  }

  stats() {
    return {
      agents: this.keys.size,
      jobs: this.jobs.length,
      burned: this.mesh.burned,
      supply: this.mesh.supply,
      treasury: this.mesh.bal("treasury"),
      openJobs: this.jobs.filter((j) => j.status === "open").length,
    };
  }

  credit(addr) {
    const a = this.mesh.agents.get(addr);
    return a ? creditLimit(a.reputation, a.stake) : 0;
  }
}

export { splitStream, REPUTATION_SCALE };
