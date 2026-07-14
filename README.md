# Diptopal Roy Personal Site + TradeGraph India

This repo runs a production-oriented `TradeGraph India` V2 inside the personal-site nav.

The suite now ships as a product-first subsite under `/tradegraph/`, with three linked products and one shared operations layer:

- Public suite entry on [`/Users/roydi/Desktop/personal_site/tradegraph/index.html`](./tradegraph/index.html)
- `VerifySME` on [`/Users/roydi/Desktop/personal_site/tradegraph/products/verifysme.html`](./tradegraph/products/verifysme.html)
- `TenderRadar` on [`/Users/roydi/Desktop/personal_site/tradegraph/products/tenderradar.html`](./tradegraph/products/tenderradar.html)
- `ExportPulse` on [`/Users/roydi/Desktop/personal_site/tradegraph/products/exportpulse.html`](./tradegraph/products/exportpulse.html)
- Shared app shell and ops surfaces on [`/Users/roydi/Desktop/personal_site/tradegraph/app/overview.html`](./tradegraph/app/overview.html)
- Legacy `solutions.html` and `dashboards.html` now act as redirect gateways into the new subsite

The shared thesis is one SME intelligence graph:
verify the company, qualify the tender, qualify the export route, and keep the workspace state persistent.

## Stack

- Static HTML + CSS + ES modules for the public site
- Node HTTP server in [`/Users/roydi/Desktop/personal_site/server/app.js`](./server/app.js)
- Local JSON persistence by default in `.data/tradegraph-db.json`
- Postgres persistence when `DATABASE_URL` is set
- Workspace-auth layer with cookie sessions and invite-based membership
- Shared control center for alerts, plan state, source sync, and provider status
- Source adapters for `GeM`, `CPPP`, `DGFT`, a maintenance-aware official `Udyam` flow, and an official `MCA` assisted workflow backed by the public OGD company catalog
- Node built-in test runner

## Local run

```bash
npm test
PORT=4317 npm run dev
```

Then open:

- `http://localhost:4317/index.html`
- `http://localhost:4317/job-search.html`
- `http://localhost:4317/tradegraph/index.html`
- `http://localhost:4317/tradegraph/app/overview.html`
- `http://localhost:4317/tradegraph/app/verifysme/queue.html`
- `http://localhost:4317/tradegraph/app/tenderradar/pipeline.html`
- `http://localhost:4317/tradegraph/app/exportpulse/route-pipeline.html`
- `http://localhost:4317/work.html`
- `http://localhost:4317/contact.html`

Hosted production:

- `https://tradegraph-india-site.vercel.app`

Protected production access:

- `npm run prod:fetch -- /api/health`
- `npm run prod:fetch -- /tradegraph/app/verifysme/suppliers.html?supplierId=shoreline-apparel-exim&sector=Apparel`
- `npm run prod:smoke`
- `npm run demo:links -- 'PASTE_THE_VERCEL_SHARABLE_LINK_HERE'`

These commands use `npx vercel@latest curl` so the Vercel CLI can generate a deployment-protection bypass token automatically for this linked project. This is the supported way to run hosted QA against the protected production deployment without disabling Vercel Authentication.

For external customer demos, use a Vercel `Sharable Link` and then run `npm run demo:links ...` to generate the deep-linked TradeGraph demo route set.
The customer-facing walkthrough lives in [`docs/customer-demo-checklist.md`](./docs/customer-demo-checklist.md).

## Useful commands

```bash
npm run sync:sources
curl http://localhost:4317/api/health
curl http://localhost:4317/api/config
curl http://localhost:4317/api/sources
curl http://localhost:4317/api/alerts
curl http://localhost:4317/api/billing
```

## Private job-search tool

The owner-only job-search command center lives at [`/Users/roydi/Desktop/personal_site/job-search.html`](./job-search.html).
It uses the existing site login/session system and allows access only to `JOBSEARCH_OWNER_EMAILS`
unless `JOBSEARCH_ALLOW_ANY_SIGNED_IN=true` is set for local testing.

Core routes:

- `GET /api/job-search/status`
- `GET /api/job-search/jobs`
- `POST /api/job-search/ingest`
- `POST /api/job-search/jobs/:id/feedback`
- `GET /api/job-search/negative-feedback`
- `GET /api/cron/ingest`

Provider environment:

- `DATABASE_URL` for the shared Neon job, lead, queue, and evaluation tables
- `JOBSEARCH_LOCAL_WORKER_ENABLED=true` to make Vercel enqueue bounded local work for the Windows queue
- `SERPAPI_API_KEY`, `BRAVE_SEARCH_API_KEY`, and `TAVILY_API_KEY` as non-blocking cloud discovery fallbacks
- `GROQ_API_KEY`, Cloudflare Workers AI, and OpenRouter as optional free fallback routes
- `CRON_SECRET` for Vercel Cron authorization

