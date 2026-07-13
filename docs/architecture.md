# Architecture

## Runtime shape

- Public shell:
  - `index.html`, `work.html`, `contact.html`
  - `tradegraph/index.html`
  - `tradegraph/use-cases/*.html`
  - `tradegraph/products/*.html`
  - `tradegraph/pricing.html`
  - `tradegraph/docs.html`
- App shell:
  - `tradegraph/app/overview.html`
  - `tradegraph/app/verifysme/*.html`
  - `tradegraph/app/tenderradar/*.html`
  - `tradegraph/app/exportpulse/*.html`
  - `tradegraph/app/ops/*.html`
- Legacy redirect gateways:
  - `solutions.html`
  - `dashboards.html`
- Client modules:
  - `apps/verifysme/index.js`
  - `apps/tenderradar/index.js`
  - `apps/exportpulse/index.js`
  - `apps/companygraph/index.js`
  - `apps/tradegraph/ui/control-center.js`
  - `apps/tradegraph/ui/insights.js`
- Backend:
  - `server/app.js`
  - `server/auth.js`
  - `server/workspaces.js`
  - `server/source-adapters.js`
  - `server/source-metrics.js`
  - `server/insights.js`
  - `server/mca.js`
  - `server/persistence.js`
  - `server/alerts.js`
  - `server/billing.js`
  - `server/config.js`

## Request flow

- Browser requests hit the same Node request handler in local dev and on Vercel.
- Static pages are served directly from the repo root.
- `/api/*` routes provide auth, workspace state, sources, alerts, billing, runtime status, cron-safe sync, assisted official parsing utilities, and chart-ready insight payloads.
- The top-bar auth chip mounts shared workspace controls into every page.

## Persistence model

- Default mode: local JSON in `.data/tradegraph-db.json`
- Optional production mode: Postgres via `DATABASE_URL`
- Stored entities:
  - users
  - sessions
  - workspaces
  - workspace memberships
  - workspace invites
  - workspace state blobs
  - source snapshots
  - source history
  - daily metrics
  - normalized live tender entities derived from `GeM` + `CPPP`
  - normalized live export route entities derived from `DGFT`
  - alert rules
  - subscriptions

## Auth and workspaces

- Cookie session name: `tradegraph_session`
- Password hashing: PBKDF2 SHA-512
- Session TTL: 14 days
- Workspace model:
  - owner creates workspace
  - owner/admin generates invite
  - invited user joins as member
  - each workspace has isolated product state, alerts, and subscription state

## Source adapter boundary

- Live now:
  - GeM BidPlus global bids
  - CPPP ePublishing tenders by date
  - DGFT trade notices
  - Udyam captcha-assisted company verification via `server/udyam.js`
  - MCA OGD catalog health and assisted company master-data parsing via `server/mca.js`
- Assisted:
  - MCA company-level master-data lookup remains human-in-the-loop through the official portal captcha and lookup flow
- Restricted:
  - fully unattended MCA company scraping beyond the assisted portal workflow
- Adapters store normalized snapshots in `sources` and expose summaries through `/api/sources`
- `lib/live-tradegraph.js` converts those snapshots into product-facing entities:
  - VerifySME supplier overlays from live source traces plus bound `Udyam` / `MCA` evidence
  - TenderRadar opportunities from `GeM` + `CPPP`
  - ExportPulse route briefs from `DGFT`
- Adapters also append history and daily metrics so the dashboards can render real trend data through:
  - `/api/insights/verifysme`
  - `/api/insights/tenderradar`
  - `/api/insights/exportpulse`

## Source-driven product layer

- VerifySME, TenderRadar, and ExportPulse no longer depend on the earlier curated catalogs as their primary inventory when live source snapshots are available.
- The current decision flow is:
  - `source snapshot -> normalized live entity -> profile fit analysis -> evidence-aware score -> dashboard/detail view`
- Fallback demo catalogs still exist only when a live source is unavailable or when a route requires a non-source-backed demo fixture.
- VerifySME still remains an assisted-evidence product at the government-bound edge:
  - supplier ranking is source-derived when live public traces exist
  - `Udyam` and `MCA` proofs are still captured through official assisted flows
  - workspace-scoped diligence cases and supplier records remain the operator layer on top

## Assisted MCA flow

- VerifySME links the user to:
  - `https://www.mca.gov.in/mcafoportal/findCIN.do`
  - `https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do`
- The user completes the official captcha and lookup on the government site.
- The copied master-data output is posted to `/api/mca-parse`.
- `server/mca.js` structures company details, directors, and charges locally inside the workspace.
- This keeps the government anti-bot boundary intact while still giving the customer a usable product workflow.

## Alerts and billing

- Alert rules are stored per workspace and filtered against source snapshots.
- Test sends and scheduled delivery use the same matching logic.
- Billing is environment-backed:
  - `STRIPE_SECRET_KEY` enables live checkout sessions
  - otherwise the workspace uses a local simulated plan change
- Resend-backed delivery uses `RESEND_API_KEY` and `ALERT_FROM_EMAIL` when configured.

## Frontend state contract

- Each product writes one workspace-scoped blob:
  - `verifysme.workspace`
  - `tenderradar.workspace`
  - `exportpulse.workspace`
- Fallback remains available in browser storage when a user is not signed in
- Auth/session, source, alert, billing, and runtime updates are pushed to the browser through lightweight custom events:
  - `tradegraph:session-changed`
  - `tradegraph:sources-updated`
  - `tradegraph:alerts-updated`
  - `tradegraph:billing-updated`
  - `tradegraph:runtime-updated`

## Deployment shape

- Local dev: `node server/dev-server.js`
- Vercel: `api/index.js` delegates to the same request handler, with `vercel.json` rewriting `/api/*`
