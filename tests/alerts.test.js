import test from "node:test";
import assert from "node:assert/strict";

import { buildAlertMatches } from "../server/alerts.js";

const snapshots = [
  {
    key: "gem",
    label: "GeM BidPlus",
    items: [
      {
        externalId: "B-100",
        title: "Cold Chain Equipment and Reefer Vans",
        ministry: "Ministry of Food Processing",
        detailUrl: "https://example.com/gem/B-100",
      },
      {
        externalId: "B-200",
        title: "Hospital Linen Supply",
        ministry: "Health Department",
        detailUrl: "https://example.com/gem/B-200",
      },
    ],
  },
  {
    key: "dgft",
    label: "DGFT Trade Notices",
    items: [
      {
        noticeDate: "2026-03-28",
        title: "Trade notice for nutraceutical exports to UAE",
        pdfUrl: "https://example.com/dgft/notice-1.pdf",
      },
    ],
  },
];

test("buildAlertMatches filters source items by keywords and source keys", () => {
  const matches = buildAlertMatches(
    {
      product: "tenderradar",
      filters: {
        query: "cold chain, reefer",
        sourceKeys: ["gem"],
      },
    },
    snapshots,
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, "Cold Chain Equipment and Reefer Vans");
  assert.equal(matches[0].sourceKey, "gem");
});

test("buildAlertMatches falls back to product-default sources", () => {
  const matches = buildAlertMatches(
    {
      product: "exportpulse",
      filters: {
        query: "UAE, nutraceutical",
      },
    },
    snapshots,
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].sourceKey, "dgft");
  assert.match(matches[0].title, /nutraceutical exports/i);
});
