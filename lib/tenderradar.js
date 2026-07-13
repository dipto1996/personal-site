const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toSet = (values = []) => new Set(values.map((value) => normalize(value)).filter(Boolean));

const getDaysUntil = (dateString, referenceDate = new Date()) => {
  const baseline = new Date(referenceDate);
  baseline.setHours(0, 0, 0, 0);
  const target = new Date(`${dateString}T00:00:00`);
  const diff = target.getTime() - baseline.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
};

const getUrgency = (daysLeft) => {
  if (daysLeft <= 6) {
    return "Closing soon";
  }

  if (daysLeft <= 14) {
    return "Planning window";
  }

  return "Longer lead";
};

const countMatches = (base, target) => {
  const baseSet = toSet(base);
  const targetSet = toSet(target);

  let matches = 0;
  targetSet.forEach((value) => {
    if (baseSet.has(value)) {
      matches += 1;
    }
  });

  return matches;
};

export function scoreTender(opportunity, profile) {
  const profileSignals = [...(profile.categories || []), ...(profile.keywords || [])];
  const opportunitySignals = [opportunity.title, opportunity.scopeSummary, ...((opportunity.keywords || []))];
  const keywordMatches = countMatches(profileSignals, opportunitySignals);
  const credentialMatches = countMatches(profile.credentials || [], opportunity.requiredCredentials || []);
  const hasStateMatch =
    (profile.states || []).includes("Pan-India") || (profile.states || []).includes(opportunity.state);
  const prefersBuyerType = (profile.preferredBuyerTypes || []).includes(opportunity.buyerType);
  const valueRatio = opportunity.estimatedValueCrore / profile.annualTurnoverCrore;
  const valueFit = valueRatio <= 0.45 ? 1 : valueRatio <= 0.7 ? 0.78 : valueRatio <= 1 ? 0.48 : 0.14;
  const turnoverEligible = profile.annualTurnoverCrore >= opportunity.minTurnoverCrore;
  const projectEligible = (profile.pastProjectsCount || 0) >= opportunity.minPastProjects;
  const soloBidEligible = turnoverEligible && projectEligible;

  const keywordScore = Math.min(34, keywordMatches * 7);
  const credentialScore =
    opportunity.requiredCredentials.length === 0
      ? 18
      : Math.round((credentialMatches / opportunity.requiredCredentials.length) * 24);
  const stateScore = hasStateMatch ? 12 : 4;
  const buyerTypeScore = prefersBuyerType ? 10 : 4;
  const valueScore = Math.round(valueFit * 20);
  const turnoverScore = turnoverEligible ? 8 : -10;
  const projectScore = projectEligible ? 8 : -8;

  const totalScore = Math.max(
    0,
    Math.min(
      100,
      keywordScore +
        credentialScore +
        stateScore +
        buyerTypeScore +
        valueScore +
        turnoverScore +
        projectScore,
    ),
  );
  const daysLeft = getDaysUntil(opportunity.closingDate);
  const reasons = [];
  const gaps = [];

  if (keywordMatches > 0) {
    reasons.push(`${keywordMatches} scope matches across category and scope text`);
  } else {
    gaps.push("weak direct category match");
  }

  if (credentialMatches === opportunity.requiredCredentials.length) {
    reasons.push("all visible mandatory credentials covered");
  } else {
    const missing = (opportunity.requiredCredentials || []).filter(
      (credential) => !toSet(profile.credentials || []).has(normalize(credential)),
    );
    if (missing.length) {
      gaps.push(`missing: ${missing.join(", ")}`);
    }
  }

  if (hasStateMatch) {
    reasons.push("operates in the tender geography");
  } else {
    gaps.push("geographic fit is weaker");
  }

  if (prefersBuyerType) {
    reasons.push(`buyer type aligns with ${profile.label}`);
  }

  if (valueRatio > 0.7) {
    gaps.push("ticket size may strain SME capacity");
  } else {
    reasons.push("ticket size is realistic for the profile");
  }

  if (turnoverEligible) {
    reasons.push("turnover clears the visible eligibility threshold");
  } else {
    gaps.push(`turnover below required threshold (${formatCrore(opportunity.minTurnoverCrore)})`);
  }

  if (projectEligible) {
    reasons.push("reference-project count clears the visible threshold");
  } else {
    gaps.push(`past project count is below the required ${opportunity.minPastProjects}`);
  }

  const hasCommercialMatch = keywordMatches > 0;
  const fitBand =
    totalScore >= 78 && soloBidEligible && hasCommercialMatch
      ? "High fit"
      : totalScore >= 56 && hasCommercialMatch && (soloBidEligible || credentialMatches > 0)
        ? "Medium fit"
        : "Low fit";

  return {
    totalScore,
    fitBand,
    daysLeft,
    urgency: getUrgency(daysLeft),
    reasons,
    gaps,
    soloBidEligible,
    turnoverEligible,
    projectEligible,
  };
}

export function buildRadarView(opportunities, profile) {
  const scored = opportunities
    .map((opportunity) => ({
      ...opportunity,
      analysis: scoreTender(opportunity, profile),
    }))
    .sort((left, right) => {
      if (right.analysis.totalScore !== left.analysis.totalScore) {
        return right.analysis.totalScore - left.analysis.totalScore;
      }

      return left.analysis.daysLeft - right.analysis.daysLeft;
    });

  return scored;
}

export function summarizeRadar(scored) {
  const counts = {
    matched: scored.length,
    highFit: scored.filter((item) => item.analysis.fitBand === "High fit").length,
    closingSoon: scored.filter((item) => item.analysis.urgency === "Closing soon").length,
    shortlistReady: scored.filter(
      (item) =>
        item.analysis.soloBidEligible &&
        item.analysis.fitBand !== "Low fit" &&
        item.analysis.gaps.length <= 2,
    ).length,
  };

  const buyerMix = scored.reduce((accumulator, item) => {
    accumulator[item.buyerType] = (accumulator[item.buyerType] || 0) + 1;
    return accumulator;
  }, {});

  const sectorMix = scored.reduce((accumulator, item) => {
    accumulator[item.sector] = (accumulator[item.sector] || 0) + 1;
    return accumulator;
  }, {});

  const averageValueCrore = scored.length
    ? scored.reduce((sum, item) => sum + item.estimatedValueCrore, 0) / scored.length
    : 0;

  return {
    counts,
    buyerMix,
    sectorMix,
    averageValueCrore,
  };
}

export function formatCrore(value) {
  return `Rs ${value.toFixed(1)} Cr`;
}

export function formatLakh(value) {
  return `Rs ${value.toFixed(1)} L`;
}

export function getTopEntries(mapObject, limit = 4) {
  return Object.entries(mapObject)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);
}
