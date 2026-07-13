# ADRs

## ADR-001: Build TenderRadar inside the existing portfolio

Reason: fastest launchable wedge with the least narrative fragmentation.

## ADR-002: Evolve from static microsite to a thin Node application layer

Reason: live source sync, shared workspaces, alert rules, and plan state require a backend, but the product still benefits from a boring low-ceremony stack.

## ADR-003: Make the scoring explainable

Reason: procurement trust is harmed by black-box relevance claims.

## ADR-004: Keep provider integrations optional behind the same API shape

Reason: the product should run locally and in demo mode without external credentials while still supporting Postgres, Resend, Stripe, and cron once provisioned.
