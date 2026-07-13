const normalize = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const MARKET_ALIASES = new Map([
  ["uk", "united kingdom"],
  ["uae", "united arab emirates"],
  ["ksa", "saudi arabia"],
]);

export const canonicalizeMarket = (value) => MARKET_ALIASES.get(normalize(value)) ?? normalize(value);

export function marketsMatch(left, right) {
  return canonicalizeMarket(left) === canonicalizeMarket(right);
}

function directMarketMatch(profile, market) {
  return profile.exportMarkets.some((item) => marketsMatch(item, market));
}

function credentialCoverage(profile, opportunity) {
  const profileSignals = new Set(
    [...profile.certifications, profile.iecStatus === "Active" ? "IEC" : "", "GST"].filter(Boolean).map(normalize),
  );
  const required = opportunity.requiredCredentials.map(normalize);

  if (!required.length) {
    return { ratio: 1, missing: [] };
  }

  const missing = required.filter((credential) => !profileSignals.has(credential));
  return {
    ratio: (required.length - missing.length) / required.length,
    missing,
  };
}

export function scoreExportOpportunity(opportunity, profile) {
  const sectorMatch = normalize(opportunity.sector) === normalize(profile.sector);
  const directMatch = directMarketMatch(profile, opportunity.market);
  const credentials = credentialCoverage(profile, opportunity);
  const readinessGap = profile.exportReadiness - opportunity.readinessThreshold;
  const baseScore = profile.exportReadiness * 0.35 + profile.evidenceScore * 0.1;
  const sectorScore = sectorMatch ? 20 : -16;
  const marketScore = directMatch ? 12 : profile.exportMarkets.length ? -4 : -8;
  const credentialScore =
    Math.round(credentials.ratio * 20) - (credentials.missing.length ? 6 : 0);
  const riskScore = profile.riskBand === "Low" ? 8 : profile.riskBand === "Medium" ? 2 : -10;
  const thresholdScore = readinessGap >= 0 ? 8 : readinessGap >= -6 ? 0 : -8;
  const totalScore = Math.max(
    0,
    Math.min(
      99,
      Math.round(baseScore + sectorScore + marketScore + credentialScore + riskScore + thresholdScore),
    ),
  );

  const reasons = [];
  const blockers = [];

  if (sectorMatch) {
    reasons.push("sector and manufacturing capability align with the market brief");
  } else {
    blockers.push("sector fit is weaker than the strongest visible route");
  }

  if (directMatch) {
    reasons.push(`existing export visibility into ${opportunity.market}`);
  } else {
    blockers.push(`no visible shipped-market proof for ${opportunity.market} yet`);
  }

  if (credentials.missing.length) {
    blockers.push(`missing readiness signals: ${credentials.missing.join(", ")}`);
  } else {
    reasons.push("required export and compliance credentials are visible");
  }

  if (profile.exportReadiness >= opportunity.readinessThreshold) {
    reasons.push("current export readiness already clears the market threshold");
  } else {
    blockers.push(`readiness is below the ${opportunity.readinessThreshold} threshold for this route`);
  }

  const readyNowEligible =
    sectorMatch &&
    credentials.missing.length === 0 &&
    profile.exportReadiness >= opportunity.readinessThreshold;
  const fixableRoute =
    sectorMatch &&
    credentials.missing.length <= 2 &&
    profile.exportReadiness >= opportunity.readinessThreshold - 8;

  return {
    totalScore,
    readinessBand:
      readyNowEligible && totalScore >= 82
        ? "Ready now"
        : fixableRoute && totalScore >= 68
          ? "Needs 1-2 fixes"
          : "Needs deeper work",
    directMatch,
    reasons,
    blockers,
  };
}

export function buildExportOpportunityView(opportunities, profile) {
  return opportunities
    .map((opportunity) => ({
      ...opportunity,
      analysis: scoreExportOpportunity(opportunity, profile),
    }))
    .sort((left, right) => right.analysis.totalScore - left.analysis.totalScore);
}

export function summarizeExportWorkspace(scored) {
  return {
    total: scored.length,
    readyNow: scored.filter((item) => item.analysis.readinessBand === "Ready now").length,
    needsFixes: scored.filter((item) => item.analysis.readinessBand === "Needs 1-2 fixes").length,
    highMargin: scored.filter((item) => item.marginBand === "High").length,
    directMarketMatches: scored.filter((item) => item.analysis.directMatch).length,
    averageScore: scored.length
      ? Math.round(scored.reduce((sum, item) => sum + item.analysis.totalScore, 0) / scored.length)
      : 0,
  };
}

export function getTopEntries(mapObject, limit = 4) {
  return Object.entries(mapObject)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);
}

export function buildMarketMix(scored) {
  return scored.reduce((accumulator, item) => {
    accumulator[item.region] = (accumulator[item.region] || 0) + 1;
    return accumulator;
  }, {});
}

export function buildBlockerMix(scored) {
  return scored.reduce((accumulator, item) => {
    const key = item.analysis.readinessBand;
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}
