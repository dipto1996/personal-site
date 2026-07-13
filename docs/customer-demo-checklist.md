# Customer Demo Checklist

Use this for a live TradeGraph demo with a prospect after you generate a Vercel `Sharable Link`.

## Before the call

1. Create a Vercel `Sharable Link` for the current production deployment.
2. Run:

```bash
npm run demo:links -- 'PASTE_THE_VERCEL_SHARABLE_LINK_HERE'
```

3. Copy the generated links into your notes.
4. Keep these operator checks ready in another terminal:

```bash
npm run prod:fetch -- /api/health
npm run prod:smoke
```

## Demo outcome

By the end of the walkthrough, the customer should understand:

- what TradeGraph does
- why the three products are separate
- what real public data is being used
- how evidence moves from supplier diligence to tender qualification to export route planning
- why the product is operational, not just visual

## 1. Open the suite home

Link:

- `Suite home`

Goal:

- establish the product thesis in one sentence

Say:

- `TradeGraph is a decision workspace for Indian SME operators. It connects company evidence, public tender signals, and export route signals into one operating surface.`

Customer should notice:

- this is a suite, not one generic dashboard
- the three products answer different decisions

If they ask “why are these together?”:

- `Because the same company record powers all three decisions. First you validate the company, then you decide whether to bid, then you decide where to export.`

## 2. Open VerifySME supplier detail

Link:

- `VerifySME supplier proof flow`

Goal:

- show how one company is evaluated through evidence, not just a score

Say:

- `This is the supplier diligence layer. The question here is: can I trust this company enough to engage?`

Show:

- supplier dossier
- proof artifacts
- evidence ladder
- official Udyam / MCA workflow area
- connected decision links

Customer should notice:

- trust is broken into evidence, freshness, confidence, and operational fit
- official-source-assisted workflows are part of the product
- this is not a static vendor directory

Example:

- `Shoreline Apparel Exim looks commercially attractive because it has visible export identity, public evidence depth, and route relevance. If official MCA or Udyam proof is still missing, the operator can bind it here before moving forward.`

Likely objection:

- `How is this different from searching on IndiaMART or a website?`

Answer:

- `Those are raw discovery surfaces. This product structures the evidence, keeps decision traceability, and ties the same company into downstream tender and export workflows.`

## 3. Open TenderRadar opportunity detail

Link:

- `TenderRadar live bid flow`

Goal:

- show a live public tender being qualified against a company profile

Say:

- `This is the bid/no-bid layer. The question is: should this company spend time and money pursuing this tender?`

Show:

- tender detail
- fit reasoning
- gaps / blockers
- owner / next action / workflow state
- cross-link back to the company context

Customer should notice:

- the tender is source-derived from public feeds
- the screen is operational, not a static listing
- the value is in qualification, not just discovery

Example:

- `SolarGrid can see a live public tender and immediately understand fit, qualification pressure, and whether to watch, pursue, or reject.`

Likely objection:

- `Why not just monitor CPPP or GeM directly?`

Answer:

- `Because procurement teams lose time qualifying irrelevant opportunities. TradeGraph collapses discovery, fit scoring, and workflow into one place.`

## 4. Open ExportPulse route detail

Link:

- `ExportPulse route flow`

Goal:

- show how the same company moves into route readiness planning

Say:

- `This is the market-entry layer. The question is: which route can this company realistically enter next, and what blocks it?`

Show:

- route detail
- blockers
- actions
- route readiness framing
- public notice / source trace

Customer should notice:

- export planning is turned into an action queue, not a vague research task
- the same company context is still being used
- this is a route decision, not just a market-research document

Example:

- `GCC Packaging can see a UAE route recommendation, what trade and compliance context supports it, and what execution steps still need to happen.`

Likely objection:

- `Is this just export content?`

Answer:

- `No. The product is sequencing a decision: route selection, blockers, readiness, and follow-up actions tied to the actual supplier/company profile.`

## 5. Close on pricing

Link:

- `Pricing close`

Goal:

- frame the suite as a buyable operational product

Say:

- `You can adopt one module first, but the real moat compounds when the same company graph flows across diligence, bid qualification, and export planning.`

Customer should notice:

- this is packaged like a real product
- the suite structure supports expansion from one wedge to the full operating model

## What to emphasize throughout

- `Real public data`
  - GeM
  - CPPP
  - DGFT
  - MCA assisted official flow
  - Udyam assisted official flow

- `Decision traceability`
  - why a supplier is trusted or not
  - why a tender is pursued or not
  - why a route is ready or blocked

- `Shared company graph`
  - one company can move across all three products
  - the products share data, not clutter

- `Operator realism`
  - owners
  - next actions
  - blockers
  - evidence freshness
  - provenance

## Red flags to avoid in the demo

- Do not describe the product as “a dashboard.”
- Do not describe the supplier universe as fully bulk-ingested from Udyam or MCA.
- Do not imply that the product bypasses government anti-bot controls.
- Do not lead with charts before the business question is clear.
- Do not mix the three products into one blended explanation.

## Fast closing line

- `TradeGraph helps an Indian SME operator answer three high-value questions with one evidence graph: who can we trust, what should we bid for, and where can we realistically expand next?`
