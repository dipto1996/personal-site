# Assumptions

- `TradeGraph India` is the product-level wrapper, but the user-facing modules should still read as three distinct products: `VerifySME`, `TenderRadar`, and `ExportPulse`.
- The personal site remains a static HTML/CSS/JS site for this V1, but it is backed by a Node server and route handlers rather than being purely static.
- Live public-source sync is preferable to fully mocked feeds whenever a public endpoint is available.
- Postgres, Resend, Stripe, and cron are best treated as environment-backed integrations with local fallbacks and simulated modes in this repo.
- A shared workspace with sign-in is the right default because the new control center, alerts, and billing state all need a durable owner context.
- The target buyer is an Indian SME founder, sourcing lead, bid operator, or export manager who needs fewer manual checks and more operational clarity.
- The two default ops inboxes should be attached to every alert rule even when a workspace user adds extra recipients.
