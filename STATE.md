# State

## Completed

- Reworked the TradeGraph ops routes so every ops page now mounts the real interactive control center instead of reserving the functional surface mostly for the alerts view.
- Added explicit in-product workspace onboarding with direct demo-workspace and workspace-access actions on the overview and ops pages.
- Added route-specific ops runbooks and a workspace-access card so first-time users can understand what to do, what persists, and how to move from guest browsing into a real shared workspace.
- Added route-aware control-center focus styling and listener cleanup so the shared ops module behaves more like a durable product surface than a one-off embedded panel.
- Rewired VerifySME to derive its supplier inventory from live source overlays and bound official evidence instead of relying on the older preset-biased catalog view.
- Added a VerifySME state migration so legacy saved `food packaging` preset state no longer leaks into the default queue, and explicit URL filters now take precedence over persisted workspace filters.
- Added protected-production helper scripts so hosted QA can bypass the Vercel auth wall through the supported `vercel curl` path instead of relying on unauthenticated `curl`.
- Added a sharable-link helper so one Vercel customer-demo URL can be expanded into the exact deep-linked VerifySME, TenderRadar, ExportPulse, and pricing routes for the TradeGraph walkthrough.
- Rewired TenderRadar to derive its opportunity inventory from live `GeM` and `CPPP` source snapshots instead of the older curated catalog-first layer.
- Rewired ExportPulse to derive its route inventory from live `DGFT` notices instead of the older curated catalog-first layer.
- Added a shared live-entity normalization layer in `lib/live-tradegraph.js` so source snapshots become scored tenders, route briefs, and evidence-aware company decisions.
- Applied VerifySME workspace evidence to the live TenderRadar and ExportPulse scoring layer, so bound `Udyam` / `MCA` proofs can improve company confidence inside downstream decisions.
- Fixed the source-sync runtime to load the same environment as the app server, so `npm run sync:sources` and the UI now write/read the same backing store.
- Removed a Postgres read deadlock in `server/persistence.js` by replacing the multi-table transaction read path with sequential reads.
- Verified locally that TenderRadar and ExportPulse now render `source-derived` inventories, live provenance, and source-backed detail views instead of static catalogs.
- Renamed the Vercel project to `diptopal-roy-site`, updated the local Vercel link, refreshed the production `APP_URL`, and bound the new production alias.
- Removed the old `tradegraph-india-site` aliases so the project and deployment naming are now consistent.
- Reworked the TradeGraph shell to sit inside the same site-wide navigation, typography, spacing, and footer system as the rest of the site.
- Added explicit TradeGraph explanation sections for source modes, data types, and one-company walkthroughs so the suite reads like a product and not a generic demo.
- Rebuilt TradeGraph as a product-first subsite under `/tradegraph/` with separate use-case, product, app, and ops pages.
- Added real section hubs for `/tradegraph/use-cases/` and `/tradegraph/products/` so top-level suite navigation lands on structured product areas instead of arbitrary leaf pages.
- Replaced the old mixed `solutions.html` and `dashboards.html` experience with redirect gateways into the new TradeGraph tree.
- Added chart-ready insight APIs and persisted source-history metrics for VerifySME, TenderRadar, and ExportPulse.
- Added persistent TradeGraph analytics ingestion plus backend usage summaries, so product events no longer live only in browser-local telemetry.
- Added a control-center usage analytics card with local-queue fallback and backend summary hydration when a workspace session exists.
- Added product-specific app pages with left-tree navigation, breadcrumbs, and cross-product drill-through.
- Replaced embedded public product-page app mounts with chart-backed workflow framing and direct links into the operational app shell.
- Added a real backend for the TradeGraph suite.
- Implemented registration, login, logout, demo login, cookie sessions, and shared workspaces.
- Implemented invite-based multi-user workspace membership.
- Added workspace control center surfaces for alerts, billing, runtime status, and source sync.
- Added server routes for `/api/config`, `/api/alerts`, `/api/billing`, and protected cron source sync.
- Added same-origin protection and in-memory rate limiting on mutation routes.
- Wired VerifySME, TenderRadar, and ExportPulse to workspace-scoped persistence.
- Added live public-source adapters for GeM, CPPP, DGFT, and the official MCA OGD catalog.
- Added an official captcha-assisted Udyam verification bridge and VerifySME lookup desk.
- Added an official human-captcha-assisted MCA parse route and VerifySME lookup desk.
- Added a maintenance-aware Udyam source state plus an official certificate / QR-result import parser and VerifySME import flow.
- Added an official MCA `Find CIN -> select CIN -> import master data` workflow inside VerifySME.
- Reworked VerifySME into true `queue`, `suppliers`, and `detail` operating modes instead of one mixed module mounted behind multiple URLs.
- Added VerifySME diligence cases with owner, due date, approval state, blocker, next action, internal notes, audit trail, manual supplier intake, and Udyam/MCA evidence binding.
- Reworked TenderRadar into true `pipeline`, `opportunities`, and `detail` operating modes with persisted bid cases and shortlist-driven queue management.
- Reworked ExportPulse into true `route-pipeline`, `markets`, and `detail` operating modes with persisted route cases and execution-focused route queue management.
- Added shared case-card UI primitives for the new operational views.
- Added Postgres-backed persistence with local JSON fallback.
- Deployed the current app to Vercel at `https://diptopal-roy-site.vercel.app`.
- Re-deployed the latest source-driven VerifySME build and repointed the stable alias to deployment `dpl_APCDTtcM4943J9CEVVFGokQc3UdU`.
- Refreshed the hosted source snapshot so production now exposes the live OGD-backed MCA state.
- Enabled live Resend delivery in production with `roydiptopal1996@gmail.com` as the sender.
- Added workspace-wide default alert inboxes so every saved rule includes `arkaprabhagoon95@gmail.com` and `roydiptopal1996@gmail.com`.
- Verified the protected hosted cron route through `/api/cron-source-sync`.
- Restored production to the local JSON fallback after an interrupted Neon password rotation invalidated the old Postgres secret.
- Restored Neon/Postgres persistence in production after the password reset and redeploy.
- Verified the ExportPulse route-pipeline path and the legacy `solutions.html` / `dashboards.html` redirect gateways on production.
- Verified pages with headless Chrome DOM and screenshots.
- Verified the API and alert/billing flows through tests.

