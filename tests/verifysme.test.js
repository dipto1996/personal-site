import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFiltersFromPreset,
  buildShortlistExport,
  createDefaultFilters,
  createDefaultDiligenceCase,
  createWorkspaceSupplier,
  filterSuppliers,
  getVerifyViewFromPathname,
  getCompositeScore,
  getKpis,
  supplierProfiles,
} from "../apps/verifysme/index.js";

test("default filters start neutral without a preset bias", () => {
  const filters = createDefaultFilters();

  assert.deepEqual(filters, {
    searchTerm: "",
    sector: "",
    state: "",
    lowRiskOnly: false,
    exportReadyOnly: false,
    tenderReadyOnly: false,
  });
});

test("preset builds a meaningful filter bundle", () => {
  const filters = buildFiltersFromPreset("food-packaging");

  assert.equal(filters.sector, "Packaging");
  assert.equal(filters.lowRiskOnly, true);
  assert.equal(filters.exportReadyOnly, true);
});

test("filterSuppliers narrows to the requested sector and readiness rules", () => {
  const filters = {
    searchTerm: "",
    sector: "Industrial",
    state: "",
    lowRiskOnly: true,
    exportReadyOnly: false,
    tenderReadyOnly: true,
  };

  const results = filterSuppliers(supplierProfiles, filters);

  assert.ok(results.length >= 1);
  assert.ok(results.every((profile) => profile.sector === "Industrial"));
  assert.ok(results.every((profile) => profile.riskBand === "Low"));
  assert.ok(results.every((profile) => profile.tenderFit >= 75));
});

test("composite score rewards stronger trust and readiness", () => {
  const strong = supplierProfiles.find((profile) => profile.id === "atlas-flex-packaging");
  const weak = supplierProfiles.find((profile) => profile.id === "eastern-vita-formulations");

  assert.ok(strong);
  assert.ok(weak);
  assert.ok(getCompositeScore(strong) > getCompositeScore(weak));
});

test("kpi calculation respects the filtered set and shortlist", () => {
  const filtered = filterSuppliers(supplierProfiles, buildFiltersFromPreset("food-packaging"));
  const shortlistIds = supplierProfiles.slice(0, 2).map((profile) => profile.id);
  const kpis = getKpis(filtered, shortlistIds);

  assert.equal(kpis.shortlistCount, 2);
  assert.ok(kpis.supplierCount >= 1);
  assert.ok(kpis.averageTrust >= 0);
});

test("shortlist export emits a csv header and rows", () => {
  const csv = buildShortlistExport(supplierProfiles.slice(0, 2));

  assert.match(csv, /"Supplier","Sector","State"/);
  assert.match(csv, /Atlas Flex Packaging/);
  assert.match(csv, /Northbay Paperworks/);
});

test("route helper maps VerifySME URLs to task-specific views", () => {
  assert.equal(getVerifyViewFromPathname("/tradegraph/app/verifysme/queue.html"), "queue");
  assert.equal(getVerifyViewFromPathname("/tradegraph/app/verifysme/suppliers.html"), "suppliers");
  assert.equal(getVerifyViewFromPathname("/tradegraph/app/verifysme/comparisons.html"), "comparisons");
  assert.equal(getVerifyViewFromPathname("/tradegraph/app/verifysme/supplier-detail.html"), "detail");
});

test("workspace supplier intake creates a low-confidence supplier shell", () => {
  const supplier = createWorkspaceSupplier({
    name: "Acme Packaging Works",
    sector: "Packaging",
    state: "Gujarat",
    city: "Ahmedabad",
    tags: "food-safe, laminates",
  });

  assert.match(supplier.id, /workspace-acme-packaging-works/);
  assert.equal(supplier.dataConfidence, "Low");
  assert.equal(supplier.evidence[0], "Manual supplier intake");
});

test("default diligence case starts in new candidate state", () => {
  const record = createDefaultDiligenceCase("atlas-flex-packaging");

  assert.equal(record.stage, "New candidate");
  assert.equal(record.owner, "Procurement lead");
  assert.equal(record.approval, "Pending sign-off");
});
