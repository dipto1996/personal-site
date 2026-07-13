# Changelog

## 2026-04-18

- Reworked the TradeGraph ops routes so `sources`, `alerts`, `billing`, and `workspace` all mount the same interactive control center instead of leaving non-alert routes as mostly static summary screens.
- Added explicit workspace onboarding inside the product shell, including direct `Use demo workspace` and `Open workspace access` actions on the overview and ops pages.
- Added route-specific ops runbooks so each control page now explains what the operator should do there and where to go next.
- Added a workspace access card inside the shared control center showing guest vs signed-in mode, persistence scope, member context, analytics mode, and the next action for activation.
- Added route-aware focus styling in the control center so the relevant card is emphasized on each ops page.
- Hardened the shared control-center mount path by cleaning up global analytics listeners between remounts.

## 2026-03-29

- Added a Node backend and API surface for TradeGraph.
- Added cookie-based auth, demo login, and workspace creation.
- Added invite-based shared workspaces with owner/member roles.
- Added workspace-scoped state persistence for VerifySME, TenderRadar, and ExportPulse.
- Added live source sync for GeM BidPlus, CPPP ePublishing, and DGFT Trade Notices.
- Added MCA service-directory adapter and official captcha-assisted Udyam verification.
- Added Postgres-backed persistence with local JSON fallback.
- Added `/api/config`, `/api/alerts`, `/api/billing`, and protected cron source-sync routes.
- Added shared workspace control center for alerts, plan state, provider status, and source refresh.
- Integrated auth and source controls into the site top bar.
- Surfaced live source status inside VerifySME, TenderRadar, and ExportPulse.
- Added VerifySME Udyam lookup UI, backend bridge, and live verification routes.
- Added same-origin mutation protection and in-memory rate limiting for sensitive routes.
- Added backend parser, Udyam, billing, alert, and auth/workspace tests.
- Updated deployment, architecture, runbook, analytics, and final-audit docs to match the current implementation.
- Linked the repo to Vercel and deployed production at `https://diptopal-roy-site.vercel.app`.

## 2026-03-30

- Replaced the earlier MCA placeholder with an official assisted workflow backed by the public OGD MCA company catalog.
- Added `server/mca.js` with CIN normalization, OGD catalog metric parsing, and official MCA master-data parsing for copied portal output.
- Added authenticated MCA parse routes at `/api/sources/mca/parse` and `/api/mca-parse`.
- Updated the MCA source adapter to report the live OGD-backed source state and official MCA entry points instead of pretending unattended company scraping works.
- Added a VerifySME MCA desk that links to the official portal, accepts copied master-data output, and structures directors, charges, and company details in the workspace.
- Added MCA parsing coverage to the backend and API test suites.
- Deployed the MCA fix to production and refreshed the hosted source snapshot so `https://diptopal-roy-site.vercel.app` now serves the updated MCA workflow.

## 2026-03-31

