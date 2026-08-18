import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

let server;
let base;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(() => server.close());

async function j(path, opts = {}) {
  const res = await fetch(base + path, opts);
  return { status: res.status, body: await res.json() };
}

describe("gateway", () => {
  it("health", async () => {
    const { body } = await j("/healthz");
    assert.equal(body.ok, true);
  });

  it("agent job settle burns", async () => {
    const a = await j("/api/agents", { method: "POST", body: JSON.stringify({ label: "payer" }) });
    const b = await j("/api/agents", { method: "POST", body: JSON.stringify({ label: "gpu" }) });
    const job = await j("/api/jobs", {
      method: "POST",
      headers: { authorization: "Bearer " + a.body.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ title: "embed docs", budget: 80, workTokens: 40 }),
    });
    assert.equal(job.status, 201);
    const take = await j("/api/jobs/" + job.body.id + "/take", {
      method: "POST",
      headers: { authorization: "Bearer " + b.body.apiKey },
    });
    assert.equal(take.status, 200);
    assert.equal(take.body.split.burn, 8);
    const stats = await j("/api/stats");
    assert.ok(stats.body.burned >= 8);
  });
});
