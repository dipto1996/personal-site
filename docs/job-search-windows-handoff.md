# Windows Job-Search Worker Handoff

Updated: 2026-07-13

## Objective

Run open-source job evaluation on the dedicated Windows computer without exposing that computer to
the public internet and without putting the Neon administrator connection string on it. Vercel and
Neon remain the control plane; Windows becomes an outbound-only inference worker.

## Production State

- Site: `https://tradegraph-india-site.vercel.app/job-search.html`
- Vercel team: `jambi007s-projects`
- Vercel project: `diptopal-roy-site`
- Database: existing Neon `js_*` tables
- Jobs stored: 176
- Initial triage complete: 135
- Deep evaluations complete: 34
- Critic evaluations complete: 5
- Existing local deep tasks: 25 complete, 99 queued, 3 retry
- Existing critic tasks: 29 queued
- Existing outreach tasks: 4 queued

The counts are a point-in-time snapshot and can increase as discovery continues.

## Safety Status

- The Qwen3-14B `llama.cpp` service on the Mac is stopped and its LaunchAgent is unloaded.
- The 14B model file is local to the Mac and is not part of this repository.
- Never restart the 14B Mac service or run `npm run jobs:install` on Windows.
- Do not copy `.env.local`, `.vercel`, `.codex`, API keys, database URLs, model files, or logs between
  computers.

## Target Architecture

1. Add owner-protected worker endpoints under `/api/job-search/worker/*` for claim, heartbeat,
   completion, failure, and health.
2. Authenticate every worker request with a dedicated `JOBSEARCH_WORKER_TOKEN` stored encrypted in
   Vercel and protected on Windows.
3. Keep all Neon access inside Vercel. The Windows worker receives only the job and evidence packet
   needed for one leased task.
4. Bind `llama.cpp` to `127.0.0.1`; no inbound firewall rule, public listener, VPN, or tunnel.
5. Process one task at a time with idempotent leases. Retry interrupted work without duplicating
   completed evaluations.
6. Start the model only when the queue contains work and stop it after five idle minutes.

## Model Decision

Inspect Windows RAM, CPU, GPU, and VRAM before downloading a model.

- Use Qwen3-4B Q4_K_M with a 4K context for a 16 GB CPU or integrated-GPU machine.
- Prefer Qwen3-8B Q4_K_M with a 4K context when an NVIDIA GPU has sufficient VRAM.
- Do not use a local model on an 8 GB machine.
- Never select or download a larger model automatically.

Runtime guardrails:

- Context: 4096 tokens maximum
- Concurrency: 1
- Low process priority
- Explicit input and output token limits per pass
- Available-memory check before model startup and before each task
- Circuit breaker when the model is unhealthy
- Periodic heartbeat during generation
- Automatic idle shutdown

## Reasoning Pipeline

Keep research collection separate from model reasoning:

1. Direct sources collect the job page, company facts, compensation, location, remote, and
   sponsorship evidence.
2. Deterministic code compresses evidence into a bounded packet and preserves unknown facts.
3. The local model runs structured extraction and deep profile-fit evaluation.
4. A short critic pass challenges unsupported claims and optimistic scores.
5. Outreach drafting runs only for strong candidates.

The model must never invent missing compensation, visa, remote, or interview evidence.

## Windows Deliverables

- `scripts/windows/install-job-worker.ps1`
- `scripts/windows/start-job-worker.ps1`
- `scripts/windows/uninstall-job-worker.ps1`
- HTTP-mode worker client with lease recovery and local health checks
- Windows Scheduled Task registration
- Protected credential storage
- On-demand `llama.cpp` lifecycle management
- Hardware inventory and benchmark report
- 20-job calibration report

## Calibration Gate

Do not release the production backlog until the Windows model achieves:

- At least 80% precision in the owner-labelled top 10
- No more than 10% false rejection of owner-labelled positives
- Complete citations for material eligibility claims
- No invented visa, compensation, location, remote, or interview facts
- Stable memory use while the Windows machine performs ordinary foreground work

## Relevant Code

- `server/job-search/workflow.js`: prompts and evaluation persistence
- `server/job-search/providers.js`: model routing and structured output
- `server/job-search/repository.js`: normalized tables and durable queue
- `scripts/job-search-local-worker.mjs`: existing direct-Neon worker to replace
- `scripts/job-search-local-collector.mjs`: metadata-first discovery
- `server/job-search/title-ontology.js`: function and seniority candidate gate
- `apps/jobsearch/index.js`: owner dashboard
- `tests/job-search.test.js`: queue, provider, auth, and evaluation coverage

## First Windows Task

1. Verify this branch and repository state.
2. Report hardware before downloading anything.
3. Implement the token-authenticated worker boundary and Windows scripts.
4. Run tests without starting a model.
5. Present the model choice and expected memory budget for approval.
6. Download and benchmark only the approved model.
