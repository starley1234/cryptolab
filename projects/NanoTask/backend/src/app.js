import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { Gateway } from "./escrow.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function createApp(options = {}) {
  const gw = options.gateway ?? new Gateway();
  const publicDir = options.publicDir ?? join(import.meta.dirname, "..", "public");

  function json(res, code, body) {
    res.writeHead(code, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  }

  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "authorization,content-type",
        });
        return res.end();
      }

      // health
      if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { ok: true, service: "nanotask", version: "1.0.0" });
      if (req.method === "GET" && url.pathname === "/api/stats") return json(res, 200, gw.stats());
      if (req.method === "GET" && url.pathname === "/api/wall") return json(res, 200, { items: gw.wall() });
      if (req.method === "GET" && url.pathname === "/api/events") return json(res, 200, { items: gw.state.events.slice(0, 60) });
      if (req.method === "GET" && url.pathname === "/api/tasks") return json(res, 200, { items: gw.tasksPublic() });
      if (req.method === "GET" && url.pathname.startsWith("/api/tasks/")) {
        const id = Number(url.pathname.split("/")[3]);
        const t = gw.state.getTask(id);
        if (!t) return json(res, 404, { error: "task not found" });
        return json(res, 200, t);
      }
      if (req.method === "GET" && url.pathname === "/api/agents") return json(res, 200, { items: gw.agentsPublic() });

      if (req.method === "POST" && url.pathname === "/api/agents") {
        const body = await readBody(req).catch(() => ({}));
        return json(res, 201, gw.createAgent(body.label || "agent", { balance: Number(body.balance) || 600, stake: Number(body.stake) || 60 }));
      }
      if (req.method === "GET" && url.pathname === "/api/me") {
        const me = gw.auth(req.headers.authorization);
        if (!me) return json(res, 401, { error: "invalid key" });
        return json(res, 200, { addr: me.addr, label: me.label, balance: me.balance, stake: me.stake });
      }
      if (req.method === "POST" && url.pathname === "/api/faucet") {
        const body = await readBody(req).catch(() => ({}));
        return json(res, 200, gw.faucet(req.headers.authorization, body.amount));
      }
      if (req.method === "POST" && url.pathname === "/api/stake") {
        const body = await readBody(req);
        return json(res, 200, gw.stakeMore(req.headers.authorization, body.amount));
      }
      if (req.method === "POST" && url.pathname === "/api/tasks") {
        const body = await readBody(req);
        return json(res, 201, gw.createTask(req.headers.authorization, body));
      }
      if (req.method === "POST" && url.pathname.match(/^\/api\/tasks\/\d+\/submit$/)) {
        const id = url.pathname.split("/")[3];
        const body = await readBody(req).catch(() => ({}));
        return json(res, 200, gw.submitResult(req.headers.authorization, id, body.resultHash, body.signature ? { signature: body.signature } : null));
      }
      if (req.method === "POST" && url.pathname.match(/^\/api\/tasks\/\d+\/submitWithSig$/)) {
        const id = url.pathname.split("/")[3];
        const body = await readBody(req);
        return json(res, 200, gw.submitWithSig(req.headers.authorization, id, body));
      }
      if (req.method === "POST" && url.pathname.match(/^\/api\/tasks\/\d+\/approve$/)) {
        const id = url.pathname.split("/")[3];
        return json(res, 200, gw.approve(req.headers.authorization, id));
      }
      if (req.method === "POST" && url.pathname.match(/^\/api\/tasks\/\d+\/claim$/)) {
        const id = url.pathname.split("/")[3];
        return json(res, 200, gw.claimTimeout(req.headers.authorization, id));
      }
      if (req.method === "POST" && url.pathname.match(/^\/api\/tasks\/\d+\/challenge$/)) {
        const id = url.pathname.split("/")[3];
        const body = await readBody(req).catch(() => ({}));
        return json(res, 200, gw.challenge(req.headers.authorization, id, body.reason));
      }
      if (req.method === "POST" && url.pathname.match(/^\/api\/tasks\/\d+\/cancel$/)) {
        const id = url.pathname.split("/")[3];
        return json(res, 200, gw.cancel(req.headers.authorization, id));
      }
      if (req.method === "POST" && url.pathname.match(/^\/api\/tasks\/\d+\/sign$/)) {
        const id = url.pathname.split("/")[3];
        const body = await readBody(req).catch(() => ({}));
        return json(res, 200, gw.signHelper(req.headers.authorization, id, body.resultHash || "0xdeadbeef"));
      }

      // static
      if (req.method === "GET") {
        let path = url.pathname === "/" ? "/index.html" : url.pathname;
        const file = normalize(join(publicDir, path));
        if (!file.startsWith(publicDir) || !existsSync(file) || !statSync(file).isFile()) {
          const fallback = join(publicDir, "index.html");
          if (existsSync(fallback) && !path.includes(".")) {
            res.writeHead(200, { "content-type": MIME[".html"] });
            return createReadStream(fallback).pipe(res);
          }
          res.writeHead(404); return res.end("not found");
        }
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        return createReadStream(file).pipe(res);
      }

      return json(res, 405, { error: "method not allowed" });
    } catch (e) {
      return json(res, e.status ?? 500, { error: String(e.message ?? e) });
    }
  });

  server.gw = gw;
  return server;
}
