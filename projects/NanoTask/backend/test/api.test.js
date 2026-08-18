import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

async function fetchJson(app, path, opts = {}) {
  // use internal server injection via direct gateway? we use http fetch against live server
  // Instead test gateway directly via createApp's gw property
  const gw = app.gw;
  // helper to simulate API by calling gw directly, but we test http layer via fetch to localhost
  return gw;
}

describe("NanoTask Gateway API", () => {
  let app, gw;
  let clientKey, workerKey, clientAddr, workerAddr;

  before(() => {
    app = createApp();
    gw = app.gw;
    // create two agents
    const c = gw.createAgent("client-a", { balance: 1000, stake: 60 });
    const w = gw.createAgent("worker-b", { balance: 500, stake: 80 });
    clientKey = c.apiKey; workerKey = w.apiKey;
    clientAddr = c.addr; workerAddr = w.addr;
  });

  it("health stats", () => {
    const s = gw.stats();
    assert.ok(s.supply > 0);
    assert.ok(s.agents >= 2);
  });

  it("create task freezes funds", () => {
    const balBefore = gw.state.bal(clientAddr);
    const escrowBefore = gw.state.bal("escrow");
    const t = gw.createTask(`Bearer ${clientKey}`, { input: "test task", reward: 120, timeout: 30 });
    assert.equal(t.reward, 120);
    assert.equal(t.status, 0);
    assert.equal(gw.state.bal(clientAddr), balBefore - 120);
    assert.equal(gw.state.bal("escrow"), escrowBefore + 120);
  });

  it("worker submits result (stake required)", () => {
    const t = gw.tasksPublic().find(x=>x.status===0);
    assert.ok(t);
    const sub = gw.submitResult(`Bearer ${workerKey}`, t.id, "0xdeadbeef"+t.id);
    assert.equal(sub.status, 1);
    assert.equal(sub.worker, workerAddr);
  });

  it("client approves → split 98/1/1", () => {
    const t = gw.tasksPublic().find(x=>x.status===1);
    assert.ok(t);
    const expectedBurn = Math.floor(t.reward * 0.01);
    const expectedWorker = t.reward - expectedBurn*2;
    const workerBalBefore = gw.state.bal(workerAddr);
    const burnedBefore = gw.state.burned;
    gw.approve(`Bearer ${clientKey}`, t.id);
    const after = gw.state.getTask(t.id);
    assert.equal(after.status, 2);
    assert.equal(after.split.burn, expectedBurn);
    assert.equal(after.split.treasury, expectedBurn);
    assert.equal(after.split.worker, expectedWorker);
    assert.equal(gw.state.burned, burnedBefore + expectedBurn);
    assert.ok(gw.state.bal(workerAddr) > workerBalBefore);
  });

  it("optimistic claim after timeout", async () => {
    const t = gw.createTask(`Bearer ${clientKey}`, { input: "timeout job", reward: 80, timeout: 0.02 });
    gw.submitResult(`Bearer ${workerKey}`, t.id, "0xresult-timeout");
    // immediate claim fails
    assert.throws(()=> gw.claimTimeout(`Bearer ${workerKey}`, t.id), /timeout not reached/);
    await new Promise(r=>setTimeout(r, 40));
    const claimed = gw.claimTimeout(`Bearer ${workerKey}`, t.id);
    assert.equal(claimed.status, 2);
  });

  it("challenge slashes bad worker", () => {
    const t = gw.createTask(`Bearer ${clientKey}`, { input: "spam job", reward: 60, timeout: 60 });
    gw.submitResult(`Bearer ${workerKey}`, t.id, "0xbad");
    const stakeBefore = gw.state.stakes.get(workerAddr);
    const burnedBefore = gw.state.burned;
    const { slashed, task } = gw.challenge(`Bearer ${clientKey}`, t.id, "garbage");
    assert.ok(slashed > 0);
    assert.equal(task.status, 3);
    assert.ok(gw.state.burned >= burnedBefore);
    assert.equal(gw.state.stakes.get(workerAddr), stakeBefore - slashed);
    // reward refunded
    assert.ok(gw.state.bal(clientAddr) > 0);
  });

  it("cancel open task after timeout", async () => {
    const t = gw.createTask(`Bearer ${clientKey}`, { input: "cancel me", reward: 50, timeout: 0.02 });
    const balBefore = gw.state.bal(clientAddr);
    // cannot cancel before timeout
    assert.throws(()=> gw.cancel(`Bearer ${clientKey}`, t.id), /timeout not expired/);
    await new Promise(r=>setTimeout(r, 40));
    gw.cancel(`Bearer ${clientKey}`, t.id);
    assert.equal(gw.state.getTask(t.id).status, 4);
    assert.equal(gw.state.bal(clientAddr), balBefore + 50); // refunded? actually balBefore is after freeze, so should be +50 vs after freeze
  });

  it("faucet and stake", () => {
    const before = gw.state.bal(clientAddr);
    gw.faucet(`Bearer ${clientKey}`, 100);
    assert.equal(gw.state.bal(clientAddr), before + 100);
    const stakeBefore = gw.state.stakes.get(clientAddr) ?? 0;
    gw.stakeMore(`Bearer ${clientKey}`, 20);
    assert.equal(gw.state.stakes.get(clientAddr), stakeBefore + 20);
  });

  it("gasless submitWithSig", () => {
    // use fresh worker to avoid slashed stake
    const fresh = gw.createAgent("fresh-worker", { balance: 500, stake: 60 });
    const t = gw.createTask(`Bearer ${clientKey}`, { input: "gasless", reward: 70, timeout: 60 });
    const res = gw.submitWithSig(`Bearer ${clientKey}`, t.id, { resultHash: "0xgaslesshash", worker: fresh.addr, signature: "0xab".repeat(32) });
    assert.equal(res.worker, fresh.addr);
  });

  it("stats consistency", () => {
    const s = gw.stats();
    assert.equal(s.totalTasks, gw.state.tasks.size);
    assert.ok(s.supply + s.burned <= 1_000_000_000 + 100000); // mint fudge
  });
});

describe("HTTP layer", () => {
  let server, base;
  before(async () => {
    const { createApp } = await import("../src/app.js");
    server = createApp();
    await new Promise(res => server.listen(0, "127.0.0.1", res));
    const addr = server.address();
    base = `http://127.0.0.1:${addr.port}`;
  });
  it("GET /healthz and POST /api/agents via http", async () => {
    const h = await fetch(base + "/healthz").then(r=>r.json());
    assert.equal(h.ok, true);
    const ag = await fetch(base + "/api/agents", { method:"POST", headers:{ "content-type":"application/json"}, body: JSON.stringify({label:"http-test"}) }).then(r=>r.json());
    assert.ok(ag.apiKey);
    const me = await fetch(base + "/api/me", { headers:{ authorization:"Bearer "+ag.apiKey }}).then(r=>r.json());
    assert.equal(me.label, "http-test");
    server.close();
  });
});
