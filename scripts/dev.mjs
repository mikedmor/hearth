#!/usr/bin/env node
/**
 * Runs the API server (tsx watch, :8082) and the page (Vite, :5173) together.
 * Open http://localhost:5173. Vite forwards /api/ and /icons/ to the server.
 */
import { spawn } from "node:child_process";

const win = process.platform === "win32";
const npx = win ? "npx.cmd" : "npx";
const opts = { stdio: "inherit", shell: win };
const children = [
  spawn(npx, ["tsx", "watch", "--env-file-if-exists=.env", "src/server/index.ts"], opts),
  spawn(npx, ["vite"], opts),
];

setTimeout(() => {
  console.log("\n  ➜  Open Hearth at http://localhost:5173  (port 8082 is the API only)\n");
}, 1500);

const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", (code) => code && stop());