## What changed

- `tradegraph/tradegraph.js`
- `tradegraph/index.html`
- `tradegraph/use-cases/index.html`
- `tradegraph/use-cases/*.html`
- `tradegraph/products/index.html`
- `tradegraph/products/*.html`
- `tradegraph/app/**/*.html`
- `server/app.js`, `server/auth.js`, `server/workspaces.js`, `server/source-adapters.js`, `server/persistence.js`
- `server/config.js`, `server/alerts.js`, `server/billing.js`
- `server/mca.js`, `server/insights.js`, `server/source-metrics.js`
- `server/run-source-sync.js`
- `server/udyam.js`
- `lib/live-tradegraph.js`
- `lib/workspace-client.js`
- `apps/verifysme/index.js`
- `apps/tenderradar/index.js`
- `apps/exportpulse/index.js`
- `tests/verifysme.test.js`
- `tests/tenderradar.test.js`
- `tests/exportpulse.test.js`
- `apps/tradegraph/ui/control-center.js`
- `apps/tradegraph/ui/insights.js`
- `script.js`
- `styles.css`
- docs, redirects, backend, parser, insight, alert, billing, and workspace tests

## Assumptions made

- Invite-code sharing is sufficient for V1 collaboration.
- Local JSON is an acceptable default persistence mode until a real hosted DB is provisioned.
- Honest restricted-source states are better than fake live claims.
- The Udyam integration must preserve the government captcha and session flow instead of bypassing it.
- If the Udyam portal is under maintenance, the honest fallback is official certificate import rather than pretending the live verify page still works.
- Billing can stay in simulated mode when Stripe is unavailable, while preserving the same API shape.
- Alert rules are more valuable than a generic notification center for this wedge.
- Production can safely fall back to local JSON persistence on Vercel during provider incidents without taking the whole app offline.
- Workspace-scoped case records are a valid V1 operator layer even before a larger warehouse or raw-data lake exists.
- `GeM`, `CPPP`, and `DGFT` source payloads are now rich enough to drive useful operator dashboards even before raw object storage is introduced.

## Risks remaining

- Fully unattended MCA scraping is still blocked by the official portal and OGD access controls.
- Fully unattended Udyam verification is still constrained by the official captcha/session boundary.
- The live Udyam verify page can temporarily disappear behind maintenance windows, so the source state and UI must handle that explicitly.
- The local JSON persistence fallback is safe for continuity, not for long-lived concurrent production workloads.
- Stripe still needs live provisioning before billing exits simulated mode.
- Anonymous hosted API verification is limited by the Vercel auth wall, so browser/API checks for production still require a signed-in Vercel session.

