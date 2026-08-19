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

function safeJsonParse(buf, limit = 256 * 1024) {
  if (buf.length > limit) throw Object.assign(new Error("body too large (max 256KB)"), { status: 413 });
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString("utf8")); } catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
}

export function createApp(options = {}) {
  const gw = options.gateway ?? new Gateway();
  const publicDir = options.publicDir ?? join(import.meta.dirname, "..", "public");
  let reqCounter = 0;

  function json(res, code, body, extraHeaders = {}) {
    res.writeHead(code, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      ...extraHeaders,
    });
    res.end(JSON.stringify(body));
  }

  async function readBody(req, limit = 256 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw Object.assign(new Error("body too large"), { status: 413 });
      chunks.push(c);
    }
    if (!chunks.length) return {};
    const buf = Buffer.concat(chunks);
    return safeJsonParse(buf, limit);
  }

  // simple in-memory rate buckets per IP
  const ipBuckets = new Map();
  function checkRate(ip, key, max, windowMs) {
    const now = Date.now();
    const id = `${ip}:${key}`;
    const b = ipBuckets.get(id) ?? { count: 0, resetAt: now + windowMs };
    if (now > b.resetAt) { b.count = 0; b.resetAt = now + windowMs; }
    b.count += 1;
    ipBuckets.set(id, b);
    if (b.count > max) throw Object.assign(new Error(`rate limit: ${key} ${max}/${windowMs/1000}s`), { status: 429 });
  }

  const server = createServer(async (req, res) => {
    const rid = ++reqCounter;
    const url = new URL(req.url, "http://localhost");
    const ip = req.socket.remoteAddress ?? "unknown";
    // basic security headers for all
    const t0 = Date.now();
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "authorization,content-type",
          "x-content-type-options": "nosniff",
        });
        return res.end();
      }

      // health
      if (req.method === "GET" && url.pathname === "/healthz") {
        const mem = process.memoryUsage();
        return json(res, 200, { ok: true, service: "nanotask", version: "1.1.0", uptimeSec: Math.round((Date.now()-gw.startedAt)/1000), mem: { rss: mem.rss, heapUsed: mem.heapUsed }, tasks: gw.state.tasks.size });
      }
      if (req.method === "GET" && url.pathname === "/metrics") {
        const s = gw.stats();
        const mem = process.memoryUsage();
        // prometheus text format
        const lines = [
          "# HELP nanotask_supply TASK supply after burn",
          "# TYPE nanotask_supply gauge",
          `nanotask_supply ${s.supply}`,
          "# HELP nanotask_burned total burned",
          "# TYPE nanotask_burned counter",
          `nanotask_burned ${s.burned}`,
          "# HELP nanotask_tasks_total total tasks",
          "# TYPE nanotask_tasks_total counter",
          `nanotask_tasks_total ${s.totalTasks}`,
          "# HELP nanotask_tasks_inflight in-flight tasks",
          "# TYPE nanotask_tasks_inflight gauge",
          `nanotask_tasks_inflight ${s.inFlight}`,
          "# HELP nanotask_agents agents",
          "# TYPE nanotask_agents gauge",
          `nanotask_agents ${s.agents}`,
          "# HELP nanotask_mem_heap_used bytes",
          "# TYPE nanotask_mem_heap_used gauge",
          `nanotask_mem_heap_used ${mem.heapUsed}`,
          "# HELP nanotask_uptime_seconds seconds",
          "# TYPE nanotask_uptime_seconds counter",
          `nanotask_uptime_seconds ${s.uptimeSec}`,
        ];
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4", "cache-control": "no-cache" });
        return res.end(lines.join("\n")+"\n");
      }
      if (req.method === "GET" && url.pathname === "/api/stats") return json(res, 200, gw.stats());
      if (req.method === "GET" && url.pathname === "/api/wall") {
        const limit = url.searchParams.get("limit");
        return json(res, 200, { items: gw.wall(limit ? Number(limit) : 40) });
      }
      if (req.method === "GET" && url.pathname === "/api/events") return json(res, 200, { items: gw.state.events.slice(0, 60) });
      if (req.method === "GET" && url.pathname === "/api/tasks") {
        const limit = url.searchParams.get("limit");
        const offset = url.searchParams.get("offset");
        const status = url.searchParams.get("status");
        return json(res, 200, { items: gw.tasksPublic(limit ?? 80, offset ?? 0, status) });
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/tasks/") && url.pathname.split("/").length === 4) {
        const id = Number(url.pathname.split("/")[3]);
        if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "invalid task id" });
        const t = gw.state.getTask(id);
        if (!t) return json(res, 404, { error: "task not found" });
        return json(res, 200, t);
      }
      if (req.method === "GET" && url.pathname === "/api/agents") return json(res, 200, { items: gw.agentsPublic() });
      if (req.method === "GET" && url.pathname === "/api/presence/pool") return json(res, 200, { items: gw.poolPublic(), stats: gw.presenceStats() });
      if (req.method === "GET" && url.pathname === "/api/presence/stats") return json(res, 200, gw.presenceStats());
      if (req.method === "POST" && url.pathname === "/api/presence/heartbeat") {
        return json(res, 200, gw.heartbeat(req.headers.authorization));
      }
      if (req.method === "POST" && url.pathname === "/api/presence/capabilities") {
        const body = await readBody(req);
        return json(res, 200, gw.setCapabilities(req.headers.authorization, body.capabilities || body.caps || []));
      }
      if (req.method === "POST" && url.pathname === "/api/presence/wait") {
        // smart long-poll: find OPEN task matching worker caps, else wait
        const me = gw.auth(req.headers.authorization);
        if (!me) return json(res, 401, { error: "invalid key" });
        const body = await readBody(req).catch(()=>({}));
        // if worker sent caps, update
        if (body.capabilities) { try { gw.setCapabilities(req.headers.authorization, body.capabilities); } catch {} }
        // heartbeatimplicit
        try { gw.heartbeat(req.headers.authorization); } catch {}
        const myCaps = gw.presence.get(me.addr)?.capabilities || [];
        // find best OPEN task
        const openTasks = [...gw.state.tasks.values()].filter(x=> x.status===0).sort((a,b)=> b.id-a.id);
        let best = null;
        if (openTasks.length) {
          // simple capability match
          for (const tk of openTasks) {
            const inp = String(tk.input||"").toLowerCase();
            const hasMatch = !myCaps.length || myCaps.some(c=> inp.includes(c.toLowerCase()));
            if (hasMatch) { best = tk; break; }
          }
          if (!best) best = openTasks[0]; // fallback generic
        }
        if (best) {
          return json(res, 200, { task: { ...best, clientLabel: best.clientLabel || "client" }, matched: true, capabilities: myCaps });
        }
        // no task — tell to keep waiting, include idle bonus info
        return json(res, 200, { waiting: true, poolSize: gw.poolPublic().length, capabilities: myCaps, heartbeat: true });
      }

      if (req.method === "POST" && url.pathname === "/api/agents") {
        checkRate(ip, "createAgent", 20, 60_000);
        const body = await readBody(req).catch(e => { throw e; });
        // validate label early
        const label = String(body.label ?? "agent").slice(0, 32);
        return json(res, 201, gw.createAgent(label, { balance: Number(body.balance) || 600, stake: Number(body.stake) || 60 }));
      }
      if (req.method === "GET" && url.pathname === "/api/me") {
        const me = gw.auth(req.headers.authorization);
        if (!me) return json(res, 401, { error: "invalid key" });
        return json(res, 200, { addr: me.addr, label: me.label, balance: me.balance, stake: me.stake });
      }
      if (req.method === "POST" && url.pathname === "/api/faucet") {
        const body = await readBody(req).catch(() => ({}));
        // faucet rate is also checked inside gateway per addr, but add IP check
        checkRate(ip, "faucet", 30, 60_000);
        return json(res, 200, gw.faucet(req.headers.authorization, body.amount));
      }
      if (req.method === "POST" && url.pathname === "/api/stake") {
        const body = await readBody(req);
        return json(res, 200, gw.stakeMore(req.headers.authorization, body.amount));
      }
      if (req.method === "POST" && url.pathname === "/api/tasks") {
        checkRate(ip, "createTask", 60, 60_000);
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

      // HTTP MCP bridge — for agents without stdio (curl / fetch)
      if (url.pathname === "/api/mcp") {
        if (req.method === "GET") {
          return json(res, 200, { tools: [
            { name:"nanotask_stats", description:"stats: supply, burned, inFlight" },
            { name:"nanotask_create_agent", description:"create agent label -> apiKey" },
            { name:"nanotask_create_task", description:"create task input,reward -> id" },
            { name:"nanotask_list_tasks", description:"list tasks" },
            { name:"nanotask_submit_result", description:"submit resultHash" },
            { name:"nanotask_approve", description:"approve taskId -> 98/1/1" },
            { name:"nanotask_wall", description:"wall" },
          ]});
        }
        if (req.method === "POST") {
          const body = await readBody(req);
          let m = body.method || body.tool || "";
          let params = body.params || body.arguments || body.args || {};
          if (body.params && body.params.name) { m = "tools/call"; params = body.params; }
          const rid2 = body.id ?? 1;
          const reply = (result, error) => {
            if (body.jsonrpc) {
              return json(res, error?500:200, error? { jsonrpc:"2.0", id: rid2, error:{code:-32000, message:String(error.message||error)}} : { jsonrpc:"2.0", id: rid2, result });
            }
            if (error) return json(res, 500, { error: String(error.message||error) });
            return json(res, 200, result);
          };
          try {
            const key = (req.headers.authorization||"").replace(/^Bearer\s+/i,"") || body.apiKey || body.key || "";
            const auth = key ? `Bearer ${key}` : req.headers.authorization;
            if (m==="tools/list" || m==="list_tools") {
              return reply({ tools: [
                { name:"nanotask_stats", inputSchema:{type:"object",properties:{}} },
                { name:"nanotask_create_agent", inputSchema:{type:"object",properties:{label:{type:"string"}},required:["label"]} },
                { name:"nanotask_create_task", inputSchema:{type:"object",properties:{input:{type:"string"},reward:{type:"integer"},timeout:{type:"integer"}},required:["input","reward"]} },
                { name:"nanotask_list_tasks", inputSchema:{type:"object",properties:{limit:{type:"integer"},status:{type:"integer"}}} },
                { name:"nanotask_submit_result", inputSchema:{type:"object",properties:{taskId:{type:"integer"},resultHash:{type:"string"}}} },
                { name:"nanotask_approve", inputSchema:{type:"object",properties:{taskId:{type:"integer"}}} },
                { name:"nanotask_wall", inputSchema:{type:"object",properties:{limit:{type:"integer"}}} },
              ]});
            }
            if (m==="tools/call") {
              const { name, arguments: a } = params;
              let out;
              switch(name){
                case "nanotask_stats": out = gw.stats(); break;
                case "nanotask_create_agent": out = gw.createAgent(a.label||"mcp-agent", {balance:600, stake:60}); break;
                case "nanotask_create_task": out = gw.createTask(auth||`Bearer ${key}`, { input:a.input, reward:a.reward, timeout:a.timeout }); break;
                case "nanotask_list_tasks": out = { items: gw.tasksPublic(a.limit||20, a.offset||0, a.status) }; break;
                case "nanotask_submit_result": out = gw.submitResult(auth||`Bearer ${key}`, a.taskId, a.resultHash); break;
                case "nanotask_approve": out = gw.approve(auth||`Bearer ${key}`, a.taskId); break;
                case "nanotask_wall": out = { items: gw.wall(a.limit||20) }; break;
                default: throw new Error("unknown tool "+name);
              }
              if (body.jsonrpc) return reply({ content:[{ type:"text", text: JSON.stringify(out,null,2) }] });
              return reply(out);
            }
            if (body.tool) {
              const name = body.tool;
              const a = body.arguments||{};
              let out;
              switch(name){
                case "nanotask_stats": out = gw.stats(); break;
                case "nanotask_create_agent": out = gw.createAgent(a.label||"mcp-agent"); break;
                case "nanotask_create_task": out = gw.createTask(auth, { input:a.input, reward:a.reward, timeout:a.timeout }); break;
                case "nanotask_submit_result": out = gw.submitResult(auth, a.taskId, a.resultHash); break;
                case "nanotask_approve": out = gw.approve(auth, a.taskId); break;
                default: throw new Error("unknown tool "+name);
              }
              return reply(out);
            }
            return reply(null, new Error("unknown mcp method, use {method:\"tools/call\", params:{name, arguments}}"));
          } catch(e){ return reply(null, e); }
        }
      }
      if (req.method === "POST" && url.pathname.match(/^\/api\/tasks\/\d+\/sign$/)) {
        const id = url.pathname.split("/")[3];
        const body = await readBody(req).catch(() => ({}));
        return json(res, 200, gw.signHelper(req.headers.authorization, id, body.resultHash || "0xdeadbeef"));
      }

      // static
      if (req.method === "GET") {
        let path = url.pathname === "/" ? "/index.html" : url.pathname;
        // block query strings already stripped by URL
        const file = normalize(join(publicDir, path));
        // strict traversal guard: must be inside publicDir with separator
        const within = file === publicDir || file.startsWith(publicDir + "/");
        if (!within || !existsSync(file) || !statSync(file).isFile()) {
          const fallback = join(publicDir, "index.html");
          if (existsSync(fallback) && !path.includes(".") && path !== "/index.html") {
            res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "public, max-age=60" });
            return createReadStream(fallback).pipe(res);
          }
          res.writeHead(404, { "content-type": "text/plain", "x-content-type-options": "nosniff" }); return res.end("not found");
        }
        const ext = extname(file);
        res.writeHead(200, {
          "content-type": MIME[ext] ?? "application/octet-stream",
          "cache-control": ext === ".html" ? "no-cache" : "public, max-age=300",
          "x-content-type-options": "nosniff",
        });
        return createReadStream(file).pipe(res);
      }

      return json(res, 405, { error: "method not allowed" });
    } catch (e) {
      const code = e.status ?? 500;
      // log with rid
      const msg = String(e.message ?? e);
      if (code >= 500) console.error(`[nano][${rid}] ${req.method} ${url.pathname} -> ${code} ${msg}`);
      return json(res, code, { error: msg });
    } finally {
      // optional access log for 4xx
      // console.log(`[nano][${rid}] ${req.method} ${url.pathname} ${Date.now()-t0}ms`)
    }
  });

  server.gw = gw;
  // graceful
  server.on("error", (err) => console.error("[nano] server error", err));
  return server;
}
