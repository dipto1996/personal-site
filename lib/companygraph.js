import { exportOpportunities, exportProfiles } from "../apps/exportpulse/data/catalog.js";
import { getCompositeScore, supplierProfiles } from "../apps/verifysme/index.js";
import { tenderOpportunities, tenderProfiles } from "../apps/tenderradar/data/catalog.js";
import { buildExportOpportunityView, marketsMatch, summarizeExportWorkspace } from "./exportpulse.js";
import { buildRadarView, summarizeRadar } from "./tenderradar.js";

export const suiteProfiles = [
  {
    id: "atlas",
    label: "Atlas Flex Packaging",
    supplierId: "atlas-flex-packaging",
    tenderProfileId: "atlaspack",
    exportProfileId: "gcc-packaging",
    thesis: "Public nutrition and FMCG packaging supplier with strong documentation depth.",
    narrative: "Trusted packaging supplier with export proof and visible procurement potential.",
  },
  {
    id: "summit",
    label: "Summit Auto Cast",
    supplierId: "summit-auto-cast",
    tenderProfileId: "summitcast",
    exportProfileId: "eu-industrial",
    thesis: "Industrial components supplier spanning procurement and export qualification.",
    narrative: "Industrial manufacturer where procurement and export routes both matter.",
  },
  {
    id: "shoreline",
    label: "Shoreline Apparel Exim",
    supplierId: "shoreline-apparel-exim",
    tenderProfileId: "shorelineapparel",
    exportProfileId: "uk-apparel",
    thesis: "Export-oriented apparel manufacturer with compliance-heavy buyer expectations.",
    narrative: "Export-led apparel player that can also qualify selective institutional contracts.",
  },
];

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function getSupplierById(supplierId) {
  return supplierProfiles.find((item) => item.id === supplierId);
}

function getTenderProfileById(profileId) {
  return tenderProfiles.find((item) => item.id === profileId);
}

function getExportProfileById(profileId) {
  return exportProfiles.find((item) => item.id === profileId);
}

function getExportSlice(exportProfile, supplier) {
  return exportOpportunities.filter(
    (opportunity) =>
      !exportProfile.targetMarkets.length ||
      exportProfile.targetMarkets.some((market) => marketsMatch(market, opportunity.market)) ||
      opportunity.matchSupplierIds.includes(supplier.id),
  );
}

export function buildCompanyGraphSnapshot(profileId = suiteProfiles[0].id) {
  const suite = suiteProfiles.find((item) => item.id === profileId) || suiteProfiles[0];
  const supplier = getSupplierById(suite.supplierId);
  const tenderProfile = getTenderProfileById(suite.tenderProfileId);
  const exportProfile = getExportProfileById(suite.exportProfileId);

  if (!supplier || !tenderProfile || !exportProfile) {
    throw new Error(`Missing linked company-graph data for ${suite.id}`);
  }

  const verifyComposite = getCompositeScore(supplier);
  const tenderRanked = buildRadarView(tenderOpportunities, tenderProfile);
  const tenderSummary = summarizeRadar(tenderRanked);
  const topTender =
    tenderRanked.find((item) => item.analysis.fitBand !== "Low fit") || tenderRanked[0] || null;
  const exportRanked = buildExportOpportunityView(getExportSlice(exportProfile, supplier), supplier);
  const exportSummary = summarizeExportWorkspace(exportRanked);
  const topRoute = exportRanked[0] || null;

  const nextActions = dedupe([
    topTender?.analysis.gaps[0],
    topRoute?.analysis.blockers[0],
    supplier.concerns[0],
    ...(topRoute?.nextActions || []),
  ]).slice(0, 4);

  return {
    suite,
    supplier,
    verify: {
      compositeScore: verifyComposite,
      composite: verifyComposite,
      trustScore: supplier.trustScore,
      evidenceCount: supplier.evidence.length,
      supplierCount: supplier.evidence.length,
      riskBand: supplier.riskBand,
      dataConfidence: supplier.dataConfidence,
    },
    tender: {
      topOpportunity: topTender,
      topTender,
      summary: tenderSummary,
    },
    export: {
      topOpportunity: topRoute,
      topRoute,
      summary: exportSummary,
    },
    nextActions,
  };
}
