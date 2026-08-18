import { randomUUID } from "node:crypto";
import { MeshState, splitStream, creditLimit, flashFee, REPUTATION_SCALE } from "../../contracts/lib/protocol.js";

const TEMPLATES = [
  { title: "Rerank 12k retrieval hits", budget: 42, workTokens: 800 },
  { title: "Embed support tickets", budget: 28, workTokens: 400 },
  { title: "zk-summarize nightly logs", budget: 65, workTokens: 1200 },
  { title: "Price 3 CEX funding rates", budget: 18, workTokens: 90 },
  { title: "Vision QA on warehouse cam", budget: 55, workTokens: 600 },
  { title: "Translate agent handbook", budget: 22, workTokens: 300 },
];

export class Gateway {
  constructor() {
    this.mesh = new MeshState();
    this.mesh.mintTo("faucet", 50_000_000);
    this.mesh.mintTo("pool", 2_000_000);
    this.keys = new Map();
    this.jobs = [];
    this.wall = [];
    this.challenges = [];
    this.events = [];
    this.startedAt = Date.now();
    this.seedDemo();
  }

  log(type, detail) {
    this.events.unshift({ type, detail, ts: Date.now() });
    this.events = this.events.slice(0, 80);
  }

  createAgent(label = "agent", { seed = false, balance = 5_000, stake = 200 } = {}) {
    const key = "cm_" + randomUUID().replace(/-/g, "").slice(0, 24);
    const addr = "0x" + randomUUID().replace(/-/g, "").slice(0, 40);
    this.mesh.mintTo(addr, balance);
    this.mesh.register(addr, stake);
    this.keys.set(key, { addr, label: String(label).slice(0, 32), created: Date.now(), seed });
    this.log("register", `${label} staked ${stake} COGNI`);
    return { apiKey: key, addr, label, balance: this.mesh.bal(addr), stake };
  }

  seedDemo() {
    const names = ["atlas-gpu", "hermes-router", "nyx-embed", "orion-vision", "vega-ranker"];
    for (const name of names) {
      this.createAgent(name, { seed: true, balance: 8_000, stake: 300 });
    }
    const keys = [...this.keys.keys()];
    for (let i = 0; i < 4; i++) {
      const t = TEMPLATES[i % TEMPLATES.length];
      try {
        this.postJob("Bearer " + keys[i % keys.length], t);
      } catch {
        /* ignore */
      }
    }
    // settle two jobs so wall is alive
    const open = this.jobs.filter((j) => j.status === "open");
    if (open[0] && keys[1]) {
      try {
        this.takeJob("Bearer " + keys[1], open[0].id);
      } catch {
        /* same-agent skip */
      }
    }
  }

  auth(header) {
    const k = String(header ?? "").replace(/^Bearer\s+/i, "");
    const info = this.keys.get(k);
    if (!info) return null;
    const ag = this.mesh.agents.get(info.addr);
    return { ...info, apiKey: k, balance: this.mesh.bal(info.addr), agent: ag };
  }

  agentsPublic() {
    return [...this.keys.values()].map((info) => {
      const ag = this.mesh.agents.get(info.addr);
      return {
        addr: info.addr,
        label: info.label,
        balance: this.mesh.bal(info.addr),
        stake: ag?.stake ?? 0,
        reputation: ag?.reputation ?? 0,
        credit: this.credit(info.addr),
      };
    });
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
      payerLabel: p.label,
      status: "open",
      ts: Date.now(),
    };
    if (this.mesh.bal(p.addr) < job.budget) {
      throw Object.assign(new Error("not enough COGNI to post this budget"), { status: 402 });
    }
    this.jobs.unshift(job);
    this.log("job", `${p.label} posted “${job.title}” for ${job.budget}`);
    return job;
  }

  takeJob(providerKey, jobId) {
    const pr = this.auth(providerKey);
    if (!pr) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || job.status !== "open") throw Object.assign(new Error("job gone"), { status: 404 });
    if (job.payer === pr.addr) throw Object.assign(new Error("cannot take your own job"), { status: 400 });
    const nonce = Date.now() + Math.random();
    const deposit = job.budget;
    if (this.mesh.bal(job.payer) < deposit) throw Object.assign(new Error("payer broke"), { status: 402 });
    const ch = this.mesh.openChannel(job.payer, pr.addr, deposit, nonce);
    const split = this.mesh.settle(ch, deposit);
    this.mesh.success(pr.addr);
    job.status = "settled";
    job.provider = pr.addr;
    job.providerLabel = pr.label;
    job.split = split;
    job.settledAt = Date.now();
    this.wall.unshift({
      q: job.title,
      burn: split.burn,
      tokens: job.workTokens,
      from: job.payerLabel,
      to: pr.label,
      ts: Date.now(),
    });
    this.wall = this.wall.slice(0, 40);
    this.log("settle", `${pr.label} earned ${split.provider} · burned ${split.burn}`);
    return { job, split, channel: ch, providerBalance: this.mesh.bal(pr.addr) };
  }

  faucet(header, amount = 250) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const amt = Math.min(1000, Math.max(10, Number(amount) || 250));
    this.mesh.transfer("faucet", me.addr, amt);
    this.log("faucet", `${me.label} +${amt} demo COGNI`);
    return { balance: this.mesh.bal(me.addr), toppedUp: amt };
  }

  challenge(header, { agentAddr, reason }) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const target = [...this.keys.values()].find((k) => k.addr === agentAddr);
    if (!target) throw Object.assign(new Error("unknown agent"), { status: 404 });
    const ag = this.mesh.agents.get(agentAddr);
    if (!ag) throw Object.assign(new Error("not registered"), { status: 404 });
    const take = this.mesh.slash(agentAddr, 50);
    const ch = {
      id: "ch_" + randomUUID().slice(0, 6),
      challenger: me.label,
      agent: target.label,
      agentAddr,
      reason: String(reason ?? "bad inference").slice(0, 120),
      slashed: take,
      ts: Date.now(),
    };
    this.challenges.unshift(ch);
    this.log("slash", `${me.label} slashed ${target.label} (−${take} stake)`);
    return ch;
  }

  flash(header, amount) {
    const me = this.auth(header);
    if (!me) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const amt = Number(amount) || 50;
    const fee = this.mesh.flash(me.addr, amt, (loan, feeAmt) => {
      // demo: job profit covers fee
      this.mesh.mintTo(me.addr, feeAmt + loan * 0.01);
    });
    this.log("flash", `${me.label} flash-borrowed ${amt} (fee ${fee})`);
    return { amount: amt, fee, balance: this.mesh.bal(me.addr), credit: this.credit(me.addr) };
  }

  stats() {
    return {
      agents: this.keys.size,
      jobs: this.jobs.length,
      burned: this.mesh.burned,
      supply: this.mesh.supply,
      treasury: this.mesh.bal("treasury"),
      openJobs: this.jobs.filter((j) => j.status === "open").length,
      settled: this.jobs.filter((j) => j.status === "settled").length,
      challenges: this.challenges.length,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      split: { provider: 70, treasury: 20, burn: 10 },
      flashFeeBps: 30,
    };
  }

  credit(addr) {
    const a = this.mesh.agents.get(addr);
    return a ? creditLimit(a.reputation, a.stake) : 0;
  }
}

export { splitStream, REPUTATION_SCALE, flashFee, TEMPLATES };
