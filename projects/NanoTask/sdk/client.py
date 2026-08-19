"""NanoTask Python client — mirrors JS SDK, hardened (timeout, retries, validation)."""

from __future__ import annotations

import json
import re
import time
import urllib.request
import urllib.error
from typing import Any


HEX32_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")
HEX_ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{32,40}$")
HEX_ANY_RE = re.compile(r"^0x[0-9a-fA-F]+$")


class NanoTaskError(RuntimeError):
    def __init__(self, msg, status=None, body=None):
        super().__init__(msg)
        self.status = status
        self.body = body


class NanoTaskClient:
    """Agent-facing escrow client (hardened).

    Example:
        c = NanoTaskClient("http://localhost:8788", timeout=8)
        c.create_agent("my-worker")
        task = c.create_task(input="parse logs", reward=100)
        c.submit_result(task["id"], "0x" + "ab"*32)
        c.approve(task["id"])
    """

    def __init__(self, base_url: str, api_key: str | None = None, timeout: float = 8.0, retries: int = 2):
        if not base_url or not isinstance(base_url, str):
            raise ValueError("base_url required")
        if not base_url.startswith("http"):
            raise ValueError("base_url must be http(s)")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = float(timeout)
        if self.timeout < 1: self.timeout = 1
        if self.timeout > 30: self.timeout = 30
        self.retries = int(retries)
        if self.retries < 0: self.retries = 0
        if self.retries > 5: self.retries = 5

    # ---- low-level
    def _req(self, path: str, method: str = "GET", data: dict | None = None, _attempt: int = 0):
        url = self.base_url + path
        body = None if data is None else json.dumps(data).encode()
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                raw = res.read()
                if not raw: return {}
                return json.loads(raw.decode())
        except urllib.error.HTTPError as e:
            # retry on 429/5xx
            if e.code in (429, 500, 502, 503, 504) and _attempt < self.retries:
                time.sleep(0.2 * (2 ** _attempt) + 0.05)
                return self._req(path, method, data, _attempt+1)
            try:
                err_body = json.loads(e.read().decode())
                msg = err_body.get("error", str(e))
            except Exception:
                err_body = None
                msg = str(e)
            raise NanoTaskError(msg, status=e.code, body=err_body) from None
        except urllib.error.URLError as e:
            if _attempt < self.retries:
                time.sleep(0.2 * (2 ** _attempt) + 0.05)
                return self._req(path, method, data, _attempt+1)
            raise NanoTaskError(f"network error: {e}", status=0) from None
        except TimeoutError as e:
            if _attempt < self.retries:
                time.sleep(0.2 * (2 ** _attempt))
                return self._req(path, method, data, _attempt+1)
            raise NanoTaskError(f"timeout after {self.timeout}s", status=408) from None

    # ---- agents
    def create_agent(self, label: str = "agent", balance: int = 600, stake: int = 60):
        if not isinstance(label, str) or not label.strip():
            raise ValueError("label must be non-empty string")
        if len(label) > 32: raise ValueError("label max 32 chars")
        if not re.match(r"^[a-zA-Z0-9._\- ]+$", label): raise ValueError("label: only alphanum ._- space")
        out = self._req("/api/agents", "POST", {"label": label, "balance": balance, "stake": stake})
        self.api_key = out["apiKey"]
        return out

    def me(self): return self._req("/api/me")
    def faucet(self, amount: int = 250):
        if not isinstance(amount, int) or amount < 10 or amount > 1000:
            raise ValueError("amount 10..1000")
        return self._req("/api/faucet", "POST", {"amount": amount})
    def stake(self, amount: int = 20):
        if not isinstance(amount, int) or amount <= 0:
            raise ValueError("amount must be >0")
        return self._req("/api/stake", "POST", {"amount": amount})
    def agents(self): return self._req("/api/agents")
    def stats(self): return self._req("/api/stats")
    def wall(self, limit: int | None = None):
        q = f"?limit={int(limit)}" if limit else ""
        return self._req(f"/api/wall{q}")
    def events(self): return self._req("/api/events")

    # ---- tasks
    def create_task(self, input: str | None = None, input_hash: str | None = None, reward: int = 50, timeout: int = 60):
        if not isinstance(reward, int) or reward <= 0: raise ValueError("reward must be positive int")
        if reward > 1_000_000: raise ValueError("reward too large")
        if input_hash is not None and not HEX32_RE.match(input_hash): raise ValueError("input_hash must be 0x + 64 hex")
        return self._req("/api/tasks", "POST", {"input": input, "inputHash": input_hash, "reward": reward, "timeout": timeout})

    def list_tasks(self, limit: int | None = None, offset: int | None = None, status: int | None = None):
        q = "?"
        parts = []
        if limit is not None: parts.append(f"limit={int(limit)}")
        if offset is not None: parts.append(f"offset={int(offset)}")
        if status is not None: parts.append(f"status={int(status)}")
        qs = "&".join(parts)
        return self._req(f"/api/tasks{'?' + qs if qs else ''}")

    def get_task(self, task_id: int):
        if not isinstance(task_id, int) or task_id <= 0: raise ValueError("task_id must be >0")
        return self._req(f"/api/tasks/{task_id}")

    def submit_result(self, task_id: int, result_hash: str, signature: str | None = None):
        if not isinstance(task_id, int) or task_id <= 0: raise ValueError("task_id must be >0")
        if result_hash is not None and not HEX_ANY_RE.match(result_hash): raise ValueError("result_hash must be 0x hex")
        return self._req(f"/api/tasks/{task_id}/submit", "POST", {"resultHash": result_hash, "signature": signature})

    def submit_with_sig(self, task_id: int, result_hash: str, worker: str, signature: str):
        if not HEX_ADDR_RE.match(worker): raise ValueError("worker must be 0x 40 hex")
        if not HEX_ANY_RE.match(result_hash): raise ValueError("result_hash must be 0x hex")
        if not isinstance(signature, str) or not signature.startswith("0x"): raise ValueError("signature must be 0x hex")
        return self._req(f"/api/tasks/{task_id}/submitWithSig", "POST", {"resultHash": result_hash, "worker": worker, "signature": signature})

    def approve(self, task_id: int):
        if not isinstance(task_id, int) or task_id <= 0: raise ValueError("task_id must be >0")
        return self._req(f"/api/tasks/{task_id}/approve", "POST", {})

    def claim_timeout(self, task_id: int):
        if not isinstance(task_id, int) or task_id <= 0: raise ValueError("task_id must be >0")
        return self._req(f"/api/tasks/{task_id}/claim", "POST", {})

    def challenge(self, task_id: int, reason: str = "spam"):
        if not isinstance(task_id, int) or task_id <= 0: raise ValueError("task_id must be >0")
        return self._req(f"/api/tasks/{task_id}/challenge", "POST", {"reason": str(reason)[:120]})

    def cancel(self, task_id: int):
        if not isinstance(task_id, int) or task_id <= 0: raise ValueError("task_id must be >0")
        return self._req(f"/api/tasks/{task_id}/cancel", "POST", {})

    # ---- helpers
    @classmethod
    def connect(cls, base_url: str, label: str = "agent", **kw) -> "NanoTaskClient":
        c = cls(base_url, **kw)
        c.create_agent(label)
        return c
