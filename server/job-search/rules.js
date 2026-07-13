import { clamp, compact, normalizeNumber, normalizeString } from "./utils.js";
import { ROLE_FAMILIES } from "./profile.js";

const POSITIVE_SIGNALS = [
  { pattern: /\b(ai product|product manager|product lead|product strategy)\b/i, points: 16, label: "AI/product ownership" },
  { pattern: /\b(genai|llm|rag|agentic|ai platform|ai workflow)\b/i, points: 16, label: "GenAI/RAG/platform scope" },
  { pattern: /\b(data strategy|data product|data architecture|analytics strategy)\b/i, points: 15, label: "Data strategy/architecture fit" },
  { pattern: /\b(product scientist|experimentation|causal|measurement|decision scientist)\b/i, points: 14, label: "Product science fit" },
  { pattern: /\b(analytics manager|director of analytics|head of analytics|business manager)\b/i, points: 13, label: "Analytics/business leadership fit" },
  { pattern: /\b(fintech|financial services|banking|payments|lending|credit|capital markets|insurance)\b/i, points: 13, label: "Fintech/financial-services domain" },
  { pattern: /\b(governance|model risk|risk management|compliance|controls?|responsible ai)\b/i, points: 12, label: "Governance/risk/compliance match" },
  { pattern: /\b(series [abc]|startup|ai-native|founder|operator|chief of staff)\b/i, points: 10, label: "Startup/operator velocity" },
  { pattern: /\b(director|senior manager|principal|lead|head|vp)\b/i, points: 8, label: "Senior operating scope" },
  { pattern: /\b(remote worldwide|global remote|work from anywhere|remote india)\b/i, points: 10, label: "Remote-from-India compatible signal" },
  { pattern: /\b(opt|cpt|stem opt|f-1|visa sponsorship|sponsorship available)\b/i, points: 6, label: "Authorization-friendly language" },
];

const NEGATIVE_SIGNALS = [
  {
    pattern: /\b(leetcode|data structures|algorithms|coding challenge|live coding|coding interview|coding screen)\b/i,
    ignore: /\b(no|not|without)\s+(?:live\s+)?coding\b|\bno\s+leetcode\b|\bno\s+coding\s+(screen|challenge|round|rounds|interview|interviews)\b/i,
    points: 36,
    label: "Coding-interview red flag",
  },
  { pattern: /\b(backend engineer|software engineer|full-stack|frontend engineer|staff engineer|principal engineer)\b/i, points: 32, label: "IC software-engineering title" },
  { pattern: /\b(java|golang|kubernetes|distributed systems|microservices)\b/i, points: 12, label: "Backend implementation stack emphasis" },
  { pattern: /\b(pager duty|on-call|low-level services|systems programming)\b/i, points: 18, label: "Backend operations ownership" },
  { pattern: /\b(us citizen|u\.s\. citizen|security clearance|clearance required)\b/i, points: 42, label: "Citizenship/clearance requirement" },
  { pattern: /\b(no sponsorship|will not sponsor|without sponsorship now or in the future)\b/i, points: 16, label: "Future sponsorship limitation" },
  { pattern: /\b(must be located in the united states|remote us only|us-only remote)\b/i, points: 8, label: "Remote-from-India limitation" },
  { pattern: /\b(unpaid|internship|new grad)\b/i, points: 45, label: "Wrong seniority/compensation band" },
];

function matchSignals(text, signals) {
  return signals
    .filter((signal) => signal.pattern.test(text) && !signal.ignore?.test(text))
    .map((signal) => ({
      label: signal.label,
      points: signal.points,
    }));
}

function inferRoleFamily(text) {
  const family = ROLE_FAMILIES.find((item) => item.patterns.some((pattern) => pattern.test(text)));
  return family ? { id: family.id, label: family.label } : { id: "unknown", label: "Needs review" };
}

function extractCompensation(text) {
  const values = [];
  const salaryPattern = /(?:\$|usd\s*)(\d{2,3})(?:,\d{3}|k|K)?(?:\s*-\s*(?:\$|usd\s*)?(\d{2,3})(?:,\d{3}|k|K)?)?/g;
  let match = salaryPattern.exec(text);

  while (match) {
    const low = normalizeNumber(match[1], 0);
    const high = normalizeNumber(match[2], low);
    const normalizedLow = low < 1000 ? low * 1000 : low;
    const normalizedHigh = high < 1000 ? high * 1000 : high;
    values.push(normalizedLow, normalizedHigh);
    match = salaryPattern.exec(text);
  }

  const maxSalary = values.length ? Math.max(...values) : null;
  const hasEquity = /\b(equity|stock options|rsu|ownership)\b/i.test(text);
  let band = "not listed";
  let strength = "neutral";

  if (maxSalary >= 200000) {
    band = "$200k+ signal";
    strength = "positive";
  } else if (maxSalary >= 120000) {
    band = "$120k+ signal";
    strength = "positive";
  } else if (maxSalary) {
    band = `below target signal (${Math.round(maxSalary / 1000)}k max)`;
    strength = hasEquity ? "neutral" : "negative";
  } else if (hasEquity) {
    band = "equity/upside mentioned";
    strength = "neutral";
  }

  return {
    maxSalary,
    hasEquity,
    band,
    strength,
  };
}

