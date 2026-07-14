import { TARGET_PROFILE } from "./profile.js";
import { classifyCandidateTitle } from "./title-ontology.js";
import {
  hasOptCptCompatibilityEvidence,
  hasOptCptIncompatibilityEvidence,
  SPONSORSHIP_AVAILABLE_PATTERN,
} from "./authorization-evidence.js";

export const EVALUATION_FRAMEWORK_VERSION = "analytics-first-gates-2026-07-v12";

export const EVALUATION_WEIGHTS = Object.freeze({ ...TARGET_PROFILE.rankingWeights });

export const DIMENSION_LABELS = Object.freeze({
  expertiseFit: "Expertise fit",
  workAuthorization: "Visa / OPT compatibility",
  compensation: "Compensation",
  codingInterviewSafety: "No-coding-interview confidence",
  leadershipScope: "Leadership and scope",
  companyQuality: "Company quality",
  interviewVelocity: "Interview velocity",
  aiMlProductAdjacency: "AI / ML product adjacency",
  financialServicesAdvantage: "Financial-services advantage",
  remoteFlexibility: "Remote flexibility",
});

const LEGACY_DIMENSIONS = Object.freeze({
  roleFit: "expertiseFit",
  locationAuthorization: "workAuthorization",
  compensationUpside: "compensation",
  codingInterviewRisk: "codingInterviewSafety",
  leadershipLevel: "leadershipScope",
  aiDataRelevance: "aiMlProductAdjacency",
});

