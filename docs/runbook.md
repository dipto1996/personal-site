# Runbook

## Start the app

```bash
PORT=4180 npm run dev
```

## Seed or refresh live public sources

```bash
npm run sync:sources
```

## Quick API checks

```bash
curl http://localhost:4180/api/health
curl http://localhost:4180/api/config
curl http://localhost:4180/api/session
curl http://localhost:4180/api/sources
curl http://localhost:4180/api/alerts
curl http://localhost:4180/api/billing
```

## Demo flow

1. Open `tradegraph/index.html`
2. Click the workspace chip in the top bar
3. Use `Use demo workspace`
4. Verify source status appears in the modal
5. Open `tradegraph/app/overview.html` and confirm the suite dashboard loads
6. Open the workspace control center and create an alert rule
7. Open `tradegraph/app/verifysme/queue.html`, load the official Udyam captcha, and verify a live registration number
8. In VerifySME, open the official MCA lookup, complete the human captcha, paste the copied master-data result, and confirm the parser renders company details, directors, and charges
9. Open `tradegraph/app/tenderradar/pipeline.html` and shortlist a tender in TenderRadar
10. Open `tradegraph/app/exportpulse/route-pipeline.html` and inspect route planning in ExportPulse

## Operational expectations

- GeM, CPPP, and DGFT should return live records
- MCA should return a live OGD-backed source record with official MCA entry points
- Udyam should show `live`
- Workspace state should persist after refresh when signed in
- Alerts should save in all environments and send live mail whenever `RESEND_API_KEY` and `ALERT_FROM_EMAIL` are configured
- Billing should show the active plan and simulated plan changes when Stripe is not provisioned

## If source sync looks wrong

- Run `npm run sync:sources`
- Inspect `.data/tradegraph-db.json` or the configured Postgres rows
- Check `/api/sources` for the normalized snapshot
- If `Udyam` fails, retry `/api/udyam-challenge` after signing in and confirm the bridge can fetch a new official captcha
- If `MCA` fails, confirm the user pasted the official master-data table output from the MCA portal into VerifySME and test `/api/mca-parse` with the copied content

## If alerts or billing look wrong

- Check `/api/config` for provider status
- Verify `RESEND_API_KEY`, `ALERT_FROM_EMAIL`, `ALERT_DEFAULT_RECIPIENTS`, `STRIPE_SECRET_KEY`, and `CRON_SECRET`
- Confirm the workspace chip is signed in before testing write endpoints
