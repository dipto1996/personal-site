# Job Search Decision System

Version: `2026-07-14-analytics-first-v3`

This is the auditable specification for discovery, title routing, LLM prompts, deterministic gates, and ranking. The executable definitions remain the source of truth in `server/job-search/profile.js`, `server/job-search/title-ontology.js`, `server/job-search/worker-contract.js`, and `server/job-search/evaluation-framework.js`.

## Candidate Profile

Core expertise, in priority order:

1. Analytics leadership and executive decision support.
2. Experimentation, A/B and multivariate testing, causal measurement, and conversion optimization.
3. Product, growth, KPI/funnel, and customer-behavior analytics.
4. Marketing, acquisition, retention, lifecycle, and commercial analytics.
5. Data-science management for predictive marketing and customer models.
6. Strategy analytics, forecasting, business analytics, and decision science.
7. Data products, clickstream capabilities, and analytics platforms.
8. Cross-functional product strategy and zero-to-one product building.

Financial-services experience and AI-product/founder experience are differentiators. Neither is required for core role fit. Remote work is a minor convenience, not a requirement.

## Discovery And Title Rules

Discovery uses eight Google Jobs search shards each day, split across the morning and evening runs:

1. Analytics and business-intelligence leadership.
2. Data-science and decision-science management.
3. Product analytics, experimentation, measurement, and growth data science.
4. Marketing, customer, commercial, and retention analytics.
5. Data products, analytics products, data strategy, and data-engineering leadership.
6. Strategy and analytics, business management, BizOps, commercial strategy, and performance analytics.
7. AI product, AI strategy, AI enablement, AI operations, and AI governance.
8. Financial-services overlay for analytics, data science, product analytics, strategy, and data products.

There are no negative Google-search terms.

The exact eight Google Jobs queries are below. SerpApi adds `engine=google_jobs`, `location=United States`, and `date_posted:today` to each query.

```text
1. ("Analytics Manager" OR "Senior Analytics Manager" OR "Director of Analytics" OR "Head of Analytics" OR "Analytics Lead" OR "Business Intelligence Manager") (manager OR director OR head OR lead OR principal OR senior)
2. ("Data Science Manager" OR "Manager of Data Science" OR "Director of Data Science" OR "Decision Science Manager" OR "Product Scientist") (manager OR director OR head OR lead OR principal OR senior)
3. ("Product Analytics Manager" OR "Product Analytics Lead" OR "Experimentation Lead" OR "Experimentation Manager" OR "Measurement Lead" OR "Growth Data Science") (manager OR director OR head OR lead OR principal OR senior)
4. ("Marketing Analytics Manager" OR "Customer Analytics Manager" OR "Commercial Analytics" OR "Customer Insights Lead" OR "Marketing Science Lead" OR "Retention Analytics") (manager OR director OR head OR lead OR principal OR senior)
5. ("Data Product Manager" OR "Data Products Lead" OR "Analytics Product Manager" OR "Decision Products Lead" OR "Data Strategy Director" OR "data engineering") (manager OR director OR head OR lead OR principal OR senior)
6. ("Strategy and Analytics" OR "Analytics Strategy" OR "Business Manager" OR "BizOps Analytics" OR "Commercial Strategy Manager" OR "Performance Analytics Manager") (manager OR director OR head OR lead OR principal OR senior)
7. ("AI Product Manager" OR "AI Product Lead" OR "AI Strategy Lead" OR "AI Operator" OR "AI Enablement Lead" OR "AI Governance Lead") (manager OR director OR head OR lead OR principal OR senior OR operator)
8. (fintech OR payments OR credit OR banking OR insurance OR lending) ("Analytics Manager" OR "Data Science Manager" OR "Product Analytics" OR "Strategy and Analytics" OR "Data Product") (manager OR director OR head OR lead OR principal OR senior)
```

