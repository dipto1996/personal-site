function clean(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export const SPONSORSHIP_AVAILABLE_PATTERN = /\b(?:visa sponsorship (?:is )?available|sponsorship available|will (?:provide|offer) (?:visa )?sponsorship|we sponsor|eligible for sponsorship|will consider sponsor(?:ing|ship) (?:a |an )?(?:new )?(?:qualified )?applicant(?:s)? (?:for employment authorization|for (?:a )?visa|for work authorization)?)\b/i;

const NAMED_STUDENT_STATUS = /\b(?:F-?1(?:\s+(?:visa|student|status|OPT|CPT))?|STEM\s+OPT|optional practical training|curricular practical training)\b/i;
const OPT_CPT_WITH_IMMIGRATION_CONTEXT = /(?:\b(?:visa|immigration|international student|student visa|work authorization|employment authorization|practical training)\b[^.!?]{0,100}\b(?:OPT|CPT)\b|\b(?:OPT|CPT)\b[^.!?]{0,100}\b(?:visa|immigration|international student|student visa|work authorization|employment authorization|practical training)\b)/i;
const OPT_INCOMPATIBILITY = /\b(?:cannot|can't|unable to|do not|does not|will not|not able to)\s+(?:accept|hire|employ|consider|support)\b|\b(?:not accepted|not eligible|ineligible|not supported)\b/i;

export function hasOptCptCompatibilityEvidence(value) {
  const text = clean(value);
  return NAMED_STUDENT_STATUS.test(text) || OPT_CPT_WITH_IMMIGRATION_CONTEXT.test(text);
}

export function hasOptCptIncompatibilityEvidence(value) {
  const text = clean(value);
  return hasOptCptCompatibilityEvidence(text) && OPT_INCOMPATIBILITY.test(text);
}
