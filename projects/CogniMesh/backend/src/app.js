import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { Gateway } from "./mesh.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
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
      if (req.method === "GET" && url.pathname === "/healthz") {
        return json(res, 200, { ok: true, service: "cognimesh" });
      }
      if (req.method === "GET" && url.pathname === "/api/stats") {
        return json(res, 200, gw.stats());
      }
      if (req.method === "GET" && url.pathname === "/api/wall") {
        return json(res, 200, { items: gw.wall });
      }
      if (req.method === "GET" && url.pathname === "/api/jobs") {
        return json(res, 200, { items: gw.jobs.slice(0, 40) });
      }
      if (req.method === "GET" && url.pathname === "/api/agents") {
        return json(res, 200, { items: gw.agentsPublic() });
      }
      if (req.method === "GET" && url.pathname === "/api/events") {
        return json(res, 200, { items: gw.events });
      }
      if (req.method === "GET" && url.pathname === "/api/challenges") {
        return json(res, 200, { items: gw.challenges });
      }
      if (req.method === "POST" && url.pathname === "/api/agents") {
        const body = await readBody(req).catch(() => ({}));
        return json(res, 201, gw.createAgent(body.label));
      }
      if (req.method === "GET" && url.pathname === "/api/me") {
        const me = gw.auth(req.headers.authorization);
        if (!me) return json(res, 401, { error: "invalid key" });
        return json(res, 200, {
          addr: me.addr,
          label: me.label,
          balance: me.balance,
          reputation: me.agent?.reputation,
          stake: me.agent?.stake,
          credit: gw.credit(me.addr),
        });
      }
      if (req.method === "POST" && url.pathname === "/api/jobs") {
        const body = await readBody(req);
        return json(res, 201, gw.postJob(req.headers.authorization, body));
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/take")) {
        const id = url.pathname.split("/")[3];
        return json(res, 200, gw.takeJob(req.headers.authorization, id));
      }
      if (req.method === "POST" && url.pathname === "/api/faucet") {
        const body = await readBody(req).catch(() => ({}));
        return json(res, 200, gw.faucet(req.headers.authorization, body.amount));
      }
      if (req.method === "POST" && url.pathname === "/api/challenge") {
        const body = await readBody(req);
        return json(res, 200, gw.challenge(req.headers.authorization, body));
      }
      if (req.method === "POST" && url.pathname === "/api/flash") {
        const body = await readBody(req);
        return json(res, 200, gw.flash(req.headers.authorization, body.amount));
      }
      if (req.method === "GET") {
        let path = url.pathname === "/" ? "/index.html" : url.pathname;
        const file = normalize(join(publicDir, path));
        if (!file.startsWith(publicDir) || !existsSync(file) || !statSync(file).isFile()) {
          const fallback = join(publicDir, "index.html");
          if (existsSync(fallback) && !path.includes(".")) {
            res.writeHead(200, { "content-type": MIME[".html"] });
            return createReadStream(fallback).pipe(res);
          }
          res.writeHead(404);
          return res.end("not found");
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
