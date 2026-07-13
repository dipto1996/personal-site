# Risks

- `Udyam` still blocks anonymous server-side company lookup from this environment.
- `MCA` is live at the service-directory layer, but automated company-level master-data extraction is not complete yet.
- The default local JSON persistence mode remains only a continuity fallback, not a concurrent-production datastore.
- Stripe still depends on real provisioning to exit simulated mode.
