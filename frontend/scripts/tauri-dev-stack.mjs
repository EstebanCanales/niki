import { spawn } from "node:child_process";

const packageManager = process.env.npm_execpath?.includes("bun") ? "bun" : "npm";
const args = ["run", "dev"];

const child = spawn(packageManager, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
