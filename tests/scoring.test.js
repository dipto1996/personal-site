import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOverviewMetrics,
  getRiskBand,
  scoreExportReadiness,
  scoreTenderFit,
} from "../apps/tradegraph/lib/scoring.js";
import { exportMarkets, suppliers, tenders } from "../apps/tradegraph/data/demo-data.js";

test("getRiskBand returns the expected qualitative band", () => {
  assert.equal(getRiskBand(91), "Low risk");
  assert.equal(getRiskBand(77), "Moderate risk");
  assert.equal(getRiskBand(64), "Needs diligence");
});

test("scoreTenderFit rewards matching sector, certifications, and GeM presence", () => {
  const supplier = suppliers.find((item) => item.id === "sv-205");
  const tender = tenders.find((item) => item.id === "tn-304");

  assert.ok(supplier);
  assert.ok(tender);
  assert.equal(scoreTenderFit(supplier, tender), 98);
});

test("scoreExportReadiness increases for IEC-live and documentation-rich suppliers", () => {
  const supplier = suppliers.find((item) => item.id === "sv-201");
  assert.ok(supplier);
  assert.equal(scoreExportReadiness(supplier), 84);
});

test("buildOverviewMetrics reflects watchlist and supplier state", () => {
  const metrics = buildOverviewMetrics(suppliers, tenders, exportMarkets, ["sv-201", "tn-304"]);
  assert.equal(metrics[0].value, 6);
  assert.equal(metrics[1].value, 3);
  assert.equal(metrics[3].value, 2);
});