Brave/local-browser discovery prepends one rotating source group to each query: LinkedIn + Wellfound + YC, specialist portals, Greenhouse/Lever/Ashby, Workday/SmartRecruiters/Workable/iCIMS/Jobvite/BambooHR/Breezy, or generic company career-page paths. Four rotating exploratory queries cover conversion/lifecycle/retention/acquisition analytics; customer decisioning/marketing science/commercial insights/growth measurement; experimentation/measurement/causal inference; and AI enablement/operating model/data commercialization.

The exact routing formula is:

```text
(target function AND target seniority)
OR specialist exception
OR at least two distinct target functions
```

In executable terms:

```text
leadershipOverride = seniority contains manager|director|head|executive
  AND function contains analytics|data/decision science|AI/data product|data/AI strategy|data platform/architecture
excludedPrimaryFunction = engineeringICMatch AND NOT leadershipOverride
standardMatch = NOT excludedPrimaryFunction AND functionCount > 0 AND seniorityCount > 0
exploratoryMatch = NOT excludedPrimaryFunction AND distinctFunctionConceptCount >= 2
eligible = standardMatch OR specialistException OR exploratoryMatch
```

The nine function concepts are analytics/insights; data/decision science; AI/data product; data/AI strategy; governance/model risk; data platform/architecture; business strategy/operations; AI operator/context; and financial-services decisioning. The seven seniority concepts are manager, director, head, executive, lead, senior IC, and operator. Specialist exceptions are Product Scientist, Decision Scientist, Product Data Scientist, Context Engineer, AI Operator, LLM/AI Evaluator, Business Manager, and Chief of Staff.

The engineering-IC exclusion is applied first, except when eligible management seniority and analytics/science/product/strategy/platform/architecture function evidence create a leadership override.

For the standard lane, both conditions are true:

- **Function:** at least one target function concept matches.
- **Seniority:** manager, director, head, VP/chief/GM, lead, senior/principal/staff, advisor/consultant, or operator matches.

Specialist exceptions such as Product Scientist, Decision Scientist, Context Engineer, AI Operator, Business Manager, and Chief of Staff do not require a separate seniority word. A title matching at least two distinct target functions enters an exploratory lane. Software/backend/frontend/full-stack/DevOps/data-engineering/analytics-engineering/ML-engineering IC titles are excluded, but analytics/data-platform leadership can override the engineering exclusion.

Title rules generate and route candidates. They do not make the final job decision.

## Must-Have Gates

The server, not the LLM, owns the final gate decision.

| Gate | Met | Blocked | Unknown |
|---|---|---|---|
| Expertise | Responsibilities substantially match the demonstrated core | Primary function is clearly outside the core | Responsibilities are incomplete or ambiguous |
| Work authorization | Explicit OPT/sponsorship support, or credible employer-level government/E-Verify evidence without a job-level contradiction | Explicit no current/future sponsorship, citizenship, or clearance restriction | Compatibility is not verified |
| Compensation | Confirmed annual base range starts at $170,000 or more | Confirmed maximum is below $170,000 | No reliable range, or a range spanning the $170,000 threshold |
| Coding interview | Role-specific evidence supports no coding round | Explicit live coding/SQL/Python assessment, algorithms/data structures, or LeetCode; engineering and coding-bound scientist IC archetypes are near-certain blockers unless contrary role-specific evidence exists | Product/decision science, data-science management, and technical leadership are elevated but unconfirmed; analytics/strategy leadership is lower risk but still unverified |

Any confirmed blocker produces `pass`. Any unknown gate with no blocker produces `maybe` / review. `apply` is possible only when all four gates are supported and the weighted score is at least 65.

The exact final-decision order is:

