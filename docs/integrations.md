# Integrations

This file documents how the current public-data integrations work in TradeGraph India.

It is intentionally safe to keep in the repo:

- it includes `integration technique`
- it includes `required secret names`
- it includes `official endpoints and routes`
- it does **not** store live private credential values

If you explicitly want a separate non-repo secret handoff document, generate that outside version control.

## Integration matrix

| Source | Purpose | Technique | Human step | API key / secret | App route(s) | Code |
| --- | --- | --- | --- | --- | --- | --- |
| Udyam | Verify MSME registration details | Server-side ASP.NET session preservation for live verify, plus official certificate / QR-result import parser when the portal is unavailable | Yes, captcha entry for live verify. Copy-paste for certificate import. | No API key. No sanctioned public API currently used. | `/api/udyam-challenge`, `/api/udyam-verify`, `/api/udyam-certificate-parse` with compatibility support for `/api/sources/udyam/*` | `server/udyam.js` |
| MCA | Company master-data lookup | Public OGD catalog for source health plus assisted official portal lookup, Find CIN parser, and local master-data parser | Yes, official portal captcha and copy-paste of result | No API key in use. No sanctioned unattended API currently used. | `/api/mca-find-cin-parse`, `/api/mca-parse` with compatibility support for `/api/sources/mca/*` | `server/mca.js` |
| GeM BidPlus | Global tender feed | Public page/data fetch and HTML or payload normalization | No | No API key | `/api/sources`, `/api/source-sync` | `server/source-adapters.js` |
| CPPP ePublishing | Tender-by-date feed | Public date-based page fetch and HTML table parsing | No | No API key | `/api/sources`, `/api/source-sync` | `server/source-adapters.js` |
| DGFT Trade Notices | Trade policy notices | Public notices page fetch and link extraction | No | No API key | `/api/sources`, `/api/source-sync` | `server/source-adapters.js` |

## Udyam

### Official endpoints

- `https://udyamregistration.gov.in/Udyam_Verify.aspx`
- `https://udyamregistration.gov.in/PrintUdyamApplication.aspx`
- `https://udyamregistration.gov.in/verifyudyambarcode.aspx`
- captcha image path discovered during live session handling inside the official site

### Technique

The app uses a `server-side bridge` in `server/udyam.js`:

1. request the official Udyam verify page
2. capture ASP.NET hidden fields and the session cookie
3. request the live captcha image from the official flow
4. return a temporary challenge token plus captcha image to the frontend
5. submit the user-entered Udyam number and captcha back through the same preserved server-side session
6. parse the returned enterprise details into structured JSON

The app also supports an `official import path`:

1. if the live Udyam verify page is unavailable or the user already has the official evidence
2. copy the official certificate text / HTML or copied QR-result page content
3. send that content to `/api/udyam-certificate-parse`
4. structure the enterprise details locally inside VerifySME

### Why this approach

- It keeps the official captcha and session boundary intact.
- It avoids pretending there is a clean public API when there is not.
- It is customer-demo safe because the workflow is real.

### API key / secret

- `No API key`
- `No sanctioned public API token`

### Notes

- This is the correct V1 integration.
- On March 31, 2026 the public Udyam portal was returning a maintenance notice from the root page and the source adapter now reports that state honestly.
- VerifySME still works during that window because the official certificate / QR-result import path remains available.
- If a sanctioned Udyam API becomes available later, swap the bridge behind the same app contract.

## MCA

### Official endpoints

- `https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do`
- `https://www.mca.gov.in/mcafoportal/findCIN.do`
- `https://www.data.gov.in/catalog/company-master-data`
- `https://www.data.gov.in/resource/registrars-companies-roc-wise-company-master-data`

### Technique

The current MCA integration is `assisted`, not unattended:

1. use the public OGD catalog and resource pages to confirm that MCA master data is publicly published and current
2. expose that status in `/api/sources`
3. send the user to the official `Find CIN` flow first
4. the user copies the official result table and VerifySME parses it through `/api/mca-find-cin-parse`
5. the user selects the right CIN inside VerifySME
6. the user completes the official captcha and lookup in the MCA portal for that CIN
7. the user pastes the official master-data result content into VerifySME
8. `server/mca.js` parses the content into:
   - company details
   - directors or signatories
   - charge table

### Why this approach

- The official MCA site is bot-protected.
- A fake “fully automatic” integration would be brittle and misleading.
- The assisted workflow is real, demoable, and legally safer.

### API key / secret

- `No API key in production use`
- `No sanctioned unattended MCA API in current use`

### Important note

Do not depend on undocumented frontend keys or scraped internal endpoints from public websites for the product contract. Those are unstable and not treated as sanctioned integration surfaces.

## GeM BidPlus

### Official endpoint family

- `https://bidplus-global.gem.gov.in/`
- public global-bids data endpoint used by `server/source-adapters.js`

### Technique

1. fetch the public bid feed
2. normalize bid ids, departments, categories, and document links
3. store normalized source snapshots
4. surface the result in TenderRadar and workspace alerts

### API key / secret

- `No API key`

## CPPP ePublishing

### Official endpoint family

- `https://eprocure.gov.in/epublish/app`

### Technique

1. request public tender listings by date
2. parse the returned HTML table rows
3. normalize tender metadata into source snapshots
4. expose results to TenderRadar and alert rules

### API key / secret

- `No API key`

## DGFT Trade Notices

### Official endpoint family

- `https://www.dgft.gov.in/CP/?opt=trade-notice`

### Technique

1. fetch the public trade-notice page
2. extract notice number, title, date, and PDF link
3. normalize into ExportPulse source snapshots

### API key / secret

- `No API key`

## App-level secrets

These are not source-provider keys, but they are required for the full hosted product.

| Secret | Required for | Where used |
| --- | --- | --- |
| `DATABASE_URL` | Postgres persistence | `server/persistence.js` |
| `RESEND_API_KEY` | Email alert delivery | `server/alerts.js` |
| `ALERT_FROM_EMAIL` | Email sender identity | `server/alerts.js` |
| `ALERT_DEFAULT_RECIPIENTS` | Default alert inboxes added to every saved rule | `server/alerts.js` |
| `STRIPE_SECRET_KEY` | Live billing checkout | `server/billing.js` |
| `CRON_SECRET` | Protected hosted source sync and scheduled jobs | `server/app.js` |

### Current secret handling rule

- Secret names are committed.
- Secret values are **not** committed.
- Local development uses `.env`.
- Hosted production uses Vercel environment variables.

## File map

- `server/udyam.js`
- `server/mca.js`
- `server/source-adapters.js`
- `server/app.js`
- `lib/workspace-client.js`
- `apps/verifysme/index.js`
- `.env.example`

## Recommended next upgrade path

1. Keep `Udyam` on the current official captcha-assisted bridge until a sanctioned API exists.
2. Keep `MCA` on the current assisted flow unless you acquire a sanctioned unattended access path.
3. Treat `GeM`, `CPPP`, and `DGFT` as public-data adapters with monitoring for selector or payload changes.
4. Keep private runtime secrets in environment variables only, not in markdown or source control.
