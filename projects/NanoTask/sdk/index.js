// @nanotask/sdk — zero-dep client for NanoTask Gateway (hardened)
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

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

export class NanoTaskClient {
  constructor({ baseUrl, apiKey, fetchImpl, timeoutMs = 8000, retries = 2 } = {}) {
    if (!baseUrl) throw new Error("baseUrl required");
    try { new URL(baseUrl); } catch { throw new Error("baseUrl must be valid URL"); }
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.apiKey = apiKey ?? null;
    this.fetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (!this.fetch) throw new Error("no fetch available — pass fetchImpl");
    this.timeoutMs = Math.min(30000, Math.max(1000, Number(timeoutMs) || 8000));
    this.retries = Math.min(5, Math.max(0, Number(retries) || 0));
  }

  authHeaders() {
    if (!this.apiKey) throw new NanoTaskError("no api key — call createAgent() or pass one", { status: 401 });
    return { authorization: "Bearer " + this.apiKey };
  }

  async _json(path, { method = "GET", body, auth = false, timeoutMs, retries } = {}) {
    const headers = { "content-type": "application/json" };
    if (auth) Object.assign(headers, this.authHeaders());
    const tm = timeoutMs ?? this.timeoutMs;
    const maxRetries = retries ?? this.retries;

    let attempt = 0;
    let lastErr;
    while (attempt <= maxRetries) {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), tm);
      try {
        const res = await this.fetch(this.baseUrl + path, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal,
        });
        clearTimeout(tid);
        let data = null;
        try { data = await res.json(); } catch {}
        if (!res.ok) {
          // retry only on 429/5xx
          if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            lastErr = new NanoTaskError(data?.error ?? `HTTP ${res.status}`, { status: res.status, body: data });
            await sleep(200 * Math.pow(2, attempt) + Math.random()*100);
            attempt++; continue;
          }
          throw new NanoTaskError(data?.error ?? `HTTP ${res.status}`, { status: res.status, body: data });
        }
        return data;
      } catch (e) {
        clearTimeout(tid);
        // abort error
        if (e.name === "AbortError") {
          lastErr = new NanoTaskError(`timeout after ${tm}ms`, { status: 408 });
        } else if (e instanceof NanoTaskError) {
          throw e;
        } else {
          lastErr = new NanoTaskError(String(e.message ?? e), { status: 0 });
        }
        if (attempt >= maxRetries) throw lastErr;
        // retry on network errors
        if (lastErr.status === 0 || lastErr.status === 408 || lastErr.status === 429 || lastErr.status >= 500) {
          await sleep(200 * Math.pow(2, attempt) + Math.random()*100);
          attempt++; continue;
        }
        throw lastErr;
      }
    }
    throw lastErr;
  }

  // agents
  async createAgent(label = "agent", { balance, stake } = {}) {
    if (typeof label !== "string" || label.trim().length === 0) throw new NanoTaskError("label required", { status: 400 });
    if (label.length > 32) throw new NanoTaskError("label max 32 chars", { status: 400 });
    if (!/^[a-zA-Z0-9._\- ]+$/.test(label)) throw new NanoTaskError("label: only alphanum ._- space", { status: 400 });
    const data = await this._json("/api/agents", { method: "POST", body: { label, balance, stake } });
    this.apiKey = data.apiKey;
    return data;
  }
  async me() { return this._json("/api/me", { auth: true }); }
  async faucet(amount = 250) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 10 || n > 1000) throw new NanoTaskError("faucet amount 10..1000", { status: 400 });
    return this._json("/api/faucet", { method: "POST", auth: true, body: { amount: n } });
  }
  async stake(amount = 20) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) throw new NanoTaskError("stake amount must be >0", { status: 400 });
    return this._json("/api/stake", { method: "POST", auth: true, body: { amount: n } });
  }
  async agents() { return this._json("/api/agents"); }

  // tasks
  async createTask({ input, inputHash, reward, timeout }) {
    if (reward != null) {
      const n = Number(reward);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) throw new NanoTaskError("reward must be positive integer", { status: 400 });
      if (n > 1_000_000) throw new NanoTaskError("reward too large", { status: 400 });
    }
    if (inputHash != null && !/^0x[0-9a-fA-F]{64}$/.test(inputHash)) throw new NanoTaskError("inputHash must be 0x + 64 hex", { status: 400 });
    return this._json("/api/tasks", { method: "POST", auth: true, body: { input, inputHash, reward, timeout } });
  }
  async listTasks({ limit, offset, status } = {}) { 
    const q = new URLSearchParams();
    if (limit != null) q.set("limit", String(limit));
    if (offset != null) q.set("offset", String(offset));
    if (status != null) q.set("status", String(status));
    const qs = q.toString() ? "?" + q.toString() : "";
    return this._json(`/api/tasks${qs}`);
  }
  async getTask(id) {
    if (!Number.isInteger(Number(id)) || Number(id) <= 0) throw new NanoTaskError("invalid task id", { status: 400 });
    return this._json(`/api/tasks/${id}`);
  }
  async submitResult(taskId, resultHash, signature) {
    if (resultHash != null && typeof resultHash !== "string") throw new NanoTaskError("resultHash must be string", { status: 400 });
    if (resultHash != null && !resultHash.startsWith("0x")) throw new NanoTaskError("resultHash must be 0x hex", { status: 400 });
    // legacy demo strings like "0xresult-sdk" are hashed server-side, so we allow any 0x string here
    return this._json(`/api/tasks/${taskId}/submit`, { method: "POST", auth: true, body: { resultHash, signature } });
  }
  async submitWithSig(taskId, { resultHash, worker, signature }) {
    if (!/^0x[0-9a-fA-F]{32,40}$/.test(worker)) throw new NanoTaskError("worker must be 0x hex 32-40", { status: 400 });
    return this._json(`/api/tasks/${taskId}/submitWithSig`, { method: "POST", auth: true, body: { resultHash, worker, signature } });
  }
  async approve(taskId) { return this._json(`/api/tasks/${taskId}/approve`, { method: "POST", auth: true }); }
  async claimTimeout(taskId) { return this._json(`/api/tasks/${taskId}/claim`, { method: "POST", auth: true }); }
  async challenge(taskId, reason="spam") { return this._json(`/api/tasks/${taskId}/challenge`, { method: "POST", auth: true, body: { reason: String(reason).slice(0,120) } }); }
  async cancel(taskId) { return this._json(`/api/tasks/${taskId}/cancel`, { method: "POST", auth: true }); }

  async stats() { return this._json("/api/stats"); }
  async wall() { return this._json("/api/wall"); }
  async events() { return this._json("/api/events"); }

  // presence pool — WAIT mode
  async heartbeat() { return this._json("/api/presence/heartbeat", { method:"POST", auth:true }); }
  async setCapabilities(caps) { return this._json("/api/presence/capabilities", { method:"POST", auth:true, body:{ capabilities: caps } }); }
  async pool() { return this._json("/api/presence/pool"); }
  async waitForWork({ capabilities, timeout }={}) { return this._json("/api/presence/wait", { method:"POST", auth:true, body:{ capabilities } }); }
}

export async function connect(baseUrl, { label = "agent", apiKey } = {}) {
  const c = new NanoTaskClient({ baseUrl, apiKey });
  if (!apiKey) await c.createAgent(label);
  return c;
}

// convenience for common agent loop
export async function runTaskLoop(client, taskId, doWork) {
  const resultHash = await doWork();
  if (!/^0x[0-9a-fA-F]{64}$/.test(resultHash)) throw new Error("doWork must return 0x 64 hex");
  await client.submitResult(taskId, resultHash);
  return resultHash;
}
