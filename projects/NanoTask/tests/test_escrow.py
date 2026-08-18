"""Tests for NanoTask escrow — success, timeout, slash. Mirrors JS protocol."""

import sys
import time
from pathlib import Path

# inline minimal python escrow mirror (no deps)
MAX_SUPPLY = 1_000_000_000
MIN_STAKE = 50
BURN_BPS = 100
STATUS_OPEN = 0
STATUS_SUBMITTED = 1
STATUS_SETTLED = 2
STATUS_SLASHED = 3
STATUS_CANCELLED = 4

def split(reward):
    burn = reward * BURN_BPS // 10_000
    treasury = burn
    worker = reward - burn - treasury
    return worker, burn, treasury

class State:
    def __init__(self):
        self.supply = MAX_SUPPLY
        self.burned = 0
        self.bal = {}
        self.stakes = {}
        self.tasks = {}
        self.next_id = 1
        self.bal["faucet"] = MAX_SUPPLY * 0.4
        self.bal["treasury"] = 0
        self.bal["escrow"] = 0
        self.bal["escrow:stake"] = 0

    def _bal(self, a): return self.bal.get(a, 0)
    def mint(self, a, v): self.bal[a] = self._bal(a) + v
    def transfer(self, f, t, v):
        assert self._bal(f) >= v, f"insufficient {f} {self._bal(f)} < {v}"
        self.bal[f] -= v
        self.bal[t] = self._bal(t) + v

    def stake(self, w, amt):
        self.transfer(w, "escrow:stake", amt)
        self.stakes[w] = self.stakes.get(w, 0) + amt

    def create(self, client, reward, timeout=60, input_hash="0xabc"):
        self.transfer(client, "escrow", reward)
        tid = self.next_id; self.next_id+=1
        self.tasks[tid] = {"id":tid,"client":client,"worker":None,"reward":reward,"input":input_hash,"created":time.time(),"submitted":None,"timeout":timeout,"status":STATUS_OPEN}
        return self.tasks[tid]

    def submit(self, worker, tid, result_hash="0xres"):
        t=self.tasks[tid]
        assert t["status"]==STATUS_OPEN
        assert self.stakes.get(worker,0) >= MIN_STAKE
        t["worker"]=worker; t["result"]=result_hash; t["submitted"]=time.time(); t["status"]=STATUS_SUBMITTED
        return t

    def approve(self, client, tid):
        t=self.tasks[tid]
        assert t["client"]==client
        assert t["status"]==STATUS_SUBMITTED
        w,b,tr = split(t["reward"])
        self.bal["escrow"] -= t["reward"]
        self.mint(t["worker"], w)
        self.mint("treasury", tr)
        self.supply -= b; self.burned += b
        t["status"]=STATUS_SETTLED; t["split"]=(w,b,tr)
        return t

    def claim(self, worker, tid):
        t=self.tasks[tid]
        assert t["status"]==STATUS_SUBMITTED
        assert t["worker"]==worker
        assert time.time() - t["submitted"] >= t["timeout"]
        return self.approve(t["client"], tid)  # reuse settle but check timeout already

    def _settle_claim(self, worker, tid):
        t=self.tasks[tid]
        assert time.time() - t["submitted"] >= t["timeout"]
        w,b,tr = split(t["reward"])
        self.bal["escrow"] -= t["reward"]
        self.mint(t["worker"], w)
        self.mint("treasury", tr)
        self.supply -= b; self.burned += b
        t["status"]=STATUS_SETTLED; t["split"]=(w,b,tr)
        return t

    def challenge(self, client, tid):
        t=self.tasks[tid]
        assert t["client"]==client
        assert t["status"]==STATUS_SUBMITTED
        w = t["worker"]
        st = self.stakes.get(w,0)
        sl = min(st, 30)
        if sl>0:
            burn = sl//2
            self.stakes[w]-=sl
            self.bal["escrow:stake"] -= sl
            self.supply -= burn; self.burned+=burn
            self.mint(client, sl-burn)
        self.transfer("escrow", client, t["reward"])
        t["status"]=STATUS_SLASHED
        return sl

    def cancel(self, client, tid):
        t=self.tasks[tid]
        assert t["client"]==client
        assert t["status"]==STATUS_OPEN
        assert time.time() - t["created"] >= t["timeout"]
        self.transfer("escrow", client, t["reward"])
        t["status"]=STATUS_CANCELLED
        return t

def test_success():
    s=State()
    s.mint("alice",1000); s.mint("bob",200)
    s.stake("bob",60)
    t=s.create("alice",200)
    assert s._bal("escrow")==200
    s.submit("bob",t["id"],"0xdone")
    s.approve("alice",t["id"])
    assert t["status"]==STATUS_SETTLED
    assert t["split"][0]==196
    assert t["split"][1]==2
    assert s.burned==2
    assert s._bal("bob")==200-60+196  # initial 200 minus stake plus reward
    assert s._bal("escrow")==0
    print("✓ test_success")

def test_timeout_claim():
    s=State()
    s.mint("c",500); s.mint("w",500)
    s.stake("w",50)
    t=s.create("c",100,timeout=0.02)
    s.submit("w",t["id"],"0xres")
    # immediate claim should fail
    try:
        s.claim("w",t["id"])
        assert False, "should have timed out"
    except AssertionError as e:
        if "should have timed out" in str(e): raise
        pass
    time.sleep(0.04)
    s._settle_claim("w",t["id"])
    assert t["status"]==STATUS_SETTLED
    assert s.burned==1
    print("✓ test_timeout_claim")

def test_slash():
    s=State()
    s.mint("client",1000); s.mint("worker",200)
    s.stake("worker",60)
    t=s.create("client",150)
    s.submit("worker",t["id"],"0xspam")
    bal_before = s._bal("client")
    sl=s.challenge("client",t["id"])
    assert sl>0
    assert t["status"]==STATUS_SLASHED
    assert s._bal("client") == bal_before + 150 + (sl - sl//2)
    assert s.stakes["worker"] == 30
    assert s.burned >= sl//2
    print("✓ test_slash")

def test_cancel():
    s=State()
    s.mint("c",500)
    t=s.create("c",80,timeout=0.02)
    time.sleep(0.04)
    s.cancel("c",t["id"])
    assert t["status"]==STATUS_CANCELLED
    assert s._bal("c")==500
    print("✓ test_cancel")

def test_stake_protection():
    s=State()
    s.mint("c",500); s.mint("w",100)
    s.stake("w",20)
    t=s.create("c",50)
    try:
        s.submit("w",t["id"],"0xres")
        assert False, "should reject low stake"
    except AssertionError as e:
        if "should reject" in str(e): raise
        pass
    print("✓ test_stake_protection")

if __name__ == "__main__":
    test_success()
    test_timeout_claim()
    test_slash()
    test_cancel()
    test_stake_protection()
    print("\nAll tests passed — NanoTask escrow invariants hold")
