import { createApp } from "./src/app.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp();
app.listen(port, host, () => {
  console.log(`CogniMesh gateway http://${host}:${port}`);
});
