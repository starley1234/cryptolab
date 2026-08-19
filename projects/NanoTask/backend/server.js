import { createApp } from "./src/app.js";
import { Gateway } from "./src/escrow.js";
import { Persist, storePathFromEnv } from "./src/store.js";

const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST ?? "0.0.0.0";

// persistence: if STATE_FILE set, restore; always schedule flush
const gateway = new Gateway();
let persist = null;
try {
  const file = storePathFromEnv();
  persist = new Persist(file, gateway);
  const loaded = persist.load();
  gateway.setPersist(persist);
  if (loaded) {
    console.log(`[nanotask] state restored from ${file} (${gateway.state.tasks.size} tasks, ${gateway.keys.size} agents)`);
  } else {
    // fresh — still enable persist so future writes survive
    console.log(`[nanotask] fresh state, will persist to ${file}`);
  }
  persist.startAuto();
} catch (e) {
  console.error("[nanotask] persist init failed:", e.message);
}

const app = createApp({ gateway });
const server = app.listen(port, host, () => {
  console.log(`[nanotask] listening on http://${host}:${port}`);
  console.log(`[nanotask] demo escrow 98/1/1 hardened — open http://${host}:${port} in preview`);
  console.log(`[nanotask] healthz http://${host}:${port}/healthz  stats http://${host}:${port}/api/stats  metrics http://${host}:${port}/metrics`);
  if (persist) console.log(`[nanotask] persist → ${persist.file}`);
});

let shuttingDown = false;
function shutdown(sig){
  if(shuttingDown) return;
  shuttingDown = true;
  console.log(`[nanotask] ${sig} — graceful shutdown`);
  try { persist?.flush(); } catch {}
  persist?.stopAuto?.();
  server.close(() => {
    console.log("[nanotask] closed");
    process.exit(0);
  });
  setTimeout(()=>{ console.error("[nanotask] force exit"); process.exit(1); }, 5000).unref();
}
process.on("SIGTERM", ()=>shutdown("SIGTERM"));
process.on("SIGINT", ()=>shutdown("SIGINT"));
process.on("unhandledRejection", (e)=> console.error("[nanotask] unhandledRejection", e));
process.on("uncaughtException", (e)=> { console.error("[nanotask] uncaughtException", e); shutdown("uncaughtException"); });
