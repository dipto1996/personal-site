import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultRouteCase, getExportViewFromPathname } from "../apps/exportpulse/index.js";
import { supplierProfiles } from "../apps/verifysme/index.js";
import { exportOpportunities } from "../apps/exportpulse/data/catalog.js";
import {
  buildExportOpportunityView,
  buildMarketMix,
  marketsMatch,
  scoreExportOpportunity,
  summarizeExportWorkspace,
} from "../lib/exportpulse.js";

test("apparel exporter scores UK route as ready now", () => {
  const supplier = supplierProfiles.find((item) => item.id === "shoreline-apparel-exim");
  const opportunity = exportOpportunities.find((item) => item.id === "EP-004");

  assert.ok(supplier);
  assert.ok(opportunity);

  const result = scoreExportOpportunity(opportunity, supplier);

  assert.equal(result.readinessBand, "Ready now");
  assert.equal(result.directMatch, true);
  assert.ok(result.totalScore >= 82);
  assert.ok(result.reasons.some((reason) => reason.includes("required export")));
});

test("wellness supplier shows blockers on an unrelated industrial route", () => {
  const supplier = supplierProfiles.find((item) => item.id === "saffron-wellness-labs");
  const opportunity = exportOpportunities.find((item) => item.id === "EP-002");

  assert.ok(supplier);
  assert.ok(opportunity);

  const result = scoreExportOpportunity(opportunity, supplier);

  assert.equal(result.readinessBand, "Needs deeper work");
  assert.ok(result.blockers.some((item) => item.includes("sector fit")));
});

test("workspace summary reflects route readiness counts and regional mix", () => {
  const supplier = supplierProfiles.find((item) => item.id === "atlas-flex-packaging");
  const scored = buildExportOpportunityView(exportOpportunities, supplier);
  const summary = summarizeExportWorkspace(scored);
  const mix = buildMarketMix(scored);

  assert.equal(summary.total, exportOpportunities.length);
  assert.ok(summary.averageScore > 0);
  assert.ok(Object.keys(mix).length > 0);
});

test("market alias matching treats UK and United Kingdom as the same route", () => {
  assert.equal(marketsMatch("UK", "United Kingdom"), true);
  assert.equal(marketsMatch("UAE", "United Arab Emirates"), true);
});

test("route helper maps ExportPulse URLs to task-specific views", () => {
  assert.equal(getExportViewFromPathname("/tradegraph/app/exportpulse/route-pipeline.html"), "pipeline");
  assert.equal(getExportViewFromPathname("/tradegraph/app/exportpulse/docs-readiness.html"), "docsReadiness");
  assert.equal(getExportViewFromPathname("/tradegraph/app/exportpulse/markets.html"), "markets");
  assert.equal(getExportViewFromPathname("/tradegraph/app/exportpulse/route-detail.html"), "detail");
});

test("default route case starts in route review state", () => {
  const record = createDefaultRouteCase("EP-001");

  assert.equal(record.stage, "Route review");
  assert.equal(record.owner, "Export lead");
  assert.equal(record.decision, "Needs review");
});
