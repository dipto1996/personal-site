#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { parse } from "dotenv";

const root = process.cwd();
const runtime = path.join(os.homedir(), ".diptopal-job-search", "runtime");
const env = parse(await readFile(path.join(root, ".env.local")));

if (!env.DATABASE_URL) throw new Error("DATABASE_URL is missing from .env.local.");

await mkdir(runtime, { recursive: true });
for (const item of ["server", "scripts", "node_modules"]) {
  await rm(path.join(runtime, item), { recursive: true, force: true });
}
await mkdir(path.join(runtime, "server"), { recursive: true });
await mkdir(path.join(runtime, "scripts"), { recursive: true });
await cp(path.join(root, "server", "job-search"), path.join(runtime, "server", "job-search"), { recursive: true });
await cp(path.join(root, "scripts", "job-search-local-worker.mjs"), path.join(runtime, "scripts", "job-search-local-worker.mjs"));
await cp(path.join(root, "scripts", "job-search-local-collector.mjs"), path.join(runtime, "scripts", "job-search-local-collector.mjs"));
await cp(path.join(root, "scripts", "start-job-search-llm.sh"), path.join(runtime, "scripts", "start-job-search-llm.sh"));
await cp(path.join(root, "node_modules"), path.join(runtime, "node_modules"), { recursive: true });
await cp(path.join(root, "package.json"), path.join(runtime, "package.json"));
await cp(path.join(root, "package-lock.json"), path.join(runtime, "package-lock.json"));

const runtimeEnv = [
  `DATABASE_URL=${JSON.stringify(env.DATABASE_URL)}`,
  "JOBSEARCH_LOCAL_LLM_BASE_URL=http://127.0.0.1:8080/v1",
  "JOBSEARCH_LOCAL_LLM_MODEL=qwen3-14b",
  "JOBSEARCH_LOCAL_WORKER_ENABLED=true",
  "",
].join("\n");
const envPath = path.join(runtime, ".env.local");
await writeFile(envPath, runtimeEnv, { mode: 0o600 });
await chmod(envPath, 0o600);
