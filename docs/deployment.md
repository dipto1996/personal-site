# Deployment

## Local

```bash
npm test
PORT=4180 npm run dev
```

Open `http://localhost:4180`.

## Environment

See `.env.example` and the current runtime usage:

- `DATABASE_URL` for Postgres persistence
- `RESEND_API_KEY` for outbound alert delivery
- `ALERT_FROM_EMAIL` for outbound alert delivery
- `ALERT_DEFAULT_RECIPIENTS` for workspace-wide default alert inboxes
- `LEAD_NOTIFICATION_EMAILS` and `LEAD_FROM_EMAIL` for lead forms
- `STRIPE_SECRET_KEY` for live checkout sessions
- `CRON_SECRET` for protected source-sync jobs
- `APP_URL` for absolute callback and checkout URLs

If `DATABASE_URL` is not set, the app uses local JSON persistence.
The current Vercel production project has live Resend alert delivery configured.
The current Vercel production project also has live Neon/Postgres persistence configured.
If `STRIPE_SECRET_KEY` is not set, billing stays in simulated mode.
If `RESEND_API_KEY` or `ALERT_FROM_EMAIL` is not set, alert delivery falls back to preview mode.

## Vercel

- `vercel.json` rewrites `/api/*` to `api/index.js`
- `api/index.js` and `api/[...route].js` delegate to `server/app.js`
- Static assets are served directly from the repo root
- The same runtime handles local dev and production routes
- Production is live at `https://diptopal-roy-site.vercel.app`
- `TRADEGRAPH_DATA_DIR=/tmp` is set in Vercel so the local JSON fallback can run on the serverless filesystem

## Protected production QA

- The deployment remains behind Vercel Authentication.
- Plain unauthenticated `curl` calls to the production domain will still return `401`.
- Use the supported repo helpers instead:
  - `npm run prod:fetch -- /api/health`
  - `npm run prod:fetch -- /tradegraph/app/verifysme/suppliers.html?supplierId=shoreline-apparel-exim&sector=Apparel`
  - `npm run prod:smoke`
- These helpers call `npx vercel@latest curl ... -- --location`, which lets the Vercel CLI mint a deployment-protection bypass token for the linked project and follow the initial redirect.
- This is the current workaround for the hosted QA blocker without disabling Vercel Authentication on production.
- For external customer demos, use Vercel `Sharable Links` from the deployment dashboard instead of asking prospects to authenticate with Vercel.
- After generating a sharable link, run `npm run demo:links -- 'PASTE_THE_VERCEL_SHARABLE_LINK_HERE'` to produce the exact TradeGraph deep links for the customer demo flow.

## Pre-deploy checks

```bash
npm test
npm run sync:sources
```

Verify:

- `/api/health`
- `/api/config`
- `/api/session`
- `/api/sources`
- `/api/insights/verifysme`
- `/api/insights/tenderradar`
- `/api/insights/exportpulse`
- `/api/udyam-challenge`
- `/api/udyam-verify`
- `/api/alerts`
- `/api/billing`
- `tradegraph/index.html`
- `tradegraph/app/overview.html`
- `tradegraph/app/verifysme/queue.html`
- `tradegraph/app/tenderradar/pipeline.html`
- `tradegraph/app/exportpulse/route-pipeline.html`
- `index.html`
- `work.html`
- `contact.html`

## Production note

- Live billing still depends on `STRIPE_SECRET_KEY`.
- Postgres is optional for local development but is already enabled in the shared deployment.
- Cron delivery depends on `CRON_SECRET` and a scheduled call into the protected sync endpoint.
