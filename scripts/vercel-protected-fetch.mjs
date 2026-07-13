import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const path = args[0] || "/api/health";

const child = spawn("npx", ["-y", "vercel@latest", "curl", path, "--", "--location"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
