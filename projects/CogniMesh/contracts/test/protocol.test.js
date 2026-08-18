import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MeshState,
  splitStream,
  flashFee,
  creditLimit,
  MAX_SUPPLY,
  REPUTATION_SCALE,
} from "../lib/protocol.js";

describe("splitStream 70/20/10", () => {
  it("sums to amount", () => {
    const s = splitStream(1000);
    assert.equal(s.provider + s.treasury + s.burn, 1000);
    assert.equal(s.provider, 700);
    assert.equal(s.treasury, 200);
    assert.equal(s.burn, 100);
  });
});

describe("registry + channels", () => {
  it("register, stream, burn", () => {
    const m = new MeshState();
    m.mintTo("alice", 10_000);
    m.mintTo("bob", 0);
    m.register("alice", 500);
    assert.equal(m.agents.get("alice").reputation, REPUTATION_SCALE);
    const id = m.openChannel("alice", "bob", 1000, 1);
    const s = m.settle(id, 400);
    assert.equal(s.burn, 40);
    assert.equal(m.bal("bob"), 280);
    assert.ok(m.supply < MAX_SUPPLY + 10_000);
  });

  it("rejects over-settle", () => {
    const m = new MeshState();
    m.mintTo("a", 1000);
    m.openChannel("a", "b", 100, 1);
    assert.throws(() => m.settle("a:b:1", 101));
  });
});

describe("slash + flash", () => {
  it("slash reduces stake and supply", () => {
    const m = new MeshState();
    m.mintTo("gpu", 1000);
    m.register("gpu", 200);
    const before = m.supply;
    m.slash("gpu", 50);
    assert.equal(m.agents.get("gpu").stake, 150);
    assert.ok(m.supply < before);
  });

  it("flash respects credit limit", () => {
    const m = new MeshState();
    m.mintTo("bot", 1000);
    m.register("bot", 200);
    const limit = creditLimit(REPUTATION_SCALE, 200);
    assert.equal(limit, 200);
    assert.throws(() => m.flash("bot", 201, () => {}));
    m.flash("bot", 100, (amt, fee) => {
      // simulate profit
      m.mintTo("bot", fee + 1);
    });
    assert.ok(m.burned > 0);
  });

  it("flash fee is 30 bps", () => {
    assert.equal(flashFee(10_000), 30);
  });
});
