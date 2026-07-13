import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

const requiredPages = [
  "tradegraph/app/verifysme/comparisons.html",
  "tradegraph/app/tenderradar/bid-desk.html",
  "tradegraph/app/exportpulse/docs-readiness.html",
  "tradegraph/app/ops/audit-log.html",
  "job-search.html",
];

test("all public route helpers point to real html pages", () => {
  requiredPages.forEach((page) => {
    assert.equal(
      existsSync(path.resolve(page)),
      true,
      `${page} should exist so route helpers do not point to missing pages.`,
    );
  });
});
