# Analytics Plan

## North-star

Qualified workspace activity:
signed-in teams that meaningfully use supplier diligence, tender qualification, or route planning instead of bouncing after page load.

## Product events

- `workspace_signed_in`
- `workspace_created`
- `workspace_invite_created`
- `workspace_invite_joined`
- `workspace_switched`
- `source_sync_triggered`
- `alert_created`
- `alert_toggled`
- `alert_tested`
- `billing_plan_selected`
- `billing_plan_refreshed`
- `billing_plan_reset`
- `verifysme_viewed`
- `verifysme_preset_selected`
- `verifysme_filter_changed`
- `verifysme_supplier_opened`
- `verifysme_shortlist_toggled`
- `verifysme_stage_changed`
- `verifysme_compare_opened`
- `verifysme_export_triggered`
- `tenderradar_viewed`
- `tenderradar_profile_selected`
- `tenderradar_search_changed`
- `tenderradar_fit_filter_changed`
- `tenderradar_opened`
- `tenderradar_shortlist_toggled`
- `tenderradar_stage_changed`
- `exportpulse_viewed`
- `exportpulse_profile_switched`
- `exportpulse_shortlist_toggled`
- `exportpulse_stage_changed`

## Operational metrics

- live source freshness by adapter
- source item count by adapter
- workspace count
- active member count per workspace
- invite creation and join conversion
- alert rule count per workspace
- alert test success rate
- billing plan distribution
- ratio of configured providers to fallback providers

## Current storage

- Product interaction events now persist through `/api/analytics/events`, with browser-local queue fallback when the backend is unavailable
- Workflow state, shortlist state, and product selections are persisted workspace-side through `/api/state`
- Source snapshots are persisted server-side through `/api/sources`
- Alert rules and subscription state are persisted server-side through `/api/alerts` and `/api/billing`

## Frontend analytics contract

- Browser telemetry now keeps a persistent local snapshot with recent events, grouped counts, and a bounded pending-delivery queue in `localStorage`
- The frontend will opportunistically mirror queued events to backend analytics endpoints in this order:
  - `POST /api/analytics/events`
  - `POST /api/analytics`
- The ops/control-center usage summary will try backend summary endpoints in this order:
  - `GET /api/analytics/summary`
  - `GET /api/analytics`
- If those endpoints are absent, erroring, or the workspace is not signed in, the control-center falls back to the local analytics slice instead of failing closed
- Existing raw event names are preserved for compatibility, while the control-center groups equivalent ops and canonical events into cleaner usage labels

## Next analytics step

Mirror the current event stream into a warehouse or hosted analytics sink only when traffic volume justifies a second analytics destination beyond the built-in control-center summary.