```text
1. Normalize every model dimension to 0-5 or null.
2. Recompute work authorization, compensation, and coding-interview gates from stored evidence.
3. Expertise is blocked for an excluded engineering function or model expertiseFit < 2.5.
4. Expertise is met for model expertiseFit >= 2.5; if absent, an eligible title is an inferred provisional match.
5. Replace blocked gate dimensions with 0; replace a met-but-unscored gate with 4.
6. For unknown coding risk only, use archetype suggestion 2 (elevated) or 4 (low); the gate remains unknown.
7. Weighted score = sum((dimensionScore or neutral 2.5) / 5 * dimensionWeight).
8. Any blocked gate => pass.
9. Otherwise any unknown must-have gate => maybe / review.
10. Otherwise score >= 65 => apply; score < 65 => maybe / review.
```

Coding-interview classification is applied in this order: explicit coding/SQL/Python/algorithms evidence blocks; explicit no-coding evidence meets; engineering IC blocks by near-certain archetype inference; data/applied/research-scientist IC blocks by near-certain archetype inference; Product/Decision Scientist, data-science management, hands-on technical leadership, and similar roles remain unknown with elevated risk; analytics/strategy/product leadership remains unknown with low inferred risk; everything else remains unknown. Role-specific explicit evidence overrides archetype inference.

Work authorization is applied in this order: explicit job-level prohibition or citizenship/clearance blocks; explicit sponsorship/OPT support meets; exact-company official E-Verify plus H-1B/LCA evidence meets by inference; only one of those employer signals remains unknown; no evidence remains unknown. Job-level restrictions override employer history.

Compensation is parsed from structured source data, grounded claims, the posting, then research. Confirmed maximum below $170,000 blocks; minimum at least $170,000 meets; a range spanning $170,000 is unknown; missing evidence is unknown.

## Weights

| Dimension | Weight |
|---|---:|
| Expertise fit | 35% |
| F-1 OPT / sponsorship compatibility | 20% |
| Compensation | 15% |
| No-coding-interview confidence | 10% |
| Leadership and scope | 5% |
| Company quality | 4% |
| Interview velocity | 3% |
| AI / ML product adjacency | 3% |
| Financial-services advantage | 3% |
| Remote flexibility | 2% |

A missing dimension is displayed as `Unknown`. The internal ranking calculation uses a neutral midpoint for an unknown dimension, but the unknown must-have gate still prevents automatic pursuit.

## Every LLM Prompt

Dynamic fields below are enclosed in braces. The Windows worker uses Qwen with JSON-schema-constrained output. Cloud fallbacks use the same schemas.

Every call uses temperature `0.1`. The local server receives `/think` for deep and critic calls, `/no_think` for triage/outreach, prompt caching, a 10-minute timeout, and schema-constrained JSON. Cloud calls have a 90-second timeout and use JSON Schema where supported, otherwise JSON-object mode.

### 1. Triage

**System**

```text
You are a high-recall career screener. Return JSON only. Never reject uncertainty and classify responsibilities rather than keyword overlap.
```

**User**

```text
Candidate profile: {baseline}
Core expertise, in priority order: {coreExpertise}
Additional differentiators, not prerequisites: {differentiators}
Constraints: {avoid} {targetGeography}
Job: {job}

Use relevance=irrelevant only for a clear primary-function mismatch. Analytics, experimentation, product analytics, marketing/customer analytics, strategy analytics, data-science management, decision science, data products, and cross-functional product-building are core matches in any industry. Do not require AI or financial-services content. A role mentioning Python, SQL, statistics, model building, or engineering partnership is not automatically coding-interview-heavy. Return one triage object using a canonical roleFamilyId.
```

The synchronous cloud batch variant has this exact system prompt:

```text
You are a high-recall career screener. Return compact JSON only. Never reject uncertainty. Classify responsibilities, not keyword overlap. confidence is certainty in the relevance label: use 0.9+ only for clear decisions and 0.4-0.8 for uncertainty, never 0 when reasons are decisive. Keep scopeSummary under 25 words and reasons/unknowns to at most three short items each.
```

Its user prompt contains the same candidate/profile blocks, then this exact instruction and up to three jobs:

