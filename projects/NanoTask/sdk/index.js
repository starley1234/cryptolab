// @nanotask/sdk — zero-dep client for NanoTask Gateway
//   import { NanoTaskClient, connect } from "@nanotask/sdk"
//   const nt = await connect("http://localhost:8788", { label: "my-agent" })
//   const task = await nt.createTask({ input: "do work", reward: 100 })
//   await nt.submitResult(task.id, "0x...resultHash")

export class NanoTaskError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "NanoTaskError";
    this.status = status;
    this.body = body;
  }
}

export class NanoTaskClient {
  constructor({ baseUrl, apiKey, fetchImpl } = {}) {
    if (!baseUrl) throw new Error("baseUrl required");
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.apiKey = apiKey ?? null;
    this.fetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (!this.fetch) throw new Error("no fetch available — pass fetchImpl");
  }

  authHeaders() {
    if (!this.apiKey) throw new NanoTaskError("no api key — call createAgent() or pass one", { status: 401 });
    return { authorization: "Bearer " + this.apiKey };
  }

  async _json(path, { method = "GET", body, auth = false } = {}) {
    const headers = { "content-type": "application/json" };
    if (auth) Object.assign(headers, this.authHeaders());
    const res = await this.fetch(this.baseUrl + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new NanoTaskError(data?.error ?? `HTTP ${res.status}`, { status: res.status, body: data });
    return data;
  }

  // agents
  async createAgent(label = "agent", { balance, stake } = {}) {
    const data = await this._json("/api/agents", { method: "POST", body: { label, balance, stake } });
    this.apiKey = data.apiKey;
    return data;
  }
  async me() { return this._json("/api/me", { auth: true }); }
  async faucet(amount = 250) { return this._json("/api/faucet", { method: "POST", auth: true, body: { amount } }); }
  async stake(amount = 20) { return this._json("/api/stake", { method: "POST", auth: true, body: { amount } }); }
  async agents() { return this._json("/api/agents"); }

  // tasks
  async createTask({ input, inputHash, reward, timeout }) {
    return this._json("/api/tasks", { method: "POST", auth: true, body: { input, inputHash, reward, timeout } });
  }
  async listTasks() { return this._json("/api/tasks"); }
  async getTask(id) { return this._json(`/api/tasks/${id}`); }
  async submitResult(taskId, resultHash, signature) {
    return this._json(`/api/tasks/${taskId}/submit`, { method: "POST", auth: true, body: { resultHash, signature } });
  }
  // gasless: relay signatures from worker
  async submitWithSig(taskId, { resultHash, worker, signature }) {
    return this._json(`/api/tasks/${taskId}/submitWithSig`, { method: "POST", auth: true, body: { resultHash, worker, signature } });
  }
  async approve(taskId) { return this._json(`/api/tasks/${taskId}/approve`, { method: "POST", auth: true }); }
  async claimTimeout(taskId) { return this._json(`/api/tasks/${taskId}/claim`, { method: "POST", auth: true }); }
  async challenge(taskId, reason="spam") { return this._json(`/api/tasks/${taskId}/challenge`, { method: "POST", auth: true, body: { reason } }); }
  async cancel(taskId) { return this._json(`/api/tasks/${taskId}/cancel`, { method: "POST", auth: true }); }

  async stats() { return this._json("/api/stats"); }
  async wall() { return this._json("/api/wall"); }
  async events() { return this._json("/api/events"); }
}

export async function connect(baseUrl, { label = "agent", apiKey } = {}) {
  const c = new NanoTaskClient({ baseUrl, apiKey });
  if (!apiKey) await c.createAgent(label);
  return c;
}

// convenience for common agent loop
export async function runTaskLoop(client, taskId, doWork) {
  // doWork: () => resultHash
  const resultHash = await doWork();
  await client.submitResult(taskId, resultHash);
  return resultHash;
}
