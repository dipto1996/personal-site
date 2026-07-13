# Next Steps

- Move local job-search inference to the connected Windows computer using the plan in `docs/job-search-windows-handoff.md`.
- Add token-authenticated Vercel worker endpoints so the Windows computer never stores the Neon administrator connection string.
- Benchmark Qwen3-4B and Qwen3-8B against 20 labelled jobs before releasing the production backlog.
- Keep the retired Qwen3-14B Mac service disabled; do not run `npm run jobs:install` on the Mac.
- Run a signed-in owner QA pass on `/job-search.html`: discovery review, deep-evaluation evidence, feedback, title rules, run status, and provider usage.
- Run a signed-in browser QA pass across the hardened TradeGraph overview and ops flows, especially demo activation, source refresh, alert creation, and workspace switching.
- Provision a live environment value for `STRIPE_SECRET_KEY` when billing should exit simulated mode.
- Mirror the new analytics event stream into a warehouse or hosted sink only when traffic volume justifies it; the current control-center summary is now sufficient for product iteration.
- Replace the assisted MCA workflow only if a sanctioned unattended lookup path becomes available from MCA or an official downstream distributor.
- Replace the assisted Udyam workflow only if a sanctioned unattended verification surface becomes available.
