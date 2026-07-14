# Windows Job Intelligence Worker Report

Updated: 2026-07-14

## Repository

- Persistent clone: `C:\Users\Riju\OneDrive_v1\Desktop\personal-site`
- Branch: `codex/windows-job-worker-handoff`
- Handoff commit: `3f52ed854de659e199f39e4d064662c9ff85e9cc`
- Initial working tree: clean

## Measured hardware

- Windows: Microsoft Windows 11 Home Single Language, version `10.0.26200`, build `26200`, 64-bit
- CPU: Intel Core i7-9750H at 2.60 GHz, 6 cores / 12 logical processors
- RAM: 15.85 GiB total; 8.50 GiB available at initial inspection
- GPU: NVIDIA GeForce GTX 1660 Ti, 6,144 MiB dedicated VRAM; Intel UHD Graphics 630 integrated GPU
- Disk: 475.78 GiB `C:` volume; 135.21 GiB free at initial inspection

Qwen3-8B Q4_K_M would leave inadequate headroom in 6 GiB VRAM and 16 GiB system RAM. The selected tier
is Qwen3-4B Q4_K_M with context 8192 and concurrency 1. Qwen3-14B is explicitly rejected in both the
resource guard and installer.

## Installed local runtime

- Model: official `Qwen/Qwen3-4B-GGUF`, file `Qwen3-4B-Q4_K_M.gguf`
- Model bytes: 2,497,280,256
- Model SHA-256: `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`
- llama.cpp: official release `b9987`, Windows x64 Vulkan build
- llama.cpp archive SHA-256: `99520abd3930cbe8ca27e6c992e93df72873eb206694825e1403b401c52f7083`
- Runtime root: `%LOCALAPPDATA%\DiptopalJobWorker`

Sources:

- `https://github.com/ggml-org/llama.cpp/releases/tag/b9987`
- `https://huggingface.co/Qwen/Qwen3-4B-GGUF`

## Security architecture

Vercel is the only database client. Every Windows request requires `Authorization: Bearer
JOBSEARCH_WORKER_TOKEN`; comparisons use fixed-size SHA-256 digests and `timingSafeEqual`. The token is
never accepted in a query string. The worker protocol provides:

- `GET /api/job-search/worker/health`
- `GET /api/job-search/worker/queue`
- `POST /api/job-search/worker/claim`
- `POST /api/job-search/worker/heartbeat`
- `POST /api/job-search/worker/result`
- `POST /api/job-search/worker/failure`
- `POST /api/job-search/worker/discovery-batch`
- `POST /api/job-search/local-queue/hold`
- `POST /api/job-search/local-queue/release`

Claims receive a random lease token and a bounded packet containing only the job, direct evidence,
candidate constraints, and a small set of feedback examples. Heartbeats extend the lease. Completion and
failure require the worker id and lease token. Results use a deterministic digest; safe replay returns the
existing result and a conflicting replay is rejected.

The local worker runs extraction and evaluation as separate schema-constrained passes, then an independent
critic task. Explicit or inferred claims require a source URL and a non-empty supporting passage. Verdicts
and 0-100 scores must be coherent. One bounded correction pass is allowed for invalid JSON, missing
citations, or score/verdict contradictions; unresolved output fails the lease and is not persisted.

`llama-server` is spawned only after a task is claimed and both memory guards pass. It binds to
`127.0.0.1`, uses context 8192, concurrency 1, two CPU threads, eight Vulkan GPU layers, and below-normal process
priority. Only the worker-owned model process is stopped, after five idle minutes, at worker exit, or during the mandatory cooldown.
No firewall rule, tunnel, VPN, or public listener is created.

The PowerShell setup stores the production token as a current-user DPAPI-protected credential and registers
a non-elevated scheduled task only when `-RegisterScheduledTask` is explicitly passed. Separate worker and
collector scripts share the same token boundary and persistent Chromium profile. The production worker is
registered under Task Scheduler and the model remains loopback-only.

The GPU-layer limit is reduced from full offload to 20 after live monitoring observed one recoverable GPU
device-loss event. The worker processes for 120 minutes, cools with the model stopped for 60 minutes, refuses
startup at 68 C or above, and enters cooldown if runtime GPU temperature reaches 78 C. Long model calls are
checked every 15 seconds and cancelled safely at that limit before the leased task is retried. This trades latency for
display, driver, and thermal headroom on the 6 GiB GTX 1660 Ti.

## Preliminary local calibration

Scope: two synthetic jobs and six capped tasks (two triage, two deep, two critic). This is a smoke
calibration of the local architecture, not the 20 owner-labelled job release gate.

- Duration: 242.6 seconds
- Worker exit: clean
- Task leases: 6 completed, all on first attempt
- Positive fixture: triage `relevant`, deep `apply` score 85, critic `apply` and agrees
- Clear-negative engineering fixture: triage `irrelevant`, deep `pass` score 15, critic `pass` and agrees
- Grounded citations: complete for material claims
- Minimum available RAM observed: 4.36 GiB
- Minimum free VRAM observed after model load: 2,918 MiB
- Listener during inference: `127.0.0.1:8080` only
- Listener and model process after exit: none
- Result: PASS for the preliminary synthetic gate

The final machine-local JSON and Markdown reports are stored under
`%LOCALAPPDATA%\DiptopalJobWorker\reports`.

## Verification and remaining gate

The full repository suite must remain green before handoff. Production remains unchanged and the production
backlog remains locked. Before enabling the scheduled worker:

1. Review and deploy the worker endpoint changes through the normal production process.
2. Generate a dedicated high-entropy `JOBSEARCH_WORKER_TOKEN`; store it in Vercel and Windows DPAPI only.
3. Run `setup-job-worker.ps1` and `setup-job-collector.ps1` with the installed llama-server and model
   paths, but do not pass `-RegisterScheduledTask` until deployment and token handoff are complete.
4. Run the required 20 owner-labelled job calibration and verify the precision, false-rejection, citation,
   hallucination, and foreground-memory gates in the handoff document.
5. Use the authenticated queue hold/release controls to dry-run counts, release 20 representative real
   jobs, validate them, then release the remainder only after explicit owner approval.
