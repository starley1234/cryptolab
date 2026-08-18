#!/usr/bin/env python3
"""NanoTask burn_sim — дефляция при росте числа агентов.

Моделирует velocity sink: каждая задача замораживает reward в эскроу,
1% сжигается, 1% в казну, 98% воркеру. При росте агентов/задач
supply падает, in-flight растёт.
"""

from __future__ import annotations
import random
import math

FEE_BPS = 200
BURN_BPS = 100  # 1%
MAX_SUPPLY = 1_000_000_000


def split(reward: float):
    burn = reward * BURN_BPS / 10_000
    treasury = burn
    worker = reward - burn - treasury
    return worker, burn, treasury


def simulate(num_agents: int = 100, tasks_per_agent: int = 20, avg_reward: float = 100, bad_rate: float = 0.05, seed: int = 42):
    rng = random.Random(seed)
    supply = float(MAX_SUPPLY)
    burned = 0.0
    treasury = 0.0
    in_flight_peak = 0
    in_flight = 0
    settled = 0
    slashed = 0

    # each agent does tasks
    for _ in range(num_agents * tasks_per_agent):
        reward = rng.uniform(avg_reward * 0.5, avg_reward * 1.5)
        # optimism: 95% approve, 3% timeout claim, bad_rate challenge
        in_flight += 1
        in_flight_peak = max(in_flight_peak, in_flight)
        # simulate outcome after short delay
        if rng.random() < bad_rate:
            # challenge: slash ~37 TASK, refund reward
            slash = 37.5
            burn_slash = slash / 2
            burned += burn_slash
            supply -= burn_slash
            slashed += 1
            # reward refunded, not burned
            in_flight -= 1
            continue
        # normal settle
        w, b, tr = split(reward)
        burned += b
        supply -= b
        treasury += tr
        settled += 1
        in_flight -= 1

    return {
        "agents": num_agents,
        "tasks": num_agents * tasks_per_agent,
        "settled": settled,
        "slashed": slashed,
        "burned": round(burned, 2),
        "treasury": round(treasury, 2),
        "supply": round(supply, 2),
        "burn_pct": round(burned / MAX_SUPPLY * 100, 4),
        "in_flight_peak": in_flight_peak,
        "avg_burn_per_task": round(burned / max(1, settled), 4),
    }


def run_sweep():
    print("NanoTask — burn & velocity sink simulation")
    print("=" * 64)
    print(f"MAX_SUPPLY {MAX_SUPPLY:,}  fee 2% -> burn 1% treasury 1% worker 98%")
    print()
    header = f"{'agents':>8} {'tasks':>8} {'burned':>10} {'supply':>12} {'burn%':>7} {'peakFlight':>10}"
    print(header)
    print("-" * len(header))
    for agents in [10, 50, 100, 500, 1000, 5000]:
        r = simulate(num_agents=agents, tasks_per_agent=10, avg_reward=100)
        print(f"{r['agents']:8d} {r['tasks']:8d} {r['burned']:10.1f} {r['supply']:12.1f} {r['burn_pct']:7.4f} {r['in_flight_peak']:10d}")
    print()
    # detailed one
    r = simulate(num_agents=200, tasks_per_agent=50, avg_reward=80, seed=7)
    print("Detailed (200 agents x 50 tasks, avg 80 TASK):")
    for k, v in r.items():
        print(f"  {k}: {v}")
    # invariant
    assert r["burned"] > 0
    assert r["supply"] < MAX_SUPPLY
    assert r["burn_pct"] > 0

    # deflation projection
    print()
    print("Projection: if 1M tasks/day @ avg 50 TASK → daily burn =", round(1_000_000 * 50 * 0.01, 1), "TASK/day")
    print("  → yearly burn ~", round(1_000_000 * 50 * 0.01 * 365 / MAX_SUPPLY * 100, 3), "% of supply")
    print()
    print("Velocity sink: in-flight locks liquidity without selling. At 10k concurrent tasks @100 TASK →", 10_000*100, "TASK frozen")
    print("  →", round(10_000*100 / MAX_SUPPLY*100, 4), "% of supply illiquid")


if __name__ == "__main__":
    run_sweep()
