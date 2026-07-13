import test from "node:test";
import assert from "node:assert/strict";

import { exportProfiles } from "../apps/exportpulse/data/catalog.js";
import { supplierProfiles } from "../apps/verifysme/index.js";
import { tenderProfiles } from "../apps/tenderradar/data/catalog.js";
import {
  applyCompanyEvidenceToRouteScore,
  applyCompanyEvidenceToTenderScore,
  buildLiveExportInventory,
  buildLiveSupplierInventory,
  buildLiveTenderInventory,
} from "../lib/live-tradegraph.js";
import { buildExportOpportunityView } from "../lib/exportpulse.js";
import { buildRadarView } from "../lib/tenderradar.js";

test("buildLiveTenderInventory converts GeM and CPPP snapshots into scored tender entities", () => {
  const sources = [
    {
      key: "gem",
      label: "GeM BidPlus",
      status: "live",
      checkedAt: "2026-03-31T10:00:00.000Z",
      items: [
        {
          externalId: "9015237",
          bidNumber: "GEM/2026/B/7264989",
          ministry: "Ministry of Education",
          department: "Department of Higher Education",
          category: "GlobalTenderCategory",
          documentUrl: "https://bidplus-global.gem.gov.in/showbidDocument/9015237/FebQ126/3",
        },
      ],
    },
    {
      key: "cppp",
      label: "CPPP ePublishing",
      status: "live",
      checkedAt: "2026-03-31T10:00:00.000Z",
      items: [
        {
          serial: 1,
          publishedAt: "25-Mar-2026 05:00 PM",
          closingAt: "01-Apr-2026 09:00 AM",
          openingAt: "01-Apr-2026 09:00 AM",
          detailUrl: "https://www.eprocure.gov.in/epublish/app?tender=1",
          title: "Supply Installation and Commissioning of Vertical Turbine Pump Sets",
          referenceNumber: "RGCB/PUR/1835/25/1756",
          tenderId: "2026_MST_833413_1",
          organization: "Department of Biotechnology||Rajiv Gandhi Centre for Biotechnology||Purchase Section",
        },
      ],
    },
  ];

  const inventory = buildLiveTenderInventory({ sources });
  assert.equal(inventory.mode, "source-derived");
  assert.equal(inventory.items.length, 2);
  assert.deepEqual(inventory.sourcesUsed.sort(), ["cppp", "gem"]);

  const scored = buildRadarView(inventory.items, tenderProfiles[0]);
  assert.equal(scored.length, 2);
  assert.ok(scored[0].analysis.totalScore >= 0);
  assert.ok(scored.every((item) => item.source === "CPPP" || item.source === "GeM"));
});

test("buildLiveExportInventory converts DGFT notices into route briefs", () => {
  const sources = [
    {
      key: "dgft",
      label: "DGFT Trade Notices",
      status: "live",
      checkedAt: "2026-03-31T10:00:00.000Z",
      items: [
        {
          noticeNumber: "31/2025-2026",
          noticeYear: "2025-2026",
          title: "Guidelines for Credit Assistance for E-Commerce Exporters under Export Promotion Mission (EPM)",
          noticeDate: "06/03/2026",
          pdfUrl: "https://content.dgft.gov.in/notice-31.pdf",
        },
        {
          noticeNumber: "26/2025-26",
          noticeYear: "2025-26",
          title: "Guidelines for Trade Regulations, Accreditation and Compliance Enablement (TRACE) under Export Promotion Mission (EPM)",
          noticeDate: "20/02/2026",
          pdfUrl: "https://content.dgft.gov.in/notice-26.pdf",
        },
      ],
    },
  ];

  const profile = exportProfiles.find((item) => item.id === "gcc-packaging") || exportProfiles[0];
  const supplier = supplierProfiles.find((item) => item.id === profile.supplierId) || supplierProfiles[0];
  const inventory = buildLiveExportInventory({ sources, supplier, profile });

  assert.equal(inventory.mode, "source-derived");
  assert.ok(inventory.items.length >= profile.targetMarkets.length);
  assert.ok(inventory.items.every((item) => item.market));
  assert.ok(inventory.items.every((item) => Array.isArray(item.sourceNotices) && item.sourceNotices.length));

  const scored = buildExportOpportunityView(inventory.items, supplier);
  assert.ok(scored[0].analysis.totalScore > 0);
});

