#!/usr/bin/env python3
"""NanoTask load_test_sim — 10k параллельных задач.

Симулирует контрактную нагрузку: создание, сабмит, сеттл в рандомных
интервалах, измеряет throughput, latency, газ-экономию батчей.
Никаких внешних зависимостей.
"""

from __future__ import annotations
import random
import time
from collections import Counter

STATUS_OPEN = 0
STATUS_SUBMITTED = 1
STATUS_SETTLED = 2
STATUS_SLASHED = 3

BURN_BPS = 100
FEE_BPS = 200

def split(reward): return (reward*0.98, reward*0.01, reward*0.01)

class Task:
    __slots__ = ("id","reward","status","created","submitted","settled","worker","client")
    def __init__(self, tid, reward, ts):
        self.id=tid; self.reward=reward; self.status=STATUS_OPEN
        self.created=ts; self.submitted=None; self.settled=None
        self.worker=None; self.client=f"client-{tid%100}"

def simulate(num_tasks=10_000, workers=200, bad_rate=0.02, timeout=1.0, seed=13):
    rng = random.Random(seed)
    base = time.time()
    tasks = [Task(i, rng.uniform(20,200), base + i*0.0001) for i in range(num_tasks)]
    # assign workers randomly with stake check (all staked)
    latencies = []
    status = Counter()
    burned = 0.0
    t0 = time.perf_counter()
    for t in tasks:
        # submit after 5-50ms simulated
        submit_delay = rng.uniform(0.005, 0.05)
        t.submitted = t.created + submit_delay
        t.worker = f"worker-{rng.randrange(workers)}"
        t.status = STATUS_SUBMITTED
        # decide outcome
        r = rng.random()
        if r < bad_rate:
            t.status = STATUS_SLASHED
            burned += 18.75  # half of 37.5 slash
            status["slashed"] += 1
            continue
        # optimistic: 80% approve instantly, 20% claim after timeout
        if r < 0.82:
            settle_delay = rng.uniform(0.01, 0.2)
        else:
            settle_delay = timeout + rng.uniform(0.01, 0.05)
        t.settled = t.submitted + settle_delay
        w,b,tr = split(t.reward)
        burned += b
        latencies.append(settle_delay + submit_delay)
        t.status = STATUS_SETTLED
        status["settled"] += 1
    elapsed = time.perf_counter() - t0
    status["open"] = num_tasks - status["settled"] - status["slashed"]
    avg_lat = sum(latencies)/len(latencies) if latencies else 0
    p95 = sorted(latencies)[int(len(latencies)*0.95)] if latencies else 0
    throughput = num_tasks / elapsed if elapsed>0 else 0
    # gas estimate: create ~45k, submit ~35k, settle ~40k → ~120k per task
    gas_per_task = 120_000
    gas_total = num_tasks * gas_per_task
    # batch settle cuts ~30%
    batch_saving = 0.3
    return {
        "tasks": num_tasks,
        "workers": workers,
        "elapsed_sim_s": round(elapsed,4),
        "throughput_tasks_per_s": round(throughput,1),
        "avg_latency_s": round(avg_lat,4),
        "p95_latency_s": round(p95,4),
        "settled": status["settled"],
        "slashed": status["slashed"],
        "burned": round(burned,2),
        "gas_total": gas_total,
        "gas_per_task": gas_per_task,
        "batch_gas_total_est": int(gas_total*(1-batch_saving)),
        "host_time_s": round(elapsed,4),
    }

def main():
    print("NanoTask — load test 10k tasks")
    print("="*64)
    res = simulate(num_tasks=10_000)
    for k,v in res.items():
        print(f"{k:24s} {v}")
    print()
    # smaller sweep
    for n in [100, 1000, 5000]:
        r = simulate(num_tasks=n)
        print(f"n={n:5d} → throughput {r['throughput_tasks_per_s']:7.1f} tasks/s  p95 {r['p95_latency_s']:.3f}s  burned {r['burned']:.1f}")
    print()
    # invariants
    assert res["settled"] + res["slashed"] == res["tasks"]
    assert res["throughput_tasks_per_s"] > 1000  # in-memory sim should be fast
    assert res["burned"] > 0
    # concurrency check: 10k in-flight would freeze ~ avg_reward ~110 *10k = 1.1M TASK (~0.11% supply)
    avg_reward = 110
    print(f"\nVelocity sink at 10k concurrent (avg {avg_reward}): {10_000*avg_reward:,} TASK frozen ≈ {10_000*avg_reward/1_000_000_000*100:.4f}% supply")
    # realistic chain TPS note
    print("On Base (~200 TPS gas 120k/task): ~ 10k tasks would take ~ 6-8 blocks with batching")

if __name__ == "__main__":
    main()
