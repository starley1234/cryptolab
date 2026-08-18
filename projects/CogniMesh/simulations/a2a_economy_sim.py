#!/usr/bin/env python3
"""Monte-Carlo A2A economy: streams, slash, flash, burn."""

from __future__ import annotations

import random


def split_stream(amount: float):
    p, t = amount * 0.7, amount * 0.2
    return p, t, amount - p - t


def run(steps: int = 2000, agents: int = 40, seed: int = 7) -> dict:
    rng = random.Random(seed)
    stake = {i: 200.0 for i in range(agents)}
    rep = {i: 1_000_000.0 for i in range(agents)}
    bal = {i: 1000.0 for i in range(agents)}
    supply = 1_000_000_000.0
    burned = 0.0
    slashed = 0
    flashes = 0

    for _ in range(steps):
        a, b = rng.randrange(agents), rng.randrange(agents)
        if a == b:
            continue
        budget = rng.uniform(5, 40)
        if bal[a] < budget:
            continue
        # 8% chance of bad work
        if rng.random() < 0.08:
            take = min(stake[b], 50)
            stake[b] -= take
            burned += take * 0.5
            supply -= take * 0.5
            slashed += 1
            rep[b] = max(1, rep[b] - 50_000)
            continue
        bal[a] -= budget
        p, t, burn = split_stream(budget)
        bal[b] += p
        burned += burn
        supply -= burn
        rep[b] = min(10_000_000, rep[b] + 1000)
        if rng.random() < 0.05:
            limit = rep[b] * stake[b] / 1_000_000
            amt = min(limit, 80)
            fee = amt * 0.003
            burned += fee / 2
            supply -= fee / 2
            flashes += 1

    return {
        "steps": steps,
        "burned": round(burned, 4),
        "supply": supply,
        "slashed": slashed,
        "flashes": flashes,
        "avg_rep": sum(rep.values()) / agents,
        "avg_stake": sum(stake.values()) / agents,
    }


if __name__ == "__main__":
    out = run()
    print("CogniMesh A2A sim")
    for k, v in out.items():
        print(f"  {k}: {v}")
    assert out["burned"] > 0
    assert out["supply"] < 1_000_000_000