function inferVisa(text) {
  if (/\b(opt|cpt|stem opt|f-1)\b/i.test(text)) {
    return { status: "friendly", summary: "OPT/CPT/STEM OPT language found." };
  }

  if (/\b(will sponsor|visa sponsorship|sponsorship available)\b/i.test(text)) {
    return { status: "friendly", summary: "Sponsorship-friendly language found." };
  }

  if (/\b(no sponsorship|without sponsorship now or in the future|will not sponsor)\b/i.test(text)) {
    return { status: "caution", summary: "Future sponsorship limitation found." };
  }

  if (/\b(us citizen|security clearance|clearance required)\b/i.test(text)) {
    return { status: "red_flag", summary: "Citizenship or clearance requirement found." };
  }

  return { status: "unknown", summary: "No explicit visa/sponsorship evidence." };
}

function inferLocationFit(text, location) {
  const combined = `${text} ${location}`.toLowerCase();

  if (/\b(remote worldwide|global remote|work from anywhere|remote india|india remote)\b/i.test(combined)) {
    return { status: "strong", summary: "Global or India-compatible remote signal." };
  }

  if (/\bremote\b/i.test(combined) && !/\b(remote us only|us-only remote|must be located in the united states)\b/i.test(combined)) {
    return { status: "good", summary: "Remote signal without explicit US-only wording." };
  }

  if (/\b(remote us only|us-only remote|must be located in the united states)\b/i.test(combined)) {
    return { status: "caution", summary: "US-only remote limitation." };
  }

  if (/\bnew york|san francisco|boston|washington|seattle|austin|chicago|united states|usa\b/i.test(combined)) {
    return { status: "acceptable", summary: "US-based role signal." };
  }

  return { status: "unknown", summary: "Location compatibility needs manual review." };
}

export function analyzeJobRules(job) {
  const text = compact(`${job.title} ${job.company} ${job.location || ""} ${job.description}`, 24000);
  const positive = matchSignals(text, POSITIVE_SIGNALS);
  const negative = matchSignals(text, NEGATIVE_SIGNALS);
  const compensation = extractCompensation(text);
  const visa = inferVisa(text);
  const locationFit = inferLocationFit(text, job.location);
  const roleFamily = inferRoleFamily(text);

  let score = 38;
  positive.forEach((signal) => {
    score += signal.points;
  });
  negative.forEach((signal) => {
    score -= signal.points;
  });

  if (compensation.maxSalary >= 200000) {
    score += 10;
  } else if (compensation.maxSalary >= 120000 || compensation.hasEquity) {
    score += 5;
  } else if (compensation.maxSalary) {
    score -= 8;
  }

  if (visa.status === "friendly") {
    score += 5;
  } else if (visa.status === "red_flag") {
    score -= 30;
  } else if (visa.status === "caution") {
    score -= 8;
  }

  if (locationFit.status === "strong") {
    score += 8;
  } else if (locationFit.status === "good") {
    score += 5;
  } else if (locationFit.status === "caution") {
    score -= 6;
  }

  const hardReject = negative.some((signal) => [
    "Coding-interview red flag",
    "IC software-engineering title",
    "Citizenship/clearance requirement",
    "Wrong seniority/compensation band",
  ].includes(signal.label));
  const ruleScore = clamp(Math.round(score), 0, 100);

  const evidence = [
    { label: "Role family", value: roleFamily.label, strength: roleFamily.id === "unknown" ? "neutral" : "positive" },
    { label: "Compensation", value: compensation.band, strength: compensation.strength },
    { label: "Visa", value: visa.summary, strength: visa.status === "friendly" ? "positive" : visa.status === "red_flag" ? "negative" : "neutral" },
    { label: "Location", value: locationFit.summary, strength: ["strong", "good"].includes(locationFit.status) ? "positive" : locationFit.status === "caution" ? "negative" : "neutral" },
  ];

  return {
    ruleScore,
    roleFamily,
    greenFlags: positive.map((signal) => signal.label),
    redFlags: negative.map((signal) => signal.label),
    evidence,
    compensation,
    visa,
    locationFit,
    hardReject,
    isLikelyFit: ruleScore >= 72 && !hardReject,
  };
}

export function localEvaluatorFromRules(job, rules) {
  const score = clamp(Math.round(rules.ruleScore), 0, 100);
  const topGreen = rules.greenFlags.slice(0, 3).join(", ");
  const topRed = rules.redFlags.slice(0, 2).join(", ");
  const reasoningParts = [];

  if (topGreen) {
    reasoningParts.push(`positive signals: ${topGreen}`);
  }

  if (topRed) {
    reasoningParts.push(`red flags: ${topRed}`);
  }

  if (!reasoningParts.length) {
    reasoningParts.push("limited target-profile evidence");
  }

  return {
    llmScore: score,
    llmReasoning: `Rules-first evaluator: ${reasoningParts.join("; ")}.`,
    isMatch: score >= 80 && !rules.hardReject,
  };
}
