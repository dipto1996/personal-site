# Decisions

- Keep the product inside the personal-site nav instead of spinning out a separate app shell.
- Add a boring Node backend instead of introducing a frontend framework rewrite.
- Use one shared workspace/auth layer across VerifySME, TenderRadar, and ExportPulse.
- Add one shared control center for alerts, billing, runtime status, and source sync instead of separate admin surfaces per module.
- Prefer honest restricted-source handling over fake live registry claims.
- Keep local JSON as the default persistence mode, with optional Postgres behind `DATABASE_URL`.
- Keep Stripe, Resend, and scheduled sync support in the API shape even when the workspace is running in local or simulated mode.
- Keep the product available on Vercel by falling back to local JSON if the hosted Postgres credential becomes invalid, rather than letting every API route fail hard.