- Added persistent TradeGraph analytics ingestion at `/api/analytics/events` plus summary reporting at `/api/analytics/summary`, backed by the shared JSON/Postgres persistence layer.
- Added a browser-resilient analytics queue in `apps/tradegraph/lib/analytics.js` so product events fall back locally when the backend is unavailable and sync automatically when it is reachable.
- Added a control-center usage analytics surface so workspace operations now show tracked event volume, grouped usage signals, pending sync count, synced count, and recent activity.
- Replaced the remaining catalog-first VerifySME list view with a source-driven supplier inventory that overlays live tender/export demand traces and bound official evidence onto supplier entities.
- Replaced the older catalog-first TenderRadar inventory with a live `GeM` + `CPPP` entity layer that normalizes public-source snapshots directly into ranked tender opportunities.
- Replaced the older catalog-first ExportPulse inventory with a live `DGFT` entity layer that normalizes public trade notices directly into scored route briefs.
- Added `lib/live-tradegraph.js` to convert public-source snapshots into normalized tender and export entities with provenance, thresholds, and explanation text.
- Applied VerifySME `Udyam` / `MCA` evidence to VerifySME, TenderRadar, and ExportPulse scoring so official proofs now influence every source-driven decision layer.
- Updated `server/source-metrics.js` and `server/insights.js` so persisted metrics and `/api/insights/tenderradar` + `/api/insights/exportpulse` are driven by live source inventories instead of static catalogs.
- Updated `/api/insights/verifysme` and VerifySME rendering so supplier cards, dossier evidence, and cross-product links now come from the source-derived inventory.
- Fixed `npm run sync:sources` to load the same environment as the app server, eliminating the split-store bug where sync writes and UI reads could diverge.
- Removed a Postgres deadlock in the multi-table read path by replacing transactional reads with sequential reads in `server/persistence.js`.
- Added a VerifySME state migration so legacy saved preset filters no longer re-inject `food packaging` into deep links, and explicit route filters now win over persisted state.
- Added regression coverage for the source-driven VerifySME supplier inventory and neutral default filters, bringing the passing test count to `53/53`.
- Added protected-production helpers at `npm run prod:fetch` and `npm run prod:smoke`, using `npx vercel@latest curl` to generate deployment-protection bypass tokens automatically for hosted QA behind the Vercel auth wall.
- Added `npm run demo:links` plus `docs/customer-demo-access.md` so one Vercel Sharable Link can be expanded into the exact deep-linked TradeGraph customer demo route set.
- Renamed the Vercel project from `tradegraph-india-site` to `diptopal-roy-site`, updated the local project link, refreshed the production `APP_URL`, and rebound the live alias.
- Removed the stale `tradegraph-india-site` aliases so deployment naming now matches the project name cleanly.
- Reworked the TradeGraph shell to use the same site-wide brand chrome, typography, and visual language as the rest of the personal site.
- Added clearer on-page explanations for what TradeGraph does, what data exists today, how the sources are acquired, and how one company flows through the three modules.
- Added `ALERT_DEFAULT_RECIPIENTS` support so every saved alert automatically includes the ops inboxes.
- Updated the workspace control center copy to reflect optional additional recipients and visible recipient counts.
- Switched the API tests to the flat production-safe auth and billing aliases and added coverage for default-recipient expansion.
- Cleaned up stale route and provisioning references in the runbook, integrations guide, deployment guide, README, and final audit.
- Enabled protected cron verification through the flat `/api/cron-source-sync` alias on production.
- Restored production availability on the local JSON fallback after an interrupted Neon password rotation invalidated the old Postgres secret.
- Restored live Neon/Postgres persistence in production after the password reset and redeploy.
- Rebuilt TradeGraph into a product-first `/tradegraph/` subsite with dedicated use-case, product, app, and ops routes.
- Added persisted insight APIs and chart-backed dashboards for VerifySME, TenderRadar, and ExportPulse.
- Converted `solutions.html` and `dashboards.html` into redirect gateways so the new tree is the primary experience.
- Added `/tradegraph/use-cases/index.html` and `/tradegraph/products/index.html` so top-level suite navigation lands on real section hubs.
- Replaced embedded product-page app mounts with chart-backed workflow framing and direct routes into the operational app shell.
- Added a maintenance-aware Udyam source probe so the product now reports the official portal maintenance window honestly instead of showing a generic restricted error.
- Added `parseUdyamImportedRecord` and `/api/udyam-certificate-parse` so VerifySME can import copied official Udyam certificate or QR-result content when the live verify page is unavailable.
- Added `parseMcaFindCinResults` and `/api/mca-find-cin-parse` so VerifySME can parse official MCA Find CIN results before the user opens the master-data page.
- Reworked the VerifySME government-evidence desk so Udyam and MCA now follow a cleaner operator workflow: live verify when possible, otherwise import official evidence, then structure the record inside the workspace.
- Expanded the regression suite to cover Udyam certificate parsing, MCA Find CIN parsing, and the new API routes, bringing the passing count to `41/41`.
- Reworked VerifySME into route-specific `queue`, `suppliers`, and `detail` modes instead of mounting one oversized screen behind multiple URLs.
- Added VerifySME diligence cases with owner, due date, approval state, blocker, next action, internal notes, audit trail, manual supplier intake, and official evidence binding for Udyam/MCA results.
- Reworked TenderRadar into route-specific `pipeline`, `opportunities`, and `detail` modes with persisted bid cases and shortlist-driven queue management.
- Reworked ExportPulse into route-specific `route-pipeline`, `markets`, and `detail` modes with persisted route cases and execution-focused route queue management.
- Added shared case-card UI primitives and new view-helper coverage in the regression suite, bringing the passing count to `48/48`.
