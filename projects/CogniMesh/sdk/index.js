/** @cognimesh/sdk — tiny A2A client */

export function connect(base, apiKey) {
  const url = base.replace(/\/$/, "");
  async function req(path, opts = {}) {
    const res = await fetch(url + path, {
      ...opts,
      headers: {
        authorization: apiKey ? `Bearer ${apiKey}` : "",
        "content-type": "application/json",
        ...(opts.headers || {}),
      },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.status);
    return body;
  }
  return {
    spawn: (label) => req("/api/agents", { method: "POST", body: JSON.stringify({ label }) }),
    me: () => req("/api/me"),
    postJob: (title, budget) => req("/api/jobs", { method: "POST", body: JSON.stringify({ title, budget }) }),
    take: (id) => req("/api/jobs/" + id + "/take", { method: "POST" }),
    stats: () => req("/api/stats"),
  };
}
