"""Python AgentWallet — drop-in for LangChain / Crew-style loops."""

from __future__ import annotations

import json
import urllib.request


class AgentWallet:
    def __init__(self, base: str, api_key: str | None = None):
        self.base = base.rstrip("/")
        self.api_key = api_key

    def _req(self, path: str, method: str = "GET", data: dict | None = None):
        body = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(
            self.base + path,
            data=body,
            method=method,
            headers={"content-type": "application/json", "authorization": f"Bearer {self.api_key or ''}"},
        )
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode())

    @classmethod
    def spawn(cls, base: str, label: str = "py-agent") -> "AgentWallet":
        tmp = cls(base)
        out = tmp._req("/api/agents", "POST", {"label": label})
        w = cls(base, out["apiKey"])
        w.meta = out
        return w

    def post_job(self, title: str, budget: float = 10):
        return self._req("/api/jobs", "POST", {"title": title, "budget": budget})

    def take(self, job_id: str):
        return self._req(f"/api/jobs/{job_id}/take", "POST", {})

    def me(self):
        return self._req("/api/me")
