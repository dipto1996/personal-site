export function getRiskBand(score) {
  if (score >= 85) {
    return "Low risk";
  }

  if (score >= 70) {
    return "Moderate risk";
  }

  return "Needs diligence";
}

export function scoreTenderFit(supplier, tender) {
  let score = 40;
  const tenderCredentials = tender.requiredTags || tender.requiredCredentials || [];
  const gemSignal = supplier.gem || supplier.gemStatus;

  if (supplier.sector === tender.sector) {
    score += 28;
  }

  if (gemSignal === "Seller" || gemSignal === "Bid-capable" || gemSignal === "Supplier footprint") {
    score += 12;
  }

  if ((supplier.certifications || []).some((certification) => tenderCredentials.includes(certification))) {
    score += 10;
  }

  if (supplier.matchStrength === "High") {
    score += 8;
  } else if (supplier.matchStrength === "Medium") {
    score += 4;
  }

  return Math.min(score, 99);
}

export function scoreExportReadiness(supplier) {
  let score = supplier.exportReadiness;
  const iecSignal = supplier.iec || supplier.iecStatus;

  if (iecSignal === "Live" || iecSignal === "Active") {
    score += 6;
  }

  if ((supplier.certifications || []).length >= 2) {
    score += 4;
  }

  return Math.min(score, 99);
}

export function buildOverviewMetrics(suppliers, tenders, exportMarkets, watchlistIds) {
  const dueSoonCount = tenders.filter((tender) => {
    const dateValue = tender.dueDate || tender.closingDate;
    return dateValue ? new Date(dateValue).getTime() <= new Date("2026-04-12").getTime() : false;
  }).length;
  const verifiedCount = suppliers.filter((supplier) => {
    const udyamSignal = supplier.udyam || supplier.udyamStatus;
    const mcaSignal = supplier.mca || supplier.companyStatus || supplier.mcaStatus;
    return udyamSignal === "Verified" && Boolean(mcaSignal);
  }).length;
  const exportReadyCount = suppliers.filter((supplier) => scoreExportReadiness(supplier) >= 75).length;

  return [
    {
      label: "Verified suppliers",
      value: verifiedCount,
      detail: "Suppliers with active identity signals and dossier coverage.",
    },
    {
      label: "Due-soon tenders",
      value: dueSoonCount,
      detail: "Bids that need immediate qualification review.",
    },
    {
      label: "Export-ready suppliers",
      value: exportReadyCount,
      detail: "Suppliers already near cross-border readiness.",
    },
    {
      label: "Watchlist items",
      value: watchlistIds.length,
      detail: "Locally saved supplier, tender, and export signals.",
    },
    {
      label: "Live modules",
      value: 3,
      detail: `${exportMarkets.length} export opportunities layered into the pilot.`,
    },
  ];
}

export function buildTrustDistribution(suppliers) {
  const low = suppliers.filter((supplier) => supplier.trustScore >= 85).length;
  const medium = suppliers.filter((supplier) => supplier.trustScore >= 70 && supplier.trustScore < 85).length;
  const high = suppliers.filter((supplier) => supplier.trustScore < 70).length;

  return [
    { label: "Low risk", value: low },
    { label: "Moderate risk", value: medium },
    { label: "Needs diligence", value: high },
  ];
}

export function buildExportReadinessSeries(suppliers) {
  return suppliers.map((supplier) => ({
    name: supplier.name,
    value: scoreExportReadiness(supplier),
  }));
}

export function buildWatchlistSummary(watchlistIds, suppliers, tenders, exportMarkets) {
  const records = [...suppliers, ...tenders, ...exportMarkets];
  return watchlistIds
    .map((id) => records.find((record) => record.id === id))
    .filter(Boolean);
}
