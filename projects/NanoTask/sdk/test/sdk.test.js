import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../backend/src/app.js";
import { NanoTaskClient } from "../index.js";

describe("NanoTask SDK", () => {
  let base, server;
  before(async () => {
    const app = createApp();
    await new Promise(r => server = app.listen(0, "127.0.0.1", r));
    const addr = server.address();
    base = `http://127.0.0.1:${addr.port}`;
  });

  it("client lifecycle: create agent, task, submit, approve", async () => {
    const client = new NanoTaskClient({ baseUrl: base });
    const ca = await client.createAgent("sdk-client");
    assert.ok(ca.apiKey);
    const worker = new NanoTaskClient({ baseUrl: base });
    await worker.createAgent("sdk-worker");

    const task = await client.createTask({ input: "sdk task", reward: 100, timeout: 40 });
    assert.equal(task.reward, 100);
    const sub = await worker.submitResult(task.id, "0xresult-sdk");
    assert.equal(sub.status, 1);
    const settled = await client.approve(task.id);
    assert.equal(settled.status, 2);
    assert.ok(settled.split.worker === 98);
    assert.ok(settled.split.burn === 1);
  });

  it("optimistic claim", async () => {
    const c = new NanoTaskClient({ baseUrl: base });
    await c.createAgent("c2");
    const w = new NanoTaskClient({ baseUrl: base });
    await w.createAgent("w2");
    const t = await c.createTask({ input: "timeout sdk", reward: 60, timeout: 0.02 });
    await w.submitResult(t.id, "0xrs");
    await new Promise(r=>setTimeout(r, 40));
    const claimed = await w.claimTimeout(t.id);
    assert.equal(claimed.status, 2);
  });

  it("challenge flow via SDK", async () => {
    const c = new NanoTaskClient({ baseUrl: base });
    await c.createAgent("c3");
    const w = new NanoTaskClient({ baseUrl: base });
    await w.createAgent("w3");
    const t = await c.createTask({ input: "bad sdk", reward: 50 });
    await w.submitResult(t.id, "0xbadbad");
    const ch = await c.challenge(t.id, "spam");
    assert.ok(ch.slashed >= 0);
    assert.equal(ch.task.status, 3);
  });

  it("connect helper", async () => {
    const { connect } = await import("../index.js");
    const cli = await connect(base, { label: "helper" });
    assert.ok(cli.apiKey);
    const s = await cli.stats();
    assert.ok(s.supply > 0);
  });
});
