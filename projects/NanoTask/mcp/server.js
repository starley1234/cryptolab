#!/usr/bin/env node
// NanoTask MCP Server — stdio JSON-RPC for Claude/Cursor/Copilot
// Tools: create_task, submit_result, approve, list, stats, wall + WAIT POOL (heartbeat, capabilities, wait)
// Usage:
//   node mcp/server.js --base http://localhost:8788 --key nt_... --wait --caps "summarize,code-review"
// Or env: NANOTASK_BASE, NANOTASK_API_KEY, NANOTASK_CAPS
import { NanoTaskClient } from "../sdk/index.js";

const args = process.argv.slice(2);
function arg(name, def="") {
  const i = args.indexOf(`--${name}`);
  return i>=0 ? args[i+1] : (process.env[`NANOTASK_${name.toUpperCase()}`] || def);
}
function hasFlag(name){ return args.includes(`--${name}`); }

const BASE = arg("base", "http://localhost:8788");
const API_KEY = arg("key", process.env.NANOTASK_API_KEY || "");
const WAIT = hasFlag("wait");
const CAPS = (arg("caps", process.env.NANOTASK_CAPS || "") || "").split(",").map(s=>s.trim()).filter(Boolean);

const client = new NanoTaskClient({ baseUrl: BASE, apiKey: API_KEY || undefined });

// auto-create agent if no key and --wait (so agent is instantly in pool)
async function ensureAgent() {
  if (client.apiKey) return;
  const label = arg("label", "mcp-agent");
  const tmp = new NanoTaskClient({ baseUrl: BASE });
  const out = await tmp.createAgent(label);
  client.apiKey = out.apiKey;
  console.error(`[mcp] auto-created agent ${label} ${out.addr} key ${out.apiKey.slice(0,12)}...`);
  if (CAPS.length) {
    try {
      await client._json("/api/presence/capabilities", { method:"POST", auth:true, body:{ capabilities: CAPS } });
      console.error(`[mcp] capabilities set: ${CAPS.join(",")}`);
    } catch(e){ console.error("[mcp] caps failed", e.message); }
  }
}
if (WAIT) {
  ensureAgent().then(()=>{
    // heartbeat loop 30s, earns 0.2 TASK/min
    setInterval(async ()=>{
      try{
        const r = await client._json("/api/presence/heartbeat", { method:"POST", auth:true });
        if (r.idleReward) console.error(`[mcp][heartbeat] +${r.idleReward} idle, pool ${r.poolSize}`);
      }catch(e){ console.error("[mcp][heartbeat] fail", e.message); }
    }, 30000).unref();
    // also immediate heartbeat
    setTimeout(async()=>{
      try{ await client._json("/api/presence/heartbeat", { method:"POST", auth:true }); console.error("[mcp] heartbeat ok, in WAIT pool"); }catch(e){ console.error("[mcp] heartbeat fail", e.message); }
    }, 1000);
  });
}

const TOOLS = [
  {
    name: "nanotask_stats",
    description: "Get NanoTask supply, burned, inFlight, tasks counts. No auth needed.",
    inputSchema: { type:"object", properties:{}, required:[] },
  },
  {
    name: "nanotask_create_agent",
    description: "Create an agent (label 1-32 alnum). Returns apiKey, addr, balance, stake. Auto-adopted for this session.",
    inputSchema: { type:"object", properties:{ label:{type:"string", description:"agent name"} }, required:["label"] },
  },
  {
    name: "nanotask_create_task",
    description: "Create escrowed task: freeze reward, returns task id. Smart dispatch to WAIT pool.",
    inputSchema: { type:"object", properties:{ input:{type:"string"}, reward:{type:"integer", minimum:1, maximum:1000000}, timeout:{type:"integer", description:"seconds 5..2592000"} }, required:["input","reward"] },
  },
  {
    name: "nanotask_list_tasks",
    description: "List tasks with limit/offset/status.",
    inputSchema: { type:"object", properties:{ limit:{type:"integer"}, offset:{type:"integer"}, status:{type:"integer", description:"0 Open 1 Submitted 2 Settled 3 Slashed 4 Cancelled"} }, required:[] },
  },
  {
    name: "nanotask_submit_result",
    description: "Submit resultHash (0x + 64 hex) for task. Needs stake >=50.",
    inputSchema: { type:"object", properties:{ taskId:{type:"integer"}, resultHash:{type:"string", description:"0x + 64 hex"} }, required:["taskId","resultHash"] },
  },
  {
    name: "nanotask_approve",
    description: "Approve Submitted task as client → split 98/1/1.",
    inputSchema: { type:"object", properties:{ taskId:{type:"integer"} }, required:["taskId"] },
  },
  {
    name: "nanotask_wall",
    description: "Recent settled tasks wall.",
    inputSchema: { type:"object", properties:{ limit:{type:"integer"} }, required:[] },
  },
  {
    name: "nanotask_set_capabilities",
    description: "Set your capabilities so system routes matching tasks to you. E.g. ['summarize','code-review','translate']. Max 10.",
    inputSchema: { type:"object", properties:{ capabilities:{type:"array", items:{type:"string"}, description:"skills, 2..32 chars"} }, required:["capabilities"] },
  },
  {
    name: "nanotask_heartbeat",
    description: "Ping WAIT pool: stay online, earn 0.2 TASK/min idle bonus, keep stake. Call every 30s or use --wait flag.",
    inputSchema: { type:"object", properties:{}, required:[] },
  },
  {
    name: "nanotask_wait_for_work",
    description: "Long-poll for next OPEN task matching your capabilities. Returns task if found, else {waiting:true}. Use in loop.",
    inputSchema: { type:"object", properties:{ capabilities:{type:"array", items:{type:"string"}}, timeout:{type:"integer", description:"seconds"} }, required:[] },
  },
  {
    name: "nanotask_pool",
    description: "Show WAIT pool: who is online, capabilities, waitingSec, stake, idleEarned.",
    inputSchema: { type:"object", properties:{}, required:[] },
  },
];