The previous Qwen3-14B Mac inference service is disabled because it placed unacceptable pressure on
the Mac's 16 GB unified memory. The next inference target is a dedicated Windows worker using
Qwen3-4B or Qwen3-8B after a hardware benchmark. Cloud model failures must not block the queue.

See [`docs/job-search-windows-handoff.md`](./docs/job-search-windows-handoff.md) for the current
queue state, security boundary, Windows implementation plan, and calibration gates.

### Windows inference worker

The Windows implementation uses an outbound-only HTTPS client. Vercel retains all database access and
exposes bearer-token-protected claim, heartbeat, result, failure, queue, and health routes under
`/api/job-search/worker/*`. The Windows computer receives a bounded evidence packet for one leased task;
it never receives `DATABASE_URL` or provider credentials.

The measured Windows host is approved only for `Qwen3-4B-Q4_K_M`, context 8192, concurrency 1. The
resource guard rejects Qwen3-8B and Qwen3-14B on this host. `llama-server` binds to `127.0.0.1`, runs at
below-normal priority, starts only after a claimed task, and stops after five idle minutes, worker exit, or
the 78 C runtime temperature limit. Startup is blocked at 68 C. The 120-minute active/60-minute cooldown
schedule is a maximum; temperature safety may begin cooldown earlier.

Useful Windows commands:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts/windows/status-job-worker.ps1
powershell.exe -ExecutionPolicy Bypass -File scripts/windows/start-job-worker.ps1
powershell.exe -ExecutionPolicy Bypass -File scripts/windows/stop-job-worker.ps1
powershell.exe -ExecutionPolicy Bypass -File scripts/windows/status-job-collector.ps1
```

Run `scripts/windows/setup-job-worker.ps1` only after the worker endpoints are deployed and a dedicated
`JOBSEARCH_WORKER_TOKEN` is configured in Vercel. It stores the Windows copy with current-user DPAPI and
only registers the scheduled task when `-RegisterScheduledTask` is passed. Do not copy `.env.local` or
the Neon connection string to Windows.

The Windows collector also runs outbound-only and submits bounded discovery batches to
`POST /api/job-search/worker/discovery-batch`. The dashboard and owner controls now expose queue hold
state, and Vercel-only queue migration controls live at:

- `POST /api/job-search/local-queue/hold`
- `POST /api/job-search/local-queue/release`

The implementation and preliminary calibration record is in
[`docs/job-search-windows-report.md`](./docs/job-search-windows-report.md). The two-job synthetic check is
not the 20 owner-labelled job production release gate, so the production backlog remains locked.

Local operations:

```bash
vercel env pull .env.local --environment=production
npm run jobs:collect                 # visible Chrome, LinkedIn supplemental collector
npm run jobs:collect -- --headless --sources=linkedin,wellfound,google,bing  # explicit diagnostics; cloud search remains primary
npm run jobs:model                   # macOS development only; Qwen3-4B loopback helper
npm run jobs:worker                  # existing direct-Neon worker; being replaced for Windows
npm run jobs:install                 # macOS launch agents; do not run on Windows
```

The collector persists raw URLs before title filtering. The initial candidate gate requires a target
function and a target seniority concept, with explicit specialist exceptions. Every candidate can then
receive local triage, deep evaluation, criticism, and outreach drafting without a daily LLM cap.

## What is real now

- Real auth endpoints with password hashing and cookie sessions
- Real shared workspaces with owner/member roles and invite codes
- Workspace-scoped state persistence for VerifySME, TenderRadar, and ExportPulse
- Live source sync for `GeM BidPlus`, `CPPP ePublishing`, and `DGFT Trade Notices`
- Live official `Udyam` verification with captcha loading, ASP.NET session preservation, and enterprise-detail extraction when the government verify page is available
- Official `Udyam` certificate / QR-result import parser for maintenance windows or pre-downloaded government evidence
- Live official `MCA` assisted workflow: parse official Find CIN results, select the legal entity, then paste the master-data result and structure it inside VerifySME
- Product-first page tree with separate use-case pages, product pages, app pages, and ops pages under `/tradegraph/`
- Real chart-ready insight APIs and persisted historical metrics for VerifySME, TenderRadar, and ExportPulse
- Persistent TradeGraph usage analytics with browser-queue fallback, backend event ingestion, and control-center usage summaries
- Runtime status endpoint for database, email, billing, and cron readiness
- Alert rule CRUD, test sends, and scheduled delivery support
- Local billing simulation with a Stripe-backed checkout path when configured
- Browser-verified pages and screenshots from the current build
- Live production deploy on Vercel at `https://tradegraph-india-site.vercel.app`

## Remaining external blocker

- Fully unattended `MCA` scraping is still bot-protected on the official portal, so the V1 ships the honest assisted workflow instead of pretending the captcha does not exist.
- Fully unattended `Udyam` lookup is also constrained by the official captcha/session flow, so the product keeps the honest assisted bridge and falls back to official certificate import when the portal is unavailable.
- Stripe is intentionally still in simulated mode until `STRIPE_SECRET_KEY` is provisioned.
