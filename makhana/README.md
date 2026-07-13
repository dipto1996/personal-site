# Makhanamart Site

Multi-page public site for the makhana trading business.

## Pages

- `index.html`: brand, positioning, trade model
- `story.html`: crop story, process, nutrition
- `trade.html`: grades, buyer flow, seller flow, contact
- `desk.html`: private lead desk for reviewing inquiries

## Preview locally

From the repo root:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:4173/makhana/
```

If port `4173` is already in use:

```bash
PORT=4180 npm run dev
```

The Node dev server is the preferred preview path because it serves both the
static pages and the `/api/makhana-leads` endpoint.

For a quick static-only preview without forms:

```bash
python3 -m http.server 4173
```

## Deployment model

The site is designed to deploy cleanly on Vercel:

- static pages from the `makhana/` folder
- env-driven public config from `/api/makhana-public-config.js`
- serverless lead endpoint at `/api/makhana-leads`
- optional Neon persistence via `DATABASE_URL`
- optional email notifications via Resend

## Environment variables

See [`/.env.example`](/Users/roydi/Desktop/personal_site/.env.example)
and local defaults in [`/.env.local`](/Users/roydi/Desktop/personal_site/.env.local).

- `MAKHANAMART_BRAND_NAME`
- `MAKHANAMART_SUPPORT_PHONE`
- `MAKHANAMART_SUPPORT_WHATSAPP`
- `MAKHANAMART_DASHBOARD_KEY`
- `DATABASE_URL`
- `RESEND_API_KEY`
- `LEAD_NOTIFICATION_EMAILS`
- `LEAD_FROM_EMAIL`

## Lead capture flow

On deployment:

1. buyer or seller submits the form on `trade.html`
2. request posts to `/api/makhana-leads`
3. lead is inserted into Neon if `DATABASE_URL` is configured
4. email notification is sent if Resend env vars are configured

The private lead desk reads from the same endpoint with a dashboard key:

- set `MAKHANAMART_DASHBOARD_KEY`
- open `/makhana/desk`
- enter the key to review recent buyer and seller leads

Without backend env vars, the frontend still falls back to email draft behaviour.

## Research notes

- buyer and channel leads: [`research/buyer-leads.md`](./research/buyer-leads.md)
- launch and outreach notes: [`launch-kit.md`](./launch-kit.md)