async function callTool(name, a) {
  switch(name){
    case "nanotask_stats": return await client.stats();
    case "nanotask_create_agent": {
      const c = new NanoTaskClient({ baseUrl: BASE });
      const out = await c.createAgent(a.label);
      client.apiKey = out.apiKey;
      return out;
    }
    case "nanotask_create_task": return await client.createTask({ input: a.input, reward: a.reward, timeout: a.timeout });
    case "nanotask_list_tasks": return await client.listTasks({ limit: a.limit, offset: a.offset, status: a.status });
    case "nanotask_submit_result": return await client.submitResult(a.taskId, a.resultHash);
    case "nanotask_approve": return await client.approve(a.taskId);
    case "nanotask_wall": return await client.wall();
    case "nanotask_set_capabilities": {
      return await client._json("/api/presence/capabilities", { method:"POST", auth:true, body:{ capabilities: a.capabilities } });
    }
    case "nanotask_heartbeat": {
      return await client._json("/api/presence/heartbeat", { method:"POST", auth:true });
    }
    case "nanotask_wait_for_work": {
      if (a.capabilities) {
        try{ await client._json("/api/presence/capabilities", { method:"POST", auth:true, body:{ capabilities: a.capabilities } }); }catch{}
      }
      return await client._json("/api/presence/wait", { method:"POST", auth:true, body:{ capabilities: a.capabilities } });
    }
    case "nanotask_pool": {
      return await client._json("/api/presence/pool", { method:"GET" });
    }
    default: throw new Error("unknown tool "+name);
  }
}

// MCP stdio handling (simplified JSON-RPC)
let buf="";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async chunk=>{
  buf+=chunk;
  let idx;
  while((idx=buf.indexOf("\n"))>=0){
    const line=buf.slice(0,idx).trim();
    buf=buf.slice(idx+1);
    if(!line) continue;
    let msg;
    try{ msg=JSON.parse(line); }catch{ continue; }
    const { id, method, params } = msg;
    const reply = (result, error) => {
      const out = { jsonrpc:"2.0", id, ...(error? {error:{code:-32000,message:String(error.message||error)}} : {result}) };
      process.stdout.write(JSON.stringify(out)+"\n");
    };
    try{
      if(method==="initialize"){
        reply({ protocolVersion:"2024-11-05", capabilities:{ tools:{ listChanged:true } }, serverInfo:{ name:"nanotask-mcp", version:"1.1.0" } });
      } else if(method==="tools/list"){
        reply({ tools: TOOLS });
      } else if(method==="tools/call"){
        const { name, arguments: a } = params;
        const res = await callTool(name, a||{});
        reply({ content:[{ type:"text", text: JSON.stringify(res, null, 2) }] });
      } else if(method==="notifications/initialized"){
        // no-op
      } else {
        reply(null, new Error("unknown method "+method));
      }
    }catch(e){ reply(null, e); }
  }
});

// also support direct CLI test: node mcp/server.js --test
if (args.includes("--test")) {
  (async()=>{
    console.log("TEST stats:", await client.stats());
    if (!client.apiKey) {
      const tmp = new NanoTaskClient({baseUrl:BASE});
      const a = await tmp.createAgent("mcp-test");
      console.log("created", a);
      client.apiKey = a.apiKey;
    }
    console.log("heartbeat:", await client._json("/api/presence/heartbeat", {method:"POST", auth:true}));
    console.log("pool:", await client._json("/api/presence/pool", {method:"GET"}));
  })().then(()=>process.exit(0));
}
