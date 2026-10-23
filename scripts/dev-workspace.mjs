import { spawn } from "node:child_process";
import { createServer } from "vite";
const demo = process.argv.includes("--demo");
if (demo) process.env.VITE_ORIN_LOCAL_DEMO = "1";
const api = spawn(
  process.execPath,
  ["scripts/dev-api.mjs", ...(demo ? ["--demo"] : [])],
  { stdio: "inherit", env: process.env },
);
const vite = await createServer({ server: { host: "127.0.0.1", port: 5173 } });
await vite.listen();
vite.printUrls();
const close = async () => {
  api.kill();
  await vite.close();
  process.exit();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
api.on("exit", (code) => {
  if (code) void close();
});
