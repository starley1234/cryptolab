import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NanoTaskState, splitReward, STATUS, MIN_STAKE, hashInput } from "../lib/protocol.js";

describe("splitReward 98/1/1", () => {
  it("sums to reward, burn 1% treasury 1%", () => {
    const s = splitReward(1000);
    assert.equal(s.worker + s.burn + s.treasury, 1000);
    assert.equal(s.burn, 10);
    assert.equal(s.treasury, 10);
    assert.equal(s.worker, 980);
  });
  it("no dust loss on uneven reward", () => {
    const s = splitReward(101);
    assert.equal(s.worker + s.burn + s.treasury, 101);
  });
});

describe("stake", () => {
  it("requires min stake to submit", () => {
    const st = new NanoTaskState();
    st.mintTo("client", 1000);
    st.mintTo("worker", 100);
    st.stake("worker", 50);
    const t = st.createTask("client", { reward: 100, inputHash: hashInput("a") });
    // worker has exactly min stake -> can submit
    st.submitResult("worker", t.id, hashInput("res"));
    assert.equal(t.status, STATUS.SUBMITTED);
  });
  it("rejects if stake < min", () => {
    const st = new NanoTaskState();
    st.mintTo("c", 1000); st.mintTo("w", 1000);
    st.stake("w", 20); // below min 50, but construct should still allow low stake? actually our stake allows any, but submit checks >=50
    const t = st.createTask("c", { reward: 50, inputHash: hashInput("x") });
    assert.throws(() => st.submitResult("w", t.id, hashInput("r")), /stake/);
  });
});

describe("happy path: create → submit → approve", () => {
  it("settles with 98/1/1 split", () => {
    const st = new NanoTaskState();
    st.mintTo("alice", 1000); st.mintTo("bob", 500);
    st.stake("bob", 60);
    const t = st.createTask("alice", { reward: 200, inputHash: hashInput("work1") });
    assert.equal(st.bal("escrow"), 200);
    st.submitResult("bob", t.id, hashInput("done"));
    st.approve("alice", t.id);
    assert.equal(t.status, STATUS.SETTLED);
    assert.equal(t.split.worker, 196);
    assert.equal(t.split.burn, 2);
    assert.equal(t.split.treasury, 2);
    assert.equal(st.bal("bob"), 500 - 60 + 196);
    assert.equal(st.burned, 2);
    assert.equal(st.supply, 1_000_000_000 - 2);
    assert.equal(st.bal("escrow"), 0);
  });
});

describe("optimistic timeout: claimTimeout", () => {
  it("worker claims after timeout without client", async () => {
    const st = new NanoTaskState();
    st.mintTo("c", 500); st.mintTo("w", 500);
    st.stake("w", 50);
    const t = st.createTask("c", { reward: 100, timeoutSec: 0.02, inputHash: hashInput("t") });
    st.submitResult("w", t.id, hashInput("r"));
    // too early
    assert.throws(() => st.claimTimeout("w", t.id), /timeout not reached/);
    await new Promise(r => setTimeout(r, 40));
    const settled = st.claimTimeout("w", t.id);
    assert.equal(settled.status, STATUS.SETTLED);
    assert.equal(st.bal("w") - (500-50), 98); // worker got 98 (stake 50 separate)
  });
  it("approve before timeout still works", () => {
    const st = new NanoTaskState();
    st.mintTo("c", 500); st.mintTo("w", 500);
    st.stake("w", 50);
    const t = st.createTask("c", { reward: 100, inputHash: hashInput("q") });
    st.submitResult("w", t.id, hashInput("r2"));
    st.approve("c", t.id);
    assert.equal(t.status, STATUS.SETTLED);
  });
});

describe("challenge / slash", () => {
  it("client slashes bad worker, gets refund, stake burned", () => {
    const st = new NanoTaskState();
    st.mintTo("client", 1000); st.mintTo("worker", 200);
    st.stake("worker", 60);
    const stakeBefore = st.stakes.get("worker");
    const t = st.createTask("client", { reward: 150, inputHash: hashInput("bad") });
    st.submitResult("worker", t.id, hashInput("garbage"));
    const balClientBefore = st.bal("client");
    const { slashed } = st.challenge("client", t.id, "spam");
    assert.ok(slashed > 0);
    assert.equal(t.status, STATUS.SLASHED);
    assert.equal(st.bal("client"), balClientBefore + 150 + (slashed - Math.floor(slashed/2))); // refund + slash compensation
    assert.equal(st.stakes.get("worker"), stakeBefore - slashed);
    assert.ok(st.burned > 0);
  });
  it("only client can challenge", () => {
    const st = new NanoTaskState();
    st.mintTo("c", 500); st.mintTo("w", 500); st.mintTo("other", 500);
    st.stake("w", 50);
    const t = st.createTask("c", { reward: 50, inputHash: hashInput("x") });
    st.submitResult("w", t.id, hashInput("r"));
    assert.throws(() => st.challenge("other", t.id), /not client/);
  });
});

describe("cancel", () => {
  it("client cancels open task after timeout, refund", async () => {
    const st = new NanoTaskState();
    st.mintTo("c", 500); st.mintTo("w", 500);
    const t = st.createTask("c", { reward: 80, timeoutSec: 0.02, inputHash: hashInput("cancel-t") });
    await new Promise(r => setTimeout(r, 40));
    st.cancel("c", t.id);
    assert.equal(t.status, STATUS.CANCELLED);
    assert.equal(st.bal("c"), 500); // refunded full
  });
  it("cannot cancel submitted task", () => {
    const st = new NanoTaskState();
    st.mintTo("c", 500); st.mintTo("w", 500);
    st.stake("w", 50);
    const t = st.createTask("c", { reward: 80, inputHash: hashInput("y") });
    st.submitResult("w", t.id, hashInput("r"));
    assert.throws(() => st.cancel("c", t.id), /not open/);
  });
});

describe("EIP-712 gasless", () => {
  it("submitWithSig via relayer", () => {
    const st = new NanoTaskState();
    st.mintTo("client", 500); st.mintTo("worker", 500);
    st.stake("worker", 50);
    const t = st.createTask("client", { reward: 90, inputHash: hashInput("712") });
    // worker signs off-chain, relayer submits
    const fakeSig = { signature: "0x" + "ab".repeat(65) };
    st.submitResultWithSig(t.id, hashInput("result712"), "worker", fakeSig);
    assert.equal(t.worker, "worker");
    assert.equal(t.status, STATUS.SUBMITTED);
  });
});

describe("invariants", () => {
  it("escrow accounting: in-flight vs supply", () => {
    const st = new NanoTaskState();
    st.mintTo("a", 10000); st.mintTo("b", 1000); st.mintTo("c", 1000);
    st.stake("b", 50); st.stake("c", 50);
    const t1 = st.createTask("a", { reward: 500, inputHash: hashInput("1") });
    const t2 = st.createTask("a", { reward: 300, inputHash: hashInput("2") });
    assert.equal(st.bal("escrow"), 800);
    assert.equal(st.stats().inFlight, 2);
    st.submitResult("b", t1.id, hashInput("r1"));
    st.approve("a", t1.id);
    assert.equal(st.bal("escrow"), 300);
    assert.equal(st.stats().inFlight, 1);
    assert.equal(st.stats().settled, 1);
    // total tokens conserved: supply + burned == initial supply + mints? check no leak
    const totalBal = [...st.balances.values()].reduce((a,b)=>a+b,0);
    // escrow:stake + escrow + balances should equal supply + burned offset? simple sanity
    assert.ok(totalBal + st.burned <= 1_000_000_000 + 10000 + 2000);
  });
});
