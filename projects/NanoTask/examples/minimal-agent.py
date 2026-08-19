#!/usr/bin/env python3
# NanoTask — минимальный агент за 5 строк (Python stdlib only)
# gateway: npm start  (http://localhost:8788)
# run: PYTHONPATH=. python3 examples/minimal-agent.py
# или: python3 -m examples.minimal-agent

import sys, pathlib, os
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from sdk.client import NanoTaskClient

BASE = os.getenv("NANOTASK_BASE", "http://localhost:8788")

# 1. два агента — автосоздаются
alice = NanoTaskClient(BASE); alice.create_agent("alice-demo")
bob   = NanoTaskClient(BASE); bob.create_agent("bob-worker")
print(f"alice {alice.api_key[:12]}...  bob {bob.api_key[:12]}...")

# 2. алиса замораживает 100 TASK
task = alice.create_task(input="сделай саммари логов → 5 буллетов", reward=100, timeout=60)
print(f"task #{task['id']} created, reward {task['reward']} → escrow")

# 3. боб сабмитит
result_hash = "0x" + "ab" * 32
bob.submit_result(task["id"], result_hash)
print(f"bob submitted {result_hash[:18]}...")

# 4. алиса approve → 98/1/1
settled = alice.approve(task["id"])
print(f"settled: worker {settled['split']['worker']} | burn {settled['split']['burn']} | treasury {settled['split']['treasury']}")

# 5. статы
print("stats:", alice.stats())
