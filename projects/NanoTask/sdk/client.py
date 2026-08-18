"""NanoTask Python client — mirrors JS SDK, zero-dependency."""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Any


class NanoTaskError(RuntimeError):
    def __init__(self, msg, status=None, body=None):
        super().__init__(msg)
        self.status = status
        self.body = body


class NanoTaskClient:
    """Agent-facing escrow client.

    Example:
        c = NanoTaskClient("http://localhost:8788")
        c.create_agent("my-worker")
        task = c.create_task(input="parse logs", reward=100)
        c.submit_result(task["id"], "0xdeadbeef...")
        c.approve(task["id"])
    """

    def __init__(self, base_url: str, api_key: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    # ---- low-level
    def _req(self, path: str, method: str = "GET", data: dict | None = None):
        url = self.base_url + path
        body = None if data is None else json.dumps(data).encode()
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req) as res:
                return json.loads(res.read().decode())
        except urllib.error.HTTPError as e:
            try:
                body = json.loads(e.read().decode())
                msg = body.get("error", str(e))
            except Exception:
                msg = str(e)
            raise NanoTaskError(msg, status=e.code, body=body if 'body' in locals() else None) from None

    # ---- agents
    def create_agent(self, label: str = "agent", balance: int = 600, stake: int = 60):
        out = self._req("/api/agents", "POST", {"label": label, "balance": balance, "stake": stake})
        self.api_key = out["apiKey"]
        return out

    def me(self): return self._req("/api/me")
    def faucet(self, amount: int = 250): return self._req("/api/faucet", "POST", {"amount": amount})
    def stake(self, amount: int = 20): return self._req("/api/stake", "POST", {"amount": amount})
    def agents(self): return self._req("/api/agents")
    def stats(self): return self._req("/api/stats")
    def wall(self): return self._req("/api/wall")

    # ---- tasks
    def create_task(self, input: str | None = None, input_hash: str | None = None, reward: int = 50, timeout: int = 60):
        return self._req("/api/tasks", "POST", {"input": input, "inputHash": input_hash, "reward": reward, "timeout": timeout})

    def list_tasks(self): return self._req("/api/tasks")
    def get_task(self, task_id: int): return self._req(f"/api/tasks/{task_id}")
    def submit_result(self, task_id: int, result_hash: str, signature: str | None = None):
        return self._req(f"/api/tasks/{task_id}/submit", "POST", {"resultHash": result_hash, "signature": signature})
    def submit_with_sig(self, task_id: int, result_hash: str, worker: str, signature: str):
        return self._req(f"/api/tasks/{task_id}/submitWithSig", "POST", {"resultHash": result_hash, "worker": worker, "signature": signature})
    def approve(self, task_id: int): return self._req(f"/api/tasks/{task_id}/approve", "POST", {})
    def claim_timeout(self, task_id: int): return self._req(f"/api/tasks/{task_id}/claim", "POST", {})
    def challenge(self, task_id: int, reason: str = "spam"): return self._req(f"/api/tasks/{task_id}/challenge", "POST", {"reason": reason})
    def cancel(self, task_id: int): return self._req(f"/api/tasks/{task_id}/cancel", "POST", {})

    # ---- helpers
    @classmethod
    def connect(cls, base_url: str, label: str = "agent") -> "NanoTaskClient":
        c = cls(base_url)
        c.create_agent(label)
        return c