test("company evidence bonuses lift tender and route scores when official proofs are bound", () => {
  const supplier = supplierProfiles[0];
  const tender = buildRadarView(
    buildLiveTenderInventory({
      sources: [
        {
          key: "cppp",
          label: "CPPP ePublishing",
          status: "live",
          checkedAt: "2026-03-31T10:00:00.000Z",
          items: [
            {
              serial: 1,
              publishedAt: "25-Mar-2026 05:00 PM",
              closingAt: "01-Apr-2026 09:00 AM",
              title: "Supply, Printing and Delivery of Food Grade Laminated Pouches",
              referenceNumber: "PKG/2026/04",
              tenderId: "2026_PACK_1",
              organization: "Gujarat State Nutrition Mission",
              detailUrl: "https://www.eprocure.gov.in/epublish/app?tender=packaging",
            },
          ],
        },
      ],
    }).items,
    tenderProfiles.find((item) => item.id === "atlaspack") || tenderProfiles[0],
  )[0];

  const route = buildExportOpportunityView(
    buildLiveExportInventory({
      sources: [
        {
          key: "dgft",
          label: "DGFT Trade Notices",
          status: "live",
          checkedAt: "2026-03-31T10:00:00.000Z",
          items: [
            {
              noticeNumber: "32/2025-2026",
              title: "Guidelines-Support for Emerging Export Opportunities under Export Promotion Mission (EPM)",
              noticeDate: "06/03/2026",
              pdfUrl: "https://content.dgft.gov.in/notice-32.pdf",
            },
          ],
        },
      ],
      supplier,
      profile: exportProfiles.find((item) => item.id === "gcc-packaging") || exportProfiles[0],
    }).items,
    supplier,
  )[0];

  const evidence = { hasUdyam: true, hasMca: true };
  const tenderBoosted = applyCompanyEvidenceToTenderScore(tender, tender.analysis, evidence);
  const routeBoosted = applyCompanyEvidenceToRouteScore(route, route.analysis, evidence);

  assert.ok(tenderBoosted.totalScore >= tender.analysis.totalScore);
  assert.ok(routeBoosted.totalScore >= route.analysis.totalScore);
  assert.ok(tenderBoosted.reasons.some((item) => item.includes("Udyam")));
  assert.ok(routeBoosted.reasons.some((item) => item.includes("MCA")));
});

test("buildLiveSupplierInventory overlays official evidence and live tender/export signals onto supplier entities", () => {
  const sources = [
    {
      key: "cppp",
      label: "CPPP ePublishing",
      status: "live",
      checkedAt: "2026-03-31T10:00:00.000Z",
      items: [
        {
          serial: 1,
          publishedAt: "25-Mar-2026 05:00 PM",
          closingAt: "01-Apr-2026 09:00 AM",
          title: "Supply, Printing and Delivery of Food Grade Laminated Pouches",
          referenceNumber: "PKG/2026/04",
          tenderId: "2026_PACK_1",
          organization: "Gujarat State Nutrition Mission",
          detailUrl: "https://www.eprocure.gov.in/epublish/app?tender=packaging",
        },
      ],
    },
    {
      key: "dgft",
      label: "DGFT Trade Notices",
      status: "live",
      checkedAt: "2026-03-31T10:00:00.000Z",
      items: [
        {
          noticeNumber: "33/2025-2026",
          title: "Clarification on Support for Interest Subvention for pre-shipment and post-shipment credit",
          noticeDate: "20/03/2026",
          pdfUrl: "https://content.dgft.gov.in/notice-33.pdf",
        },
      ],
    },
  ];

  const inventory = buildLiveSupplierInventory({
    sources,
    profiles: supplierProfiles.filter((item) => item.id === "atlas-flex-packaging"),
    verifyState: {
      cases: {
        "atlas-flex-packaging": {
          evidence: {
            udyam: {
              checkedAt: "2026-03-30T10:00:00.000Z",
              confidence: "Verified",
            },
            mca: {
              checkedAt: "2026-03-30T10:00:00.000Z",
              confidence: "Structured match",
            },
          },
        },
      },
    },
  });

  assert.equal(inventory.mode, "source-derived");
  assert.equal(inventory.items.length, 1);
  assert.ok(inventory.items[0].officialEvidenceCount >= 2);
  assert.ok(inventory.items[0].liveTenderMatches.length >= 1);
  assert.ok(inventory.items[0].liveRouteMatches.length >= 1);
  assert.equal(inventory.items[0].sourceInventoryMode, "source-derived");
  assert.equal(inventory.items[0].dataConfidence, "High");
});
