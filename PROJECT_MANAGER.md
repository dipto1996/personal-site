# Autonomous Build Program

## Objective

Build the personal-site repo into a production-grade portfolio plus product system, with TradeGraph as the deepest operating surface.
Execution should stay autonomous, tranche-based, and evidence-backed.

## Operating Model

- One project manager owns priority, sequencing, and closure criteria.
- Subordinate workers own bounded workstreams with disjoint write scopes where possible.
- Work proceeds in focused tranches: finish one slice, verify it, then move to the next.
- Product claims should be backed by code, tests, and visible runtime behavior.

## Current Program Structure

### Project Manager

- Own repo-wide direction, tranche selection, and verification gates.
- Keep the execution order dependency-aware instead of touching every surface at once.

### Worker Lanes

- Analytics and data stack
  - durable event ingestion
  - event summaries and reporting
  - usage visibility inside ops surfaces
- Source and scoring integrity
  - live-source normalization
  - scoring-model quality
  - provenance and fallback honesty
- Visualization and product UX
  - insight rendering quality
  - workflow clarity
  - cross-product drill-through
- Ops and commercialization
  - alerts
  - billing readiness
  - workspace operations

## Execution Queue

### Tranche 1: Persistent analytics stack

Status: in progress

Goal:
Turn browser-local telemetry into a durable product-usage layer with a backend event pipeline and visible summaries.

Definition of done:

- TradeGraph events persist server-side.
- A summary API exposes useful usage aggregates.
- The ops/control-center UI shows product-usage analytics.
- The implementation keeps local fallback behavior.
- Tests cover ingestion and summary behavior.

### Tranche 2: Visualization hardening

Status: queued

Goal:
Make the most important TradeGraph insights feel less like dashboard scaffolding and more like decision tools.

### Tranche 3: Data-model and source-quality closure

Status: queued

Goal:
Tighten the scoring and provenance model where live-source coverage is strongest, without pretending restricted sources are fully automated.

### Tranche 4: Narrative and portfolio integration

Status: queued

Goal:
Make the personal site explain the product and the operator story with the same level of clarity as the app itself.