```text
Evaluate every job. Use relevance=irrelevant only for a clear primary-function mismatch. Analytics, experimentation, product analytics, marketing/customer analytics, strategy analytics, data-science management, decision science, data products, and cross-functional product-building are core matches in any industry. AI, financial services, and remote work are not prerequisites. Python, SQL, statistics, model building, or engineering partnership are not automatically coding-interview-heavy. roleFamilyId must be exactly one of: ai_product_platform, data_ai_strategy, product_decision_science, analytics_leadership, business_strategy_management, ai_governance_model_risk, ai_operator_context, fintech_finserv_leadership, exploratory.

Jobs: {jobs}

Return {"jobs":[{"sourceId":"...","evaluation":{"roleFamilyId":"...","relevance":"relevant|uncertain|irrelevant","confidence":0.0,"scopeSummary":"...","codingIntensity":"low|medium|high|unknown","seniority":"too_junior|aligned|stretch|unknown","reasons":[],"unknowns":[]}}]}
```

Only `relevance=irrelevant` with confidence at least `0.90` becomes a clear mismatch. Every other result goes to deep review.

### 2. Evidence Extraction

**System**

```text
Extract only facts supported by the supplied job description and evidence. Return JSON only. Missing compensation, visa, remote, location, or interview facts must remain unknown.
```

**User**

```text
Job: {job}
Evidence: {evidence}

Return at most 6 highest-priority claims, favoring eligibility, compensation, and coding/interview evidence. Keep each value under 180 characters and each supporting passage under 240 characters. Every explicit or inferred claim must include a sourceUrl and a supportingPassage drawn from the supplied material. Do not use model memory.
```

### 3. Deep Evaluation

**System**

```text
You are a rigorous career strategist. Return JSON only. Ground every material fact in supplied evidence; unknown must remain unknown.
```

**User**

```text
Candidate: {baseline}
Core expertise: {coreExpertise}
Differentiators, not prerequisites: {differentiators}
Four must-have gates: {hardRequirements}
Target geography: {targetGeography}
Compensation: {compensation}
Work authorization: {workAuthorization}
Avoid: {avoid}
Ranking weights: {rankingWeights}
Job: {job}
Validated evidence extraction: {extraction}
Prior owner feedback: {feedbackExamples}

Evaluate the four must-have gates first. blocked requires supported incompatibility, unknown means missing evidence, and met requires support. Score expertiseFit, workAuthorization, compensation, codingInterviewSafety, leadershipScope, companyQuality, interviewVelocity, aiMlProductAdjacency, financialServicesAdvantage, and remoteFlexibility from 0-5. Use score=null for unknown evidence; never convert unknown to 0. codingInterviewSafety 5 means low/no coding-interview risk. interviewVelocity concerns process speed only. leadershipScope concerns responsibility only. Public-sector or non-financial-services work cannot reduce expertise fit or leadership scope when responsibilities match. AI/ML, financial-services, and remote are bonuses. US on-site/hybrid is acceptable when authorization is compatible. Infer interview risk from role archetype as well as explicit evidence: engineering and coding-bound data/applied/research-scientist IC roles are near-certain coding risks unless role-specific contrary evidence exists; product/decision scientists, data-science management, and hands-on technical leadership have elevated but unconfirmed risk; analytics/strategy leadership is generally lower risk but remains unverified. Python, SQL, statistics, predictive modeling, experimentation, and model development within analytics/data-science work do not alone prove a coding round. Missing compensation, visa, or interview evidence means maybe, not pass. Explicit no-current-or-future sponsorship, citizenship/clearance, salary maximum below $170,000, or explicit coding interviews are blockers. The server applies final gates and weights. Cite every non-unknown claim.
```

### 4. Critic

**System**

```text
Act as an independent skeptical career strategist. Return JSON only and use only supplied evidence. Prefer correcting optimism over preserving agreement.
```

**User**