const BLOCKED_SPONSORSHIP = /\b(?:not able to consider|unable to consider|will not consider|cannot consider|do not consider|does not consider|no|not eligible for|unable to (?:offer|provide)|cannot (?:offer|provide)|does not (?:offer|provide)|will not (?:offer|provide))[^.]{0,100}(?:visa\s+)?sponsor(?:ship|ing)?\b|\bwithout (?:current or future |now or in the future )?(?:visa )?sponsorship\b/i;
const CITIZENSHIP_BLOCK = /\b(?:u\.?s\.? citizen(?:ship)? required|must be (?:a )?u\.?s\.? citizen|security clearance required|active security clearance)\b/i;
const EVERIFY_HISTORY = /\bE-Verify\b/i;
const SPONSORSHIP_HISTORY = /\b(?:H-1B employer data|H-1B petitions?|certified LCA|LCA disclosure)\b/i;
const CODING_INTERVIEW_BLOCK = /\b(?:leetcode|data structures and algorithms|algorithms and data structures|live coding|take-home coding|coding (?:challenge|exercise|screen|assessment|interview|round)|(?:sql|python|r) (?:coding )?(?:test|exercise|challenge|screen|assessment|interview))\b/i;
const NO_CODING_INTERVIEW = /\b(?:no|without) (?:live )?coding\b|\bno (?:leetcode|coding (?:challenge|exercise|screen|assessment|interview|round))\b/i;
const ENGINEERING_TITLE = /\b(?:software|backend|front[ -]?end|full[ -]?stack|infrastructure|site reliability|data|analytics|machine learning|ml) engineer(?:ing)?\b|\bdeveloper\b/i;
const MANAGEMENT_TITLE = /\b(?:manager|director|head|chief|vice president|vp|general manager)\b/i;
const CODING_BOUND_SCIENCE_IC_TITLE = /\b(?:data scientist|applied scientist|research scientist|machine learning scientist|ml scientist|quantitative researcher|quantitative developer)\b/i;
const PRODUCT_SCIENCE_EXCEPTION = /\b(?:product scientist|product data scientist|decision scientist)\b/i;
const LEADERSHIP_TITLE = /\b(?:manager|director|head|chief|vice president|vp|general manager|lead)\b/i;
const ELEVATED_TECHNICAL_TITLE = /\b(?:product scientist|product data scientist|decision scientist|experimentation scientist|measurement scientist|marketing scientist|data science (?:manager|director|lead|head)|(?:manager|director|head)[^a-z0-9]{0,3}(?:of )?data science|product analytics (?:manager|lead)|experimentation (?:manager|lead)|(?:senior|principal|staff) (?:data|product|marketing|growth|business) analyst)\b/i;
const LOW_CODING_LEADERSHIP_TITLE = /\b(?:analytics|data analysis|insights|business intelligence|strategy|data product|product manager|product management|program manager|business manager|chief of staff|governance|risk|operations)\b/i;
const HANDS_ON_IMPLEMENTATION = /\bhands-on\b[^.]{0,100}\b(?:coding|python|sql|software development|model development|machine learning engineering)\b|\b(?:write|develop|deploy|maintain|productionize)\b[^.]{0,100}\b(?:production code|software services|machine learning models|ml models)\b/i;
const TECHNICAL_IMPLEMENTATION_REQUIREMENTS = /\b(?:\d+\+?\s*years?[^.]{0,80}(?:python|software engineering|open source data technolog|api|data pipeline|feature engineering)|developing with open source data technolog|build and maintain scalable data pipelines|production-ready solutions)\b/i;
const TECHNICAL_ASSESSMENT_RISK = /\b(?:proficien(?:t|cy)|advanced|expert|strong|hands-on)[^.!?]{0,90}\b(?:python|sql|scala|r programming|programming language)\b|\b(?:python|sql|scala|r)\b[^.!?]{0,55}\b(?:proficien(?:t|cy)|coding|programming|hands-on)\b/i;
const EXPLICIT_ENGINEERING_IDENTITY = /\b(?:you are|seeks?|seeking|looking for|hiring|position is for|role is for)\b[^.!?]{0,100}\b(?:ai\s*(?:&|and)?\s*automation|data|software|machine learning|ml|platform|context|research) engineer\b/i;
const EXCLUDED_NON_CORE_TITLE = /\b(?:counsel|attorney|lawyer)\b|\b(?:bipartisan\s+)?(?:federal|legislative)\s+policy\s+(?:lead|director|manager|head)\b/i;
const NON_VACANCY_TITLE = /\b(?:open positions?|current openings?|career opportunities|careers?\s*(?:and|&)\s*internships?|explore careers?|jobs?\s*(?:and|&)\s*careers?)\b|\b(?:artificial intelligence|ai|data science)[^|]{0,45}\bjobs?\b\s*[|:-]/i;
const ARTICLE_TITLE = /\bhow to\b[^|]{0,100}\bjob\b|\b(?:guide|tips?|advice)\b[^|]{0,80}\b(?:interview|job search|hiring)\b/i;
const MULTI_ROLE_PAGE = /\b(?:showing\s+\d+\s*-\s*\d+\s+of\s+\d+\s+results|filter results|search within these results|refine results)\b/i;
const SPECIFIC_VACANCY_LANGUAGE = /\b(?:responsibilities|qualifications|requirements|about the role|what you(?:'|’)ll do|what we(?:'|’)re looking for|required experience|job description)\b/i;
const SPECIALIST_MANDATORY_GAPS = Object.freeze([
  { id: "healthcare_claims", label: "health-insurance claims experience", pattern: /\b(?:health insurance|medical|pharmacy) claims? data\b/i },
  { id: "emr_ehr", label: "multi-hospital EMR/EHR experience", pattern: /\b(?:emr|ehr|electronic medical records?)\b/i },
  { id: "medical_codes", label: "specialized medical coding systems", pattern: /\b(?:icd(?:\s*-?\s*10)?|cpt|ndc|drg|medical and pharmacy codes?)\b/i },
  { id: "hl7", label: "HL7 expertise", pattern: /\bhl7\b/i },
  { id: "payer_provider", label: "payer/provider contracting experience", pattern: /\b(?:payer|health plan)[^.!?]{0,100}(?:provider|health system)[^.!?]{0,100}(?:contract|negotiat)|\bvalue-based care models?\b/i },
]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clean(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function classifyVacancyIntegrity(job) {
  const title = clean(job?.title);
  const description = clean(job?.description);
  let hostname = "";
  try {
    hostname = new URL(job?.canonicalUrl || "").hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    hostname = "";
  }
  const titleSignalsLanding = NON_VACANCY_TITLE.test(title);
  const titleSignalsArticle = ARTICLE_TITLE.test(title);
  const newsArticle = /(?:^|\.)(?:businessinsider|forbes|fortune|fastcompany|techcrunch)\.com$/i.test(hostname)
    && !SPECIFIC_VACANCY_LANGUAGE.test(description);
  const aggregatesRoles = MULTI_ROLE_PAGE.test(description);
  const lacksSpecificDuties = description.length < 350 || !SPECIFIC_VACANCY_LANGUAGE.test(description);
  if (titleSignalsArticle || newsArticle) {
    return { status: "blocked", reason: "The source is an article or career advice page, not a specific job vacancy.", sourceUrl: job?.canonicalUrl || "", signals: ["article"] };
  }
  if (aggregatesRoles) {
    return { status: "blocked", reason: "The source aggregates multiple openings and is not one specific vacancy.", sourceUrl: job?.canonicalUrl || "", signals: ["multi_role_page"] };
  }
  if (titleSignalsLanding && lacksSpecificDuties) {
    return { status: "blocked", reason: "The source is a careers landing page without one role's responsibilities and requirements.", sourceUrl: job?.canonicalUrl || "", signals: ["career_landing_page"] };
  }
  return { status: "met", reason: "The source represents a specific vacancy.", sourceUrl: job?.canonicalUrl || "", signals: [] };
}

function deterministicExpertiseConstraint(job) {
  const vacancy = classifyVacancyIntegrity(job);
  if (vacancy.status === "blocked") {
    return { blocked: true, maxScore: 0, evidenceStatus: "explicit", reason: vacancy.reason, signals: vacancy.signals, vacancy };
  }
  const title = clean(job?.title);
  const description = clean(job?.description);
  const ontology = classifyCandidateTitle(title);
  if (EXCLUDED_NON_CORE_TITLE.test(title)) {
    return { blocked: true, maxScore: 1, evidenceStatus: "explicit", reason: "The vacancy's primary function is legal counsel or federal legislative policy, not analytics, experimentation, data science, strategy analytics, or data-product leadership.", signals: ["excluded_non_core_title"], vacancy };
  }
  if ((ontology.excludedConcepts?.length && !ontology.eligible) || EXPLICIT_ENGINEERING_IDENTITY.test(description)) {
    return { blocked: true, maxScore: 1, evidenceStatus: "explicit", reason: "The vacancy's primary function is hands-on engineering implementation rather than analytics, data-science management, strategy analytics, or product leadership.", signals: ["engineering_implementation"], vacancy };
  }
  const specialistGaps = SPECIALIST_MANDATORY_GAPS.filter((item) => item.pattern.test(description));
  if (/\b(?:required job qualifications|required qualifications|what you need|requirements)\b/i.test(description) && specialistGaps.length >= 3) {
    return {
      blocked: true,
      maxScore: 2,
      evidenceStatus: "explicit",
      reason: `The role is analytically adjacent, but it requires several severe specialist capabilities absent from the resume: ${specialistGaps.map((item) => item.label).join(", ")}.`,
      signals: specialistGaps.map((item) => item.id),
      vacancy,
    };
  }
  return { blocked: false, maxScore: 5, evidenceStatus: "inferred", reason: "", signals: [], vacancy };
}

function normalizeDimension(value, fallbackReason = "Evidence not established.") {
  const numeric = value?.score === null || value?.score === undefined || value?.score === ""
    ? null
    : Number(value.score);
  const evidenceStatus = ["explicit", "inferred", "unknown"].includes(value?.evidenceStatus)
    ? value.evidenceStatus
    : "unknown";
  return {
    score: evidenceStatus === "unknown" ? null : Number.isFinite(numeric) ? Math.round(clamp(numeric, 0, 5) * 10) / 10 : null,
    evidenceStatus,
    confidence: Number.isFinite(Number(value?.confidence)) ? clamp(Number(value.confidence), 0, 1) : 0,
    reasoning: clean(value?.reasoning) || fallbackReason,
  };
}

function normalizeDimensions(input = {}) {
  const mapped = { ...input };
  for (const [legacy, current] of Object.entries(LEGACY_DIMENSIONS)) {
    if (!mapped[current] && mapped[legacy]) mapped[current] = mapped[legacy];
  }
  return Object.fromEntries(Object.keys(EVALUATION_WEIGHTS).map((key) => [key, normalizeDimension(mapped[key])]));
}

function numericSalary(value, suffix = "", { hourly = false } = {}) {
  const parsed = Number.parseFloat(String(value || "").replaceAll(",", ""));
  if (!Number.isFinite(parsed)) return null;
  if (hourly) return parsed;
  if (/k/i.test(suffix) || parsed > 0 && parsed < 1000) return Math.round(parsed * 1000);
  return Math.round(parsed);
}

export function parseAnnualCompensation(value) {
  const text = clean(value);
  if (!text) return null;
  const range = text.match(/(?:USD\s*)?\$?\s*(\d{2,3}(?:,\d{3})*(?:\.\d+)?)\s*([kK]?)\s*(?:-|–|—|to)\s*(?:USD\s*)?\$?\s*(\d{2,3}(?:,\d{3})*(?:\.\d+)?)\s*([kK]?)/i);
  const single = !range && text.match(/(?:USD\s*|\$\s*)(\d{2,3}(?:,\d{3})*(?:\.\d+)?)\s*([kK]?)/i);
  if (!range && !single) return null;
  const rawMinimum = Number.parseFloat(String(range?.[1] || single?.[1] || "").replaceAll(",", ""));
  const currencyOrThousandsMarked = /(?:USD|\$)/i.test(range?.[0] || single?.[0] || "")
    || Boolean(range?.[2] || range?.[4] || single?.[2]);
  const hourly = /(?:per|\/|a)\s*(?:hour|hr)\b|\bhourly\b/i.test(text);
  const hasThousandsSuffix = Boolean(range?.[2] || range?.[4] || single?.[2]);
  const compactAnnualContext = /\b(?:annual|annually|year|yearly|salary|base|pay range|compensation)\b/i.test(text);
  const rawMaximum = Number.parseFloat(String(range?.[3] || range?.[1] || single?.[1] || "").replaceAll(",", ""));
  if (!hourly && !hasThousandsSuffix && rawMinimum < 1000 && rawMaximum < 1000) {
    const plausibleAbbreviatedAnnualRange = Boolean(range) && rawMinimum >= 100 && rawMaximum >= 100 && compactAnnualContext;
    const plausibleAbbreviatedAnnualSingle = Boolean(single) && rawMinimum >= 100 && compactAnnualContext;
    if (!plausibleAbbreviatedAnnualRange && !plausibleAbbreviatedAnnualSingle) return null;
  }
  if (!currencyOrThousandsMarked && !hourly && rawMinimum < 40) return null;
  let minimum = numericSalary(range?.[1] || single?.[1], range?.[2] || single?.[2], { hourly });
  let maximum = numericSalary(range?.[3] || range?.[1] || single?.[1], range?.[4] || range?.[2] || single?.[2], { hourly });
  if (!minimum || !maximum) return null;
  if (hourly) {
    minimum = Math.round(minimum * 2080);
    maximum = Math.round(maximum * 2080);
  }
  const totalCompensationOnly = (/\b(?:total (?:annual )?compensation|total rewards?|on-target earnings|OTE)\b/i.test(text)
      || /\b(?:compensation|pay range)\b[^.!?]{0,160}\b(?:including|includes)\b[^.!?]{0,80}\b(?:bonus|equity|stock|commission)\b/i.test(text))
    && !/\b(?:base(?: salary| pay)?|salary range)\b/i.test(text);
  return {
    minimum: Math.min(minimum, maximum),
    maximum: Math.max(minimum, maximum),
    text,
    hourly,
    compensationType: totalCompensationOnly ? "total" : "base_or_salary",
  };
}

function relevantClaims(job, pattern) {
  return [...(job?.details?.sourceEvidence || []), ...(job?.details?.claims || [])]
    .filter((claim) => pattern.test(clean(claim?.claimType)))
    .map((claim) => ({
      claimType: clean(claim?.claimType),
      text: clean(`${claim.value || ""} ${claim.supportingPassage || ""}`),
      sourceUrl: claim.sourceUrl || job?.canonicalUrl || "",
      evidenceType: claim.evidenceType || "inferred",
    }));
}

function researchEvidence(job) {
  return (job?.details?.research?.results || []).map((item) => ({
    text: clean(`${item.title || ""} ${item.description || ""}`),
    sourceUrl: item.url || "",
    evidenceType: "inferred",
  }));
}

function employerEvidence(job) {
  return (job?.details?.employerEligibilityEvidence || []).map((item) => ({
    text: clean(`${item.company || ""} ${item.value || ""} ${item.supportingPassage || ""}`),
    sourceUrl: item.sourceUrl || "",
    evidenceType: "inferred",
  }));
}

function normalizedCompanyTokens(company) {
  return clean(company).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((token) => token.length >= 3 && !["the", "inc", "llc", "ltd", "corp", "corporation", "company", "group", "holdings"].includes(token));
}

function evidenceNamesCompany(item, company) {
  const text = clean(item?.text).toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  const tokens = normalizedCompanyTokens(company);
  if (!tokens.length) return false;
  return tokens.length === 1 ? text.includes(tokens[0]) : tokens.filter((token) => text.includes(token)).length >= Math.min(2, tokens.length);
}

function evidenceNamesRole(item, title) {
  const ignored = new Set(["senior", "sr", "principal", "staff", "lead", "manager", "director", "head", "chief", "the", "and", "of"]);
  const tokens = clean(title).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((token) => token.length >= 3 && !ignored.has(token));
  if (!tokens.length) return false;
  const text = clean(item?.text).toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  const required = Math.min(2, tokens.length);
  return tokens.filter((token) => text.includes(token)).length >= required;
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

function normalizedLocationMarker(location) {
  const ignored = new Set(["remote", "hybrid", "onsite", "on site", "united states", "usa", "multiple locations"]);
  return clean(location).toLowerCase().split(/\s+-\s+|[,/|;]/)
    .map((part) => part.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim())
    .find((part) => part.length >= 4 && !ignored.has(part) && !/^[a-z]{2}$/.test(part)) || "";
}

function evidenceMatchesJobPosting(item, job) {
  const evidenceUrl = comparableJobUrl(item?.sourceUrl);
  const postingUrl = comparableJobUrl(job?.canonicalUrl);
  if (evidenceUrl && postingUrl && evidenceUrl === postingUrl) return true;
  const locationMarker = normalizedLocationMarker(job?.location);
  if (!locationMarker) return false;
  const text = clean(item?.text).toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  return text.includes(locationMarker);
}

function claimMatchesJobPosting(claim, job) {
  const claimUrl = comparableJobUrl(claim?.sourceUrl);
  const postingUrl = comparableJobUrl(job?.canonicalUrl);
  if (claimUrl && postingUrl && claimUrl === postingUrl) return true;
  const matchingResearch = researchEvidence(job).find((item) => (
    claimUrl && comparableJobUrl(item.sourceUrl) === claimUrl
  ));
  return Boolean(matchingResearch
    && evidenceNamesCompany(matchingResearch, job?.company)
    && evidenceNamesRole(matchingResearch, job?.title)
    && evidenceMatchesJobPosting(matchingResearch, job));
}

function officialEligibilitySource(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "dol.gov" || host.endsWith(".dol.gov")
      || host === "uscis.gov" || host.endsWith(".uscis.gov")
      || host === "e-verify.gov" || host.endsWith(".e-verify.gov")
      || host === "dhs.gov" || host.endsWith(".dhs.gov");
  } catch {
    return false;
  }
}

function compensationEvidence(job) {
  const structured = clean(job?.details?.sourceMetadata?.compensation);
  const candidates = [
    ...(structured ? [{ text: structured, sourceUrl: job?.canonicalUrl || "", evidenceType: "explicit" }] : []),
    ...relevantClaims(job, /(compensation|salary|base_pay|pay_range)/i)
      .filter((claim) => claimMatchesJobPosting(claim, job)),
  ];
  const description = clean(job?.description);
  const numericSalaryRange = description.match(/\b(?:total (?:annual )?compensation|total rewards?|on-target earnings|OTE|salar(?:y|ies)|compensation|base pay|pay range|pays?|hourly rate|wage)\b[^$]{0,140}(?:USD\s*)?\$\s?\d{2,6}(?:,\d{3})*(?:\.\d+)?[kK]?\s*(?:-|–|—|to)\s*(?:USD\s*)?\$?\s?\d{2,6}(?:,\d{3})*(?:\.\d+)?[kK]?(?:\s*(?:per|\/|a)?\s*(?:hour|hr|year|yr|annum|annually))?(?:[^.!?]{0,100}\b(?:including|includes)\b[^.!?]{0,80}\b(?:bonus|equity|stock|commission)\b)?/i)?.[0];
  const locationSalaryRange = description.match(/\b[A-Za-z][A-Za-z .'-]{1,80},\s*[A-Z]{2}:\s*(?:USD\s*)?\$\s?\d{2,6}(?:,\d{3})*(?:\.\d+)?[kK]?\s*(?:-|–|—|to)\s*(?:USD\s*)?\$?\s?\d{2,6}(?:,\d{3})*(?:\.\d+)?[kK]?/i)?.[0];
  const salarySentence = numericSalaryRange
    || locationSalaryRange
    || description.match(/[^.!?]{0,100}\b(?:salar(?:y|ies)|compensation|base pay|pay range|pays?|hourly rate|wage)\b[^.!?]{0,260}/i)?.[0];
  if (salarySentence) candidates.push({ text: salarySentence, sourceUrl: job?.canonicalUrl || "", evidenceType: "explicit" });
  candidates.push(...researchEvidence(job).filter((item) => (
    evidenceNamesCompany(item, job?.company)
      && evidenceNamesRole(item, job?.title)
      && evidenceMatchesJobPosting(item, job)
      && /base salary|salary range|base pay|pay range|\$\s*\d/i.test(item.text)
  )));
  for (const candidate of candidates) {
    const parsed = parseAnnualCompensation(candidate.text);
    if (parsed && parsed.compensationType !== "total") return { ...parsed, ...candidate };
  }
  return null;
}

function authorizationEvidence(job) {
  const posting = { text: clean(job?.description), sourceUrl: job?.canonicalUrl || "", evidenceType: "explicit" };
  const claims = relevantClaims(job, /(visa|sponsor|work_authorization|immigration|citizenship|clearance|h1b|opt|everify)/i);
  const research = [...employerEvidence(job), ...researchEvidence(job)];
  const jobClaims = claims.filter((item) => !officialEligibilitySource(item.sourceUrl)
    && !/employer|history|e-?verify|lca/i.test(item.claimType || "")
    && claimMatchesJobPosting(item, job));
  const roleSpecificResearch = research.filter((item) => !officialEligibilitySource(item.sourceUrl)
    && evidenceNamesCompany(item, job?.company)
    && evidenceNamesRole(item, job?.title)
    && evidenceMatchesJobPosting(item, job));
  const jobLevelEvidence = [posting, ...jobClaims, ...roleSpecificResearch];
  const blocked = jobLevelEvidence.find((item) => (
    BLOCKED_SPONSORSHIP.test(item.text) || CITIZENSHIP_BLOCK.test(item.text) || hasOptCptIncompatibilityEvidence(item.text)
  ));
  if (blocked) return {
    status: "blocked",
    evidenceStatus: blocked.evidenceType,
    reason: CITIZENSHIP_BLOCK.test(blocked.text)
      ? "The posting requires citizenship or security clearance."
      : "The posting explicitly excludes candidates requiring current or future visa sponsorship.",
    sourceUrl: blocked.sourceUrl,
  };
  const available = jobLevelEvidence.find((item) => SPONSORSHIP_AVAILABLE_PATTERN.test(item.text));
  if (available) return {
    status: "met",
    evidenceStatus: available.evidenceType,
    reason: "The supplied job-level evidence explicitly indicates visa sponsorship is available.",
    sourceUrl: available.sourceUrl,
  };
  const optCompatible = jobLevelEvidence.find((item) => hasOptCptCompatibilityEvidence(item.text));
  if (optCompatible) return {
    status: "unknown",
    evidenceStatus: optCompatible.evidenceType,
    reason: "The posting indicates F-1/OPT/CPT compatibility, but credible future sponsorship is not yet established.",
    sourceUrl: optCompatible.sourceUrl,
  };
  const employerHistory = research.filter((item) => officialEligibilitySource(item.sourceUrl) && evidenceNamesCompany(item, job?.company));
  const everify = employerHistory.find((item) => EVERIFY_HISTORY.test(item.text));
  const sponsorship = employerHistory.find((item) => SPONSORSHIP_HISTORY.test(item.text));
  if (everify && sponsorship) return {
    status: "met",
    evidenceStatus: "inferred",
    reason: "Official employer-level evidence indicates both E-Verify participation and recent H-1B/LCA activity; the job itself does not contradict it.",
    sourceUrl: sponsorship.sourceUrl,
  };
  if (everify || sponsorship) return {
    status: "unknown",
    evidenceStatus: "inferred",
    reason: everify
      ? "Official evidence indicates E-Verify participation, but future sponsorship history is not yet established."
      : "Official evidence indicates H-1B/LCA history, but E-Verify participation for STEM OPT is not yet established.",
    sourceUrl: (everify || sponsorship).sourceUrl,
  };
  return { status: "unknown", evidenceStatus: "unknown", reason: "F-1 OPT/STEM OPT and future sponsorship compatibility are not yet verified.", sourceUrl: "" };
}

export function classifyCodingInterviewRisk(job) {
  const title = clean(job?.title);
  const description = clean(job?.description);
  const vacancy = classifyVacancyIntegrity(job);
  if (vacancy.status === "blocked") return {
    status: "unknown",
    evidenceStatus: "unknown",
    basis: "deterministic",
    riskLevel: "unknown",
    suggestedScore: null,
    reason: "Coding-interview risk cannot be evaluated because the source is not a specific vacancy.",
    sourceUrl: "",
  };
  const posting = { text: description, sourceUrl: job?.canonicalUrl || "", evidenceType: "explicit" };
  const claims = relevantClaims(job, /(coding|interview|assessment|technical_screen|sql_test|python_test)/i);
  const researched = researchEvidence(job).filter((item) => (
    evidenceNamesCompany(item, job?.company) && evidenceNamesRole(item, title)
  ));
  const evidence = [posting, ...claims, ...researched];
  const explicitBlocker = evidence.find((item) => CODING_INTERVIEW_BLOCK.test(item.text) && !NO_CODING_INTERVIEW.test(item.text));
  if (explicitBlocker) return {
    status: "blocked",
    evidenceStatus: explicitBlocker.evidenceType,
    riskLevel: "confirmed",
    suggestedScore: 0,
    reason: "Role-specific evidence identifies a live coding, SQL/Python coding, algorithms, or LeetCode-style assessment.",
    sourceUrl: explicitBlocker.sourceUrl,
  };
  const explicitSafe = evidence.find((item) => NO_CODING_INTERVIEW.test(item.text));
  if (explicitSafe) return {
    status: "met",
    evidenceStatus: explicitSafe.evidenceType,
    riskLevel: "low",
    suggestedScore: 5,
    reason: "Role-specific evidence states that no coding interview is required.",
    sourceUrl: explicitSafe.sourceUrl,
  };

  const ontology = classifyCandidateTitle(title);
  if ((ENGINEERING_TITLE.test(title) && !MANAGEMENT_TITLE.test(title)) || EXPLICIT_ENGINEERING_IDENTITY.test(description)) return {
    status: "blocked",
    evidenceStatus: "inferred",
    basis: "deterministic",
    riskLevel: "near_certain",
    suggestedScore: 0,
    reason: "This is an engineering IC archetype in which coding interviews are a near-certain part of the hiring process, even though this posting does not describe the interview stages.",
    sourceUrl: job?.canonicalUrl || "",
  };
  if (CODING_BOUND_SCIENCE_IC_TITLE.test(title) && !MANAGEMENT_TITLE.test(title) && !PRODUCT_SCIENCE_EXCEPTION.test(title)) return {
    status: "blocked",
    evidenceStatus: "inferred",
    basis: "deterministic",
    riskLevel: "near_certain",
    suggestedScore: 0,
    reason: "This individual-contributor scientist archetype is highly likely to require Python, SQL, algorithms, or live model-coding assessment; under the no-coding-round requirement it is treated as a blocker until role-specific contrary evidence is found.",
    sourceUrl: job?.canonicalUrl || "",
  };
  const technicalTitleRisk = ELEVATED_TECHNICAL_TITLE.test(title)
    || /\b(?:senior|principal|staff)?\s*data science(?:\s*\/\s*ai)?\s*product manager\b/i.test(title)
    || (/\b(?:analyst|scientist|data science|analytics)\b/i.test(title) && /\b(?:python|sql|scala|r)\b/i.test(title));
  if (HANDS_ON_IMPLEMENTATION.test(description) || TECHNICAL_IMPLEMENTATION_REQUIREMENTS.test(description)
      || TECHNICAL_ASSESSMENT_RISK.test(description) || ENGINEERING_TITLE.test(title) || technicalTitleRisk) return {
    status: "unknown",
    evidenceStatus: "inferred",
    basis: "deterministic",
    riskLevel: "elevated",
    suggestedScore: 2,
    reason: "The title or responsibilities indicate elevated technical-screen risk, but a coding round is not confirmed. Targeted interview-process research is required.",
    sourceUrl: job?.canonicalUrl || "",
  };
  if (LEADERSHIP_TITLE.test(title) && LOW_CODING_LEADERSHIP_TITLE.test(title) && ontology.eligible) return {
    status: "unknown",
    evidenceStatus: "inferred",
    basis: "deterministic",
    riskLevel: "low",
    suggestedScore: 4,
    reason: "The role archetype has low software-coding-interview risk, but the company-specific interview process is not verified.",
    sourceUrl: job?.canonicalUrl || "",
  };
  return {
    status: "unknown",
    evidenceStatus: "unknown",
    riskLevel: "unknown",
    suggestedScore: null,
    reason: "Coding-interview format is not verified and the role archetype is not decisive.",
    sourceUrl: "",
    basis: "deterministic",
  };
}

function normalizeGate(value, fallbackReason) {
  const suggestedScore = value?.suggestedScore === null || value?.suggestedScore === undefined || value?.suggestedScore === ""
    ? null
    : Number(value.suggestedScore);
  return {
    status: ["met", "blocked", "unknown"].includes(value?.status) ? value.status : "unknown",
    evidenceStatus: ["explicit", "inferred", "unknown"].includes(value?.evidenceStatus) ? value.evidenceStatus : "unknown",
    reasoning: clean(value?.reasoning || value?.reason) || fallbackReason,
    sourceUrl: value?.sourceUrl || "",
    riskLevel: value?.riskLevel || null,
    suggestedScore: Number.isFinite(suggestedScore) ? clamp(suggestedScore, 0, 5) : null,
    basis: value?.basis || "evidence",
  };
}

function compensationGate(job) {
  const evidence = compensationEvidence(job);
  if (!evidence) return normalizeGate(null, "Annual base compensation is not verified.");
  const formattedMinimum = `$${Math.round(evidence.minimum).toLocaleString("en-US")}`;
  const formattedMaximum = `$${Math.round(evidence.maximum).toLocaleString("en-US")}`;
  if (evidence.maximum < 170000) {
    return normalizeGate({
      status: "blocked",
      evidenceStatus: evidence.evidenceType,
      reason: `The confirmed salary range tops out at ${formattedMaximum}, below the $170,000 minimum.`,
      sourceUrl: evidence.sourceUrl,
    });
  }
  if (evidence.minimum < 170000) {
    return normalizeGate({
      status: "unknown",
      evidenceStatus: evidence.evidenceType,
      reason: `The confirmed range is ${formattedMinimum}-${formattedMaximum}; it spans the $170,000 threshold, so an offer above the minimum is not established.`,
      sourceUrl: evidence.sourceUrl,
    });
  }
  return normalizeGate({
    status: "met",
    evidenceStatus: evidence.evidenceType,
    reason: `The confirmed salary range starts at ${formattedMinimum}, meeting the $170,000 minimum.`,
    sourceUrl: evidence.sourceUrl,
  });
}

function expertiseGate(job, dimensions, modelGate, constraint) {
  const score = dimensions.expertiseFit.score;
  const sourceUrl = job?.canonicalUrl || "";
  if (constraint.blocked) {
    return normalizeGate({ status: "blocked", evidenceStatus: constraint.evidenceStatus, reason: constraint.reason, sourceUrl, basis: "deterministic" });
  }
  if (score !== null && score < 2.5) {
    return normalizeGate({ status: "blocked", evidenceStatus: modelGate?.evidenceStatus || "inferred", reason: dimensions.expertiseFit.reasoning, sourceUrl, basis: "model" });
  }
  if (score !== null && score >= 3) {
    return normalizeGate({ status: "met", evidenceStatus: modelGate?.evidenceStatus || "inferred", reason: dimensions.expertiseFit.reasoning, sourceUrl, basis: "model" });
  }
  if (score !== null) {
    return normalizeGate({
      status: "unknown",
      evidenceStatus: modelGate?.evidenceStatus || "inferred",
      reason: `${dimensions.expertiseFit.reasoning} The fit is partial and needs owner review before this must-have gate can be treated as satisfied.`,
      sourceUrl,
    });
  }
  if (classifyCandidateTitle(job?.title || "").eligible) {
    return normalizeGate({ status: "unknown", evidenceStatus: "inferred", reason: "The title passed candidate routing, but responsibility-level expertise fit was not established by the evaluation.", sourceUrl });
  }
  return normalizeGate({ ...modelGate, sourceUrl: modelGate?.sourceUrl || sourceUrl }, "Primary-function fit is not yet established.");
}

function applyGateScores(dimensions, gates, compensation) {
  const updated = structuredClone(dimensions);
  const gateDimension = {
    workAuthorization: gates.workAuthorization,
    compensation: gates.compensation,
    codingInterviewSafety: gates.codingInterview,
  };
  for (const [key, gate] of Object.entries(gateDimension)) {
    if (gate.status === "blocked") updated[key] = { score: 0, evidenceStatus: gate.evidenceStatus, confidence: 1, reasoning: gate.reasoning };
    if (gate.status === "met" && updated[key].score === null) updated[key] = { score: 4, evidenceStatus: gate.evidenceStatus, confidence: gate.evidenceStatus === "explicit" ? 1 : 0.75, reasoning: gate.reasoning };
    if (["workAuthorization", "compensation"].includes(key) && gate.status === "unknown") {
      updated[key] = { score: null, evidenceStatus: gate.evidenceStatus, confidence: 0, reasoning: gate.reasoning };
    }
    if (key === "codingInterviewSafety" && gate.status === "unknown") {
      updated[key] = {
        score: gate.suggestedScore,
        evidenceStatus: gate.evidenceStatus,
        confidence: gate.suggestedScore === null ? 0 : 0.75,
        reasoning: gate.reasoning,
      };
    }
  }
  if (compensation && gates.compensation.status === "met") {
    const score = compensation.minimum >= 200000 ? 5 : compensation.minimum >= 170000 ? 4.5 : 3.5;
    updated.compensation = { score, evidenceStatus: compensation.evidenceType, confidence: 1, reasoning: gates.compensation.reasoning };
  }
  return updated;
}

function weightedScore(dimensions) {
  return Math.round(Object.entries(EVALUATION_WEIGHTS).reduce((sum, [key, weight]) => {
    const score = dimensions[key]?.score;
    return sum + (score === null ? 2.5 : score) / 5 * weight;
  }, 0));
}

function fitPhrase(score) {
  if (score === null) return "Role fit is not yet established";
  if (score >= 4) return "The role is a strong match for your analytics and experimentation background";
  if (score >= 3) return "The role has a substantive match to your analytics, strategy, and leadership experience";
  if (score >= 2.5) return "The role has a partial but credible match to your prior experience";
  return "The role is outside your core demonstrated expertise";
}

function decisionSummary(verdict, dimensions, gates, vacancy) {
  if (vacancy?.status === "blocked") return `Rejected source: ${vacancy.reason}`.slice(0, 900);
  const fit = fitPhrase(dimensions.expertiseFit.score);
  const blockers = Object.values(gates).filter((gate) => gate.status === "blocked").map((gate) => gate.reasoning);
  const unknowns = Object.values(gates).filter((gate) => gate.status === "unknown").map((gate) => gate.reasoning);
  if (verdict === "pass") return `Pass: ${fit}. However, ${blockers.join(" ")}`.slice(0, 900);
  if (verdict === "maybe") return `Review: ${fit}. ${unknowns.join(" ")}`.slice(0, 900);
  return `Pursue: ${fit}. All four must-have gates are supported by the available evidence.`;
}

export function finalizeDeepEvaluation(job, modelEvaluation) {
  const constraint = deterministicExpertiseConstraint(job);
  const dimensions = normalizeDimensions(modelEvaluation?.dimensions || {});
  const invalidSource = constraint.vacancy?.status === "blocked";
  if (invalidSource) {
    for (const key of Object.keys(dimensions)) {
      dimensions[key] = {
        score: null,
        evidenceStatus: "unknown",
        confidence: 0,
        reasoning: "Not evaluated because the source is not a specific vacancy.",
      };
    }
  }
  if (constraint.blocked && (dimensions.expertiseFit.score === null || dimensions.expertiseFit.score > constraint.maxScore)) {
    dimensions.expertiseFit = {
      score: constraint.maxScore,
      evidenceStatus: constraint.evidenceStatus,
      confidence: 1,
      reasoning: constraint.reason,
    };
  }
  const modelGates = modelEvaluation?.mustHave || {};
  const compensation = invalidSource ? null : compensationEvidence(job);
  const workAuthorization = invalidSource
    ? normalizeGate({ status: "unknown", evidenceStatus: "unknown", reason: "Work authorization was not evaluated because the source is not a specific vacancy.", sourceUrl: "", basis: "deterministic" }, "Work authorization is not verified.")
    : normalizeGate({ ...authorizationEvidence(job), basis: "deterministic" }, "Work authorization is not verified.");
  const compensationRequirement = invalidSource
    ? normalizeGate({ status: "unknown", evidenceStatus: "unknown", reason: "Compensation was not evaluated because the source is not a specific vacancy.", sourceUrl: "", basis: "deterministic" }, "Annual base compensation is not verified.")
    : { ...compensationGate(job), basis: "deterministic" };
  const codingEvidence = classifyCodingInterviewRisk(job);
  const codingInterview = normalizeGate({ ...(codingEvidence || modelGates.codingInterview), basis: "deterministic" }, "Coding-interview format is not verified.");
  const gates = {
    expertiseFit: expertiseGate(job, dimensions, modelGates.expertiseFit, constraint),
    workAuthorization,
    compensation: compensationRequirement,
    codingInterview,
  };
  const scoredDimensions = applyGateScores(dimensions, gates, compensation);
  const blockers = Object.entries(gates).filter(([, gate]) => gate.status === "blocked").map(([key]) => key);
  const unknowns = Object.entries(gates).filter(([, gate]) => gate.status === "unknown").map(([key]) => key);
  const overallScore = invalidSource ? 0 : weightedScore(scoredDimensions);
  const verdict = blockers.length ? "pass" : unknowns.length ? "maybe" : overallScore >= 65 ? "apply" : "maybe";
  return {
    ...modelEvaluation,
    modelVerdict: modelEvaluation?.verdict || null,
    modelOverallScore: modelEvaluation?.overallScore ?? null,
    modelSummary: clean(modelEvaluation?.summary),
    verdict,
    overallScore,
    summary: decisionSummary(verdict, scoredDimensions, gates, constraint.vacancy),
    dimensions: scoredDimensions,
    mustHave: gates,
    decision: {
      frameworkVersion: EVALUATION_FRAMEWORK_VERSION,
      weights: EVALUATION_WEIGHTS,
      blockers,
      unknowns,
      provisional: unknowns.length > 0,
      inputValidation: constraint.vacancy,
      expertisePolicySignals: constraint.signals,
    },
  };
}
