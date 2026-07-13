function buildUrl(pathname, params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    query.set(key, String(value));
  });

  const qs = query.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function buildTradeGraphUrl(pathname, params = {}) {
  return buildUrl(pathname, params);
}

export function buildVerifySMEUrl(page = "suppliers", params = {}) {
  const mapping = {
    queue: "/tradegraph/app/verifysme/queue.html",
    suppliers: "/tradegraph/app/verifysme/suppliers.html",
    detail: "/tradegraph/app/verifysme/supplier-detail.html",
    comparisons: "/tradegraph/app/verifysme/comparisons.html",
  };

  return buildUrl(mapping[page] || mapping.suppliers, params);
}

export function buildTenderRadarUrl(page = "opportunities", params = {}) {
  const mapping = {
    pipeline: "/tradegraph/app/tenderradar/pipeline.html",
    opportunities: "/tradegraph/app/tenderradar/opportunities.html",
    detail: "/tradegraph/app/tenderradar/opportunity-detail.html",
    bidDesk: "/tradegraph/app/tenderradar/bid-desk.html",
  };

  return buildUrl(mapping[page] || mapping.opportunities, params);
}

export function buildExportPulseUrl(page = "markets", params = {}) {
  const mapping = {
    pipeline: "/tradegraph/app/exportpulse/route-pipeline.html",
    markets: "/tradegraph/app/exportpulse/markets.html",
    detail: "/tradegraph/app/exportpulse/route-detail.html",
    docsReadiness: "/tradegraph/app/exportpulse/docs-readiness.html",
  };

  return buildUrl(mapping[page] || mapping.markets, params);
}

export function buildOpsUrl(page = "workspace", params = {}) {
  const mapping = {
    sources: "/tradegraph/app/ops/sources.html",
    alerts: "/tradegraph/app/ops/alerts.html",
    workspace: "/tradegraph/app/ops/workspace.html",
    billing: "/tradegraph/app/ops/billing.html",
    auditLog: "/tradegraph/app/ops/audit-log.html",
  };

  return buildUrl(mapping[page] || mapping.workspace, params);
}
