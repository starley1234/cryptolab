import { createApp } from "./src/app.js";

const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp();
app.listen(port, host, () => {
  console.log(`[nanotask] listening on http://${host}:${port}`);
  console.log(`[nanotask] demo escrow 98/1/1 ready — open http://${host}:${port} in preview`);
});