```text
Candidate profile: {baseline}
Core expertise: {coreExpertise}
Four must-have gates: {hardRequirements}
Job, primary evaluation, and evidence: {jobAndEvaluation}

Challenge unsupported gate statuses, contradictions, hidden coding-interview risk, role-archetype risk classification, salary interpretation, and work-authorization evidence. Engineering and coding-bound scientist IC roles are near-certain coding risks absent contrary role-specific evidence; product/decision science and data-science management are elevated but not automatically blocked. Do not treat industry mismatch, lack of AI, lack of remote work, or public-sector context as a core role-fit failure when responsibilities match. apply means pursue, maybe means manual review, and pass means reject. Missing facts remain unknown and normally cause maybe unless another must-have gate is explicitly blocked.
```

### 5. Outreach

**System**

```text
Write a concise truthful outreach note. Return JSON only. Never invent facts or contacts.
```

**User**

```text
Candidate identity: {outreachIdentity}
Candidate background: {baseline}
Job and evidence: {jobAndEvidence}

Return a subject and message under 170 words. Lead with the candidate experience most relevant to this role. Mention work authorization only when explicitly supported, and never imply permanent authorization.
```

### 6. Title-Taxonomy Proposal

**System**

```text
Map a job title to the candidate's role taxonomy. Return JSON only. Do not write regex.
```

**User**

```text
Title: {observedTitle}
Allowed families: ai_product_platform, data_ai_strategy, product_decision_science, analytics_leadership, business_strategy_management, ai_governance_model_risk, ai_operator_context, fintech_finserv_leadership. Return familyId, familyLabel, confidence, and rationale. If no family is appropriate, use exploratory.
```

The model can propose a literal exact or token-set alias. The server safely compiles it, tests it against every owner-labelled job, and controls promotion or rollback. The model never writes executable regular expressions.

### 7. Provider Canary

This is health checking only and never evaluates a job.

**System**

```text
Return only valid JSON matching the requested shape.
```

**User**

```text
Return {"ok":true,"provider":"{provider}"}.
```

## Research Logic

Every deep candidate first attempts direct page/JSON-LD extraction. Tavily is used only when direct extraction fails. Brave then runs these exact query templates, subject to the research reserve:

```text
"{company}" "{cleanTitle}" (salary OR compensation OR "pay range" OR sponsorship OR "work authorization"{interviewTerms})
"{company}" ("STEM OPT" OR "F-1 OPT" OR "E-Verify" OR H-1B OR LCA) (site:e-verify.gov OR site:dol.gov OR site:uscis.gov OR site:dhs.gov)
```

For near-certain or elevated archetype risk, `{interviewTerms}` is exactly ` OR "coding interview" OR "live coding" OR "SQL assessment" OR "Python assessment" OR "technical screen" OR "interview process"`; otherwise it is empty. Search snippets are evidence candidates, not facts: final work-authorization inference requires an official source and an exact-company match; role-specific coding research requires both exact-company and exact-role matches.

## Model Routing

Routes are tried in this exact order; a failure or exhausted free quota advances to the next route. Paid routes require paid fallback to be explicitly enabled and must pass the database budget check.

| Stage | Route order |
|---|---|
| Triage | local Qwen3-4B no-think; Cloudflare Llama 3.1 8B; Groq GPT-OSS-120B low reasoning; OpenRouter free; GLM-4.7-Flash |
| Deep | local Qwen3-4B think; Groq GPT-OSS-120B; Cloudflare Llama 3.3 70B; OpenRouter free; paid GLM-5.2 |
| Critic | local Qwen3-4B think; Cloudflare Llama 3.3 70B; OpenRouter free; Groq GPT-OSS-120B; paid Kimi K2.5 |
| Utility | local Qwen3-4B no-think; Cloudflare Llama 3.1 8B; Groq GPT-OSS-120B; OpenRouter free; GLM-4.7-Flash |

The Windows worker performs deep evaluation in two separate calls: evidence extraction (maximum 1,800 output tokens) and evaluation (maximum 2,400). Triage is capped at 900, critic at 900, and outreach at 500. The worker runs one job at a time with an 8,192-token context and a 12,000-character job-description cap.
