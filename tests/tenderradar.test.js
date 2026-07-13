import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultTenderCase, getTenderViewFromPathname } from "../apps/tenderradar/index.js";
import { buildRadarView, scoreTender, summarizeRadar } from "../lib/tenderradar.js";
import { tenderOpportunities, tenderProfiles } from "../apps/tenderradar/data/catalog.js";

test("PumpWorks profile scores pump infrastructure tenders highly", () => {
  const profile = tenderProfiles.find((item) => item.id === "pumpworks");
  const opportunity = tenderOpportunities.find((item) => item.id === "TR-001");
  const result = scoreTender(opportunity, profile);

  assert.equal(result.fitBand, "High fit");
  assert.equal(result.soloBidEligible, true);
  assert.ok(result.totalScore >= 75);
  assert.ok(result.reasons.some((reason) => reason.includes("geography")));
});

test("CloudStack profile does not strongly match a diagnostics tender", () => {
  const profile = tenderProfiles.find((item) => item.id === "cloudstack");
  const opportunity = tenderOpportunities.find((item) => item.id === "TR-002");
  const result = scoreTender(opportunity, profile);

  assert.equal(result.fitBand, "Low fit");
  assert.ok(result.gaps.some((gap) => gap.includes("category")));
});

test("Radar summary returns stable aggregate counts", () => {
  const profile = tenderProfiles.find((item) => item.id === "solargrid");
  const scored = buildRadarView(tenderOpportunities, profile);
  const summary = summarizeRadar(scored);

  assert.equal(summary.counts.matched, tenderOpportunities.length);
  assert.ok(summary.averageValueCrore > 0);
  assert.ok(Object.keys(summary.sectorMix).length > 0);
});

test("Tender fit drops when visible turnover and project thresholds are not met", () => {
  const profile = tenderProfiles.find((item) => item.id === "pumpworks");
  const opportunity = {
    ...tenderOpportunities.find((item) => item.id === "TR-001"),
    minTurnoverCrore: 40,
    minPastProjects: 6,
  };
  const result = scoreTender(opportunity, profile);

  assert.equal(result.soloBidEligible, false);
  assert.notEqual(result.fitBand, "High fit");
  assert.ok(result.gaps.some((gap) => gap.includes("turnover below required threshold")));
  assert.ok(result.gaps.some((gap) => gap.includes("past project count")));
});

test("route helper maps TenderRadar URLs to task-specific views", () => {
  assert.equal(getTenderViewFromPathname("/tradegraph/app/tenderradar/pipeline.html"), "pipeline");
  assert.equal(getTenderViewFromPathname("/tradegraph/app/tenderradar/bid-desk.html"), "bidDesk");
  assert.equal(getTenderViewFromPathname("/tradegraph/app/tenderradar/opportunities.html"), "opportunities");
  assert.equal(getTenderViewFromPathname("/tradegraph/app/tenderradar/opportunity-detail.html"), "detail");
});

test("default tender case starts in watch state", () => {
  const record = createDefaultTenderCase("TR-001");

  assert.equal(record.stage, "Watch");
  assert.equal(record.owner, "Bid lead");
  assert.equal(record.decision, "Needs review");
});
