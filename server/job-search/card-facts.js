import { hasOptCptCompatibilityEvidence } from "./authorization-evidence.js";
import { parseAnnualCompensation } from "./evaluation-framework.js";

const UNKNOWN_COMPANY = /^(unknown|unknown company|unknown until extraction|not listed|n\/a)?$/i;

const COMPENSATION_PATTERNS = [
  /(?:USD\s*)?\$\s?\d{2,6}(?:,\d{3})*(?:\.\d+)?[kKmM]?\s*(?:-|–|—|to)\s*(?:USD\s*)?\$?\s?\d{2,6}(?:,\d{3})*(?:\.\d+)?[kKmM]?(?:\s*(?:per|\/)?\s*(?:hour|hr|year|yr|annum|annually))?/i,
  /\b(?:salary|compensation|base pay|pay rate|pay range)\b[^$]{0,80}(?:USD\s*)?\$\s?\d{2,6}(?:,\d{3})*(?:\.\d+)?[kKmM]?(?:\s*(?:per|\/)?\s*(?:hour|hr|year|yr|annum|annually))?/i,
  /\b(?:base )?(?:salary|compensation|pay) (?:range|rate)\b[^.!?]{0,180}/i,
];

const VISA_PATTERNS = [
  {
    status: "not_available",
    label: "Sponsorship not available",
    pattern: /\b(?:not able to consider|unable to consider|will not consider|cannot consider|do not consider|does not consider)[^.]{0,120}(?:visa\s+)?sponsor(?:ship|ing)?\b|\b(?:no|not eligible for|unable to (?:offer|provide)|cannot (?:offer|provide)|does not (?:offer|provide)|will not (?:offer|provide)?|must not require)\s+(?:employment\s+|immigration\s+|visa\s+)?sponsor(?:ship|ing)?\b|\bwithout (?:current or future |now or in the future )?(?:visa )?sponsorship\b/i,
  },
  {
    status: "citizenship_required",
    label: "Citizenship or clearance requirement",
    pattern: /\b(?:u\.?s\.? citizen(?:ship)? required|must be (?:a )?u\.?s\.? citizen|security clearance required|active security clearance)\b/i,
  },
  {
    status: "available",
    label: "Sponsorship available",
    pattern: /\b(?:visa sponsorship (?:is )?available|sponsorship available|will (?:provide|offer) (?:visa )?sponsorship|we sponsor|eligible for sponsorship)\b/i,
  },
  {
    status: "work_authorization_required",
    label: "Work authorization requirement",
    pattern: /\b(?:must be|are) (?:legally )?authorized to work|\bwork authorization (?:is )?required\b|\bproof of (?:legal )?authorization to work\b/i,
  },
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function excerpt(text, index, matchLength, maxLength = 260) {
  const normalized = clean(text);
  const startBoundary = Math.max(
    normalized.lastIndexOf(". ", index),
    normalized.lastIndexOf("; ", index),
    normalized.lastIndexOf(": ", index),
  );
  const start = Math.max(0, startBoundary >= 0 ? startBoundary + 2 : index - 70);
  const afterMatch = index + matchLength;
  const endCandidates = [
    normalized.indexOf(". ", afterMatch),
    normalized.indexOf("; ", afterMatch),
  ].filter((value) => value >= 0);
  const naturalEnd = endCandidates.length ? Math.min(...endCandidates) + 1 : afterMatch + 90;
  const end = Math.min(normalized.length, Math.max(afterMatch, naturalEnd), start + maxLength);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end).trim()}${end < normalized.length ? "…" : ""}`;
}

function findPatternEvidence(text, patterns) {
  const normalized = clean(text);
  for (const item of patterns) {
    const pattern = item.pattern || item;
    const match = normalized.match(pattern);
    if (match) {
      return {
        item,
        value: clean(match[0]).slice(0, 180),
        passage: excerpt(normalized, match.index || 0, match[0].length),
      };
    }
  }
  return null;
}

function claimFor(claims, pattern) {
  return claims.find((claim) => claim?.evidenceType !== "unknown" && pattern.test(clean(claim?.claimType)));
}

function comparableJobUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const linkedInId = url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{8,})\/?$/i)?.[1];
    const indeedId = url.searchParams.get("jk");
    if (linkedInId) return `linkedin:${linkedInId}`;
    if (indeedId) return `indeed:${indeedId}`;
    return `${host}${url.pathname.replace(/\/$/, "").toLowerCase()}`;
  } catch {
    return "";
  }
}

function normalizedCompanyTokens(company) {
  return clean(company).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((token) => token.length >= 3 && !["the", "inc", "llc", "ltd", "corp", "corporation", "company", "group", "holdings"].includes(token));
}

function evidenceNamesCompany(text, company) {
  const normalized = clean(text).toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  const tokens = normalizedCompanyTokens(company);
  if (!tokens.length) return false;
  return tokens.length === 1
    ? normalized.includes(tokens[0])
    : tokens.filter((token) => normalized.includes(token)).length >= Math.min(2, tokens.length);
}

function evidenceNamesRole(text, title) {
  const ignored = new Set(["senior", "sr", "principal", "staff", "lead", "manager", "director", "head", "chief", "the", "and", "of"]);
  const tokens = clean(title).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((token) => token.length >= 3 && !ignored.has(token));
  if (!tokens.length) return false;
  const normalized = clean(text).toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  return tokens.filter((token) => normalized.includes(token)).length >= Math.min(2, tokens.length);
}

function normalizedLocationMarker(location) {
  const ignored = new Set(["remote", "hybrid", "onsite", "on site", "united states", "usa", "multiple locations"]);
  return clean(location).toLowerCase().split(/\s+-\s+|[,/|;]/)
    .map((part) => part.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim())
    .find((part) => part.length >= 4 && !ignored.has(part) && !/^[a-z]{2}$/.test(part)) || "";
}

function evidenceMatchesPosting(text, sourceUrl, job) {
  const evidenceUrl = comparableJobUrl(sourceUrl);
  const postingUrl = comparableJobUrl(job?.canonicalUrl || job?.url);
  if (evidenceUrl && postingUrl && evidenceUrl === postingUrl) return true;
  const location = normalizedLocationMarker(job?.location);
  return Boolean(location && clean(text).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").includes(location));
}

function claimMatchesPosting(claim, job) {
  const claimUrl = comparableJobUrl(claim?.sourceUrl);
  const postingUrl = comparableJobUrl(job?.canonicalUrl || job?.url);
  if (claimUrl && postingUrl && claimUrl === postingUrl) return true;
  if (!claimUrl) return false;
  const research = (job?.details?.research?.results || []).find((item) => comparableJobUrl(item?.url) === claimUrl);
  if (!research) return false;
  const researchText = clean(`${research.title || ""} ${research.description || ""}`);
  return evidenceNamesCompany(researchText, job?.company)
    && evidenceNamesRole(researchText, job?.title)
    && evidenceMatchesPosting(researchText, research?.url, job);
}

function employerEligibilityFact(job, claims) {
  const claim = claims.find((item) => {
    if (item?.evidenceType === "unknown" || claimMatchesPosting(item, job)) return false;
    const text = clean(`${item?.claimType || ""} ${item?.value || ""} ${item?.supportingPassage || ""}`);
    return /h-?1b|lca|perm|e-?verify|sponsor(?:ship|ing)?/i.test(text);
  });
  const storedEvidence = job?.details?.employerEligibilityEvidence || [];
  const stored = storedEvidence.find((item) => /h-?1b|lca|perm|sponsor(?:ship|ing)?/i.test(
    clean(`${item?.value || ""} ${item?.supportingPassage || ""}`),
  )) || storedEvidence[0];
  const item = claim || (stored ? {
    value: stored.value,
    supportingPassage: stored.supportingPassage,
    sourceUrl: stored.sourceUrl,
  } : null);
  if (!item) return null;
  const evidence = clean(item.supportingPassage || item.value);
  const sponsorshipHistory = /h-?1b|lca|perm|sponsor(?:ship|ing)?/i.test(evidence);
  return {
    status: "employer_history",
    label: sponsorshipHistory
      ? "Employer sponsorship history; this role is unverified"
      : "Employer eligibility history; this role is unverified",
    evidence,
    evidenceType: "inferred",
    sourceUrl: item.sourceUrl || "",
  };
}

function sourceHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source unavailable";
  }
}

function visaStatusFromText(value) {
  return findPatternEvidence(value, VISA_PATTERNS)?.item
    || (hasOptCptCompatibilityEvidence(value) ? {
      status: "opt_friendly",
      label: "F-1/OPT/CPT language found",
    } : {
    status: "evidence_found",
    label: "Eligibility evidence found",
    });
}

export function buildJobCardFacts(job) {
  const claims = job.details?.claims || [];
  const sourceEvidenceUrl = (job.details?.sourceEvidence || []).find((claim) => claim.sourceUrl)?.sourceUrl || "";
  const url = clean(job.canonicalUrl || job.url || sourceEvidenceUrl);
  const company = clean(job.company);
  const description = clean(job.description);
  const structuredCompensation = clean(job.details?.sourceMetadata?.compensation);
  const usableStructuredCompensation = structuredCompensation && parseAnnualCompensation(structuredCompensation)
    ? structuredCompensation
    : "";

  const candidateCompensationClaim = claimFor(
    claims.filter((claim) => claimMatchesPosting(claim, job)),
    /(compensation|salary|base_pay|pay_range)/i,
  );
  const compensationClaim = candidateCompensationClaim
    && !/^(not (specified|listed|available)|unknown|n\/?a)$/i.test(clean(candidateCompensationClaim.value))
    && (findPatternEvidence(`${candidateCompensationClaim.value} ${candidateCompensationClaim.supportingPassage || ""}`, COMPENSATION_PATTERNS)
      || /\b(equity|stock|rsu|bonus)\b/i.test(`${candidateCompensationClaim.value} ${candidateCompensationClaim.supportingPassage || ""}`))
    ? candidateCompensationClaim
    : null;
  const compensationMatch = findPatternEvidence(description, COMPENSATION_PATTERNS);
  const compensation = usableStructuredCompensation ? {
    status: "listed",
    label: usableStructuredCompensation,
    evidence: usableStructuredCompensation,
    evidenceType: "explicit",
    sourceUrl: url,
  } : compensationMatch ? {
    status: "listed",
    label: compensationMatch.value,
    evidence: compensationMatch.passage,
    evidenceType: "explicit",
    sourceUrl: url,
  } : compensationClaim ? {
    status: "listed",
    label: clean(compensationClaim.value),
    evidence: clean(compensationClaim.supportingPassage || compensationClaim.value),
    evidenceType: compensationClaim.evidenceType,
    sourceUrl: compensationClaim.sourceUrl || url,
  } : {
    status: "not_listed",
    label: "Not listed in the job posting",
    evidence: "",
    evidenceType: "unknown",
    sourceUrl: url,
  };

  const visaClaim = claimFor(
    claims.filter((claim) => claimMatchesPosting(claim, job)),
    /(visa|sponsor|work_authorization|immigration|citizenship|clearance)/i,
  );
  const visaMatch = findPatternEvidence(description, VISA_PATTERNS);
  const optCptMatch = !visaMatch && hasOptCptCompatibilityEvidence(description);
  const claimVisa = visaClaim ? visaStatusFromText(`${visaClaim.value} ${visaClaim.supportingPassage || ""}`) : null;
  const employerEligibility = employerEligibilityFact(job, claims);
  const visa = visaMatch ? {
    status: visaMatch.item.status,
    label: visaMatch.item.label,
    evidence: visaMatch.passage,
    evidenceType: "explicit",
    sourceUrl: url,
  } : visaClaim ? {
    status: claimVisa.status,
    label: claimVisa.label,
    evidence: clean(visaClaim.supportingPassage || visaClaim.value),
    evidenceType: visaClaim.evidenceType,
    sourceUrl: visaClaim.sourceUrl || url,
  } : optCptMatch ? {
    status: "opt_friendly",
    label: "F-1/OPT/CPT language found",
    evidence: findPatternEvidence(description, [
      /\b(?:F-?1(?:\s+(?:visa|student|status|OPT|CPT))?|STEM\s+OPT|optional practical training|curricular practical training)\b/i,
      /\b(?:visa|immigration|international student|student visa|work authorization|employment authorization|practical training)\b[^.!?]{0,100}\b(?:OPT|CPT)\b/i,
      /\b(?:OPT|CPT)\b[^.!?]{0,100}\b(?:visa|immigration|international student|student visa|work authorization|employment authorization|practical training)\b/i,
    ])?.passage || "Immigration-context F-1/OPT/CPT language appears in the posting.",
    evidenceType: "explicit",
    sourceUrl: url,
  } : employerEligibility || {
    status: "unknown",
    label: "No explicit sponsorship evidence",
    evidence: "",
    evidenceType: "unknown",
    sourceUrl: url,
  };

  return {
    company: {
      status: company && !UNKNOWN_COMPANY.test(company) ? "identified" : "unknown",
      label: company && !UNKNOWN_COMPANY.test(company) ? company : "Company not identified",
    },
    posting: {
      status: url ? "available" : "missing",
      url,
      host: sourceHost(url),
    },
    compensation,
    visa,
  };
}
