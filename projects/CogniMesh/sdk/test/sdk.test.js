import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../backend/src/app.js";
import { connect } from "../index.js";

let server, base;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

describe("sdk", () => {
  it("spawn and stats", async () => {
    const c = connect(base);
    const a = await c.spawn("sdk");
    assert.ok(a.apiKey.startsWith("cm_"));
    const s = await connect(base, a.apiKey).stats();
    assert.ok(s.agents >= 1);
  });
});