## Tests run

- `npm test`
- `vercel deploy --prod --yes`
- `vercel alias set https://diptopal-roy-site-8kx6ksbcq-jambi007s-projects.vercel.app diptopal-roy-site.vercel.app`
- `npm run prod:fetch -- /api/health`
- `npm run prod:smoke`
- `npm run demo:links -- 'https://diptopal-roy-site.vercel.app/?_vercel_share=dummy-demo-token'`
- `npm run sync:sources`
- local `GET /api/insights/tenderradar?profileId=solargrid` verification showing `source-derived` mode and live `GeM` / `CPPP` entities
- local `GET /api/insights/exportpulse?profileId=gcc-packaging` verification showing `source-derived` mode and live `DGFT` route briefs
- local `GET /api/insights/verifysme?profileId=shoreline-apparel-exim&sector=Apparel&exportReadyOnly=true` verification showing `source-derived` supplier entities with live route matches
- local `/api/udyam-certificate-parse` verification against copied official certificate content
- local `/api/mca-find-cin-parse` verification against copied official Find CIN content
- source-sync verification showing `udyam: maintenance` and `mca: live` on 2026-03-31 / 2026-04-01
- live `/api/mca-parse` verification against copied official MCA master-data content
- hosted `POST /api/cron-source-sync` verification on `https://diptopal-roy-site.vercel.app`
- hosted Postgres restore verification on `https://diptopal-roy-site.vercel.app/api/health` and `/api/config`
- hosted `POST /api/mca-parse` verification on `https://diptopal-roy-site.vercel.app`
- hosted `POST /api/demo-login` + `POST /api/alerts` verification on `https://diptopal-roy-site.vercel.app`, including default-recipient expansion
- hosted `POST /api/alert-test?id=...` verification on `https://diptopal-roy-site.vercel.app`, including live email delivery from the restored Postgres-backed runtime
- hosted redirect sanity checks on `https://diptopal-roy-site.vercel.app/solutions.html`, `https://diptopal-roy-site.vercel.app/dashboards.html`, and `https://diptopal-roy-site.vercel.app/tradegraph/app/exportpulse/route-pipeline`
- headless Chrome DOM verification on `tradegraph/index.html`
- headless Chrome DOM verification on `tradegraph/app/verifysme/queue.html`
- headless Chrome DOM verification on `tradegraph/app/verifysme/suppliers.html`
- headless Chrome DOM verification on `tradegraph/app/verifysme/supplier-detail.html`
- headless Chrome verification showing VerifySME deep links now preserve explicit route filters without re-injecting the legacy preset query
- headless Chrome DOM verification on `tradegraph/app/tenderradar/pipeline.html`
- headless Chrome DOM verification on `tradegraph/app/tenderradar/opportunities.html` with live `source-derived` inventory
- headless Chrome DOM verification on `tradegraph/app/tenderradar/opportunity-detail.html`
- headless Chrome DOM verification on `tradegraph/app/exportpulse/route-pipeline.html`
- headless Chrome DOM verification on `tradegraph/app/exportpulse/markets.html` with live `source-derived` route inventory
- headless Chrome DOM verification on `tradegraph/app/exportpulse/route-detail.html`
- headless Chrome screenshots for the updated product pages
- hosted API verification on `https://diptopal-roy-site.vercel.app/api/health`
- hosted API verification on `https://diptopal-roy-site.vercel.app/api/config`
- hosted API verification on `https://diptopal-roy-site.vercel.app/api/billing`
- `vercel inspect diptopal-roy-site.vercel.app` verification showing the stable alias now resolves to deployment `dpl_APCDTtcM4943J9CEVVFGokQc3UdU`
- hosted QA verification through `npx vercel@latest curl` showing protected production health, runtime, session bootstrap, and product page shells can be fetched behind Vercel Authentication
- sharable-link helper verification showing one protected Vercel link can be expanded into customer-ready deep links for the full TradeGraph demo sequence

## Next

- Run a signed-in browser QA pass through the newly hardened overview plus ops flows, including demo activation, source sync, alert creation, and billing-plan transitions.
- Replace the assisted MCA flow only if a sanctioned unattended lookup path becomes available.
- Provision `STRIPE_SECRET_KEY` when billing should exit simulated mode.
