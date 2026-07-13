# Security Checklist

- Passwords are hashed with PBKDF2 before persistence.
- Session cookies are `HttpOnly` and `SameSite=Lax`.
- Workspace selection is validated against memberships before switching.
- Invite creation is restricted to `owner` or `admin`.
- Invite joins require a valid active code.
- Workspace state is namespaced per workspace.
- Alert CRUD is workspace-scoped and follows the same membership boundary.
- Billing plan changes are workspace-scoped and do not mutate other tenants.
- Static file serving is constrained to the repo root.
- Invalid JSON payloads return a controlled `400`.
- Restricted public sources are surfaced honestly instead of being spoofed.
- No secrets are committed; runtime config stays in environment variables.
- Cron source sync accepts a shared secret and rejects anonymous calls.
- Browser-origin mutations are checked against the allowed app origin.
- Sensitive write routes use an in-memory rate limiter.

## Known security limitations in this V1

- No email verification or password reset flow yet.
- No fine-grained per-product permissions inside a workspace yet.
- No webhook signature verification for Stripe because the current checkout path is still simulated when live keys are absent.
