import test from "node:test";
import assert from "node:assert/strict";

import { buildCompanyGraphSnapshot, suiteProfiles } from "../lib/companygraph.js";

test("company graph snapshot links a supplier across verify, tender, and export layers", () => {
  const snapshot = buildCompanyGraphSnapshot("atlas");

  assert.equal(snapshot.supplier.id, "atlas-flex-packaging");
  assert.equal(snapshot.suite.label, "Atlas Flex Packaging");
  assert.ok(snapshot.verify.composite > 0);
  assert.ok(snapshot.tender.topTender);
  assert.ok(snapshot.export.topRoute);
  assert.ok(snapshot.nextActions.length > 0);
});

test("all configured suite profiles resolve to complete linked data", () => {
  suiteProfiles.forEach((profile) => {
    const snapshot = buildCompanyGraphSnapshot(profile.id);

    assert.equal(snapshot.suite.id, profile.id);
    assert.ok(snapshot.supplier.name.length > 0);
    assert.ok(snapshot.tender.summary.counts.matched > 0);
    assert.ok(snapshot.export.summary.total > 0);
  });
});
