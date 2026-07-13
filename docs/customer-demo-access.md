# Customer Demo Access

Use this when the production deployment is still behind Vercel Authentication but you want to send a customer a working demo link.

## Supported path

Use Vercel `Sharable Links`.

- Open the deployment in the Vercel dashboard.
- Open the `Share` action for the current production deployment.
- Create a `Sharable Link`.
- Copy the generated URL.

This is the supported customer-facing path. Do not send internal operator bypass commands or secrets to customers.

## Turn one sharable link into the full demo path

Run:

```bash
npm run demo:links -- 'PASTE_THE_VERCEL_SHARABLE_LINK_HERE'
```

The script will output customer-ready deep links for:

- Suite home
- VerifySME supplier proof flow
- TenderRadar live bid flow
- ExportPulse route flow
- Pricing close

## Recommended customer demo sequence

1. `Suite home`
Explain the thesis: one evidence graph for `Company -> Opportunity -> Route`.

2. `VerifySME supplier proof flow`
Show how Shoreline Apparel Exim is evaluated, what evidence exists, and how the official Udyam/MCA workflows fit into diligence.

3. `TenderRadar live bid flow`
Show how SolarGrid sees a live public tender, fit reasoning, and bid/no-bid context.

4. `ExportPulse route flow`
Show how GCC Packaging gets a route recommendation, blockers, and execution actions.

5. `Pricing close`
Finish on pricing to frame the suite as a product, not a prototype.

For the full operator script, use:

- `docs/customer-demo-checklist.md`

## Operator QA path

For internal hosted QA behind deployment protection, use:

```bash
npm run prod:fetch -- /api/health
npm run prod:smoke
```

That path uses `vercel curl` and an automatic deployment-protection bypass token. It is for operators, not customers.
