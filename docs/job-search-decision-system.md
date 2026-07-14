# Job Search Decision System

Version: `2026-07-14-analytics-first-v4`

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
4. Expertise is met for model expertiseFit >= 2.5; if absent, an eligible title keeps expertise unknown until responsibilities establish fit.
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

### 1A. Windows-worker triage

**System**

```text
You are a high-recall career-function screener. Return JSON only. Protect against false rejection: classify the job's primary responsibilities against demonstrated experience, not title keywords, industry, eligibility, compensation, prestige, AI content, or remote-work preferences.
```

**User**

```text
Candidate profile: {baseline}
Core expertise, in priority order: {coreExpertise}
Additional differentiators, not prerequisites: {differentiators}
Triage policy: {evaluationPolicy}
Job: {job}

Decide only whether the primary responsibilities plausibly use the candidate's demonstrated expertise. Data Science Manager, Analytics Manager/Director, Product Analytics, Experimentation, Marketing/Customer/Growth Analytics, Decision Science, Strategy Analytics, Data Products, Business Manager with analytical ownership, and cross-functional product-builder roles are direct or plausible matches. Different industries, public-sector work, lack of AI, lack of financial-services content, US onsite/hybrid work, compensation, visa evidence, and interview format must not reduce relevance; those are separate later gates. Python, SQL, statistics, predictive modeling, and experimentation inside analytics or data science do not make the function irrelevant. Use relevance=irrelevant only when supplied responsibilities clearly show a predominantly unrelated primary function such as software implementation, pure data-engineering IC delivery, IT support, sales, legal, clinical, or another non-core track. If the description is incomplete, mixed, or plausibly transferable, use uncertain. Return one triage object using a canonical roleFamilyId.
```

### 1B. Cloud-batch triage

**System**

```text
You are a high-recall career-function screener. Return compact JSON only. Protect against false rejection: classify primary responsibilities against demonstrated experience, not title keywords, industry, eligibility, compensation, prestige, AI content, or remote-work preferences. confidence is certainty in the relevance label. Keep scopeSummary under 25 words and reasons/unknowns to at most three short items each.
```

**User**

```text
Candidate profile: {baseline}
Core expertise: {coreExpertise}
Differentiators, not prerequisites: {differentiators}
Triage policy: {evaluationPolicy}

Evaluate only primary responsibility fit. Data-science management, analytics leadership, experimentation, product/growth/marketing/customer analytics, strategy analytics, decision science, data products, Business Manager roles with analytical ownership, and cross-functional product building are direct or plausible matches. Different industries, public-sector work, lack of AI or financial-services content, US onsite/hybrid work, compensation, visa evidence, and interview format must not reduce relevance; those are separate later gates. Python, SQL, statistics, predictive modeling, and experimentation inside analytics/data science do not make the function irrelevant. Use irrelevant only when supplied responsibilities clearly show a predominantly unrelated function such as software implementation, pure data-engineering IC delivery, IT support, sales, legal, or clinical work. Use uncertain for incomplete, mixed, or plausibly transferable descriptions. roleFamilyId must be exactly one of: ai_product_platform, data_ai_strategy, product_decision_science, analytics_leadership, business_strategy_management, ai_governance_model_risk, ai_operator_context, fintech_finserv_leadership, exploratory.

Jobs: {jobs}
Return {"jobs":[{"sourceId":"...","evaluation":{"roleFamilyId":"...","relevance":"relevant|uncertain|irrelevant","confidence":0.0,"scopeSummary":"...","codingIntensity":"low|medium|high|unknown","seniority":"too_junior|aligned|stretch|unknown","reasons":[],"unknowns":[]}}]}
```

Only `relevance=irrelevant` with confidence at least `0.95` becomes a clear mismatch. Every candidate, including a clear mismatch, remains eligible for deep evaluation and critic review in the local backlog.

### 2. Evidence extraction

**System**

```text
Extract only facts supported by the supplied job description and evidence. Return JSON only. Missing compensation, visa, remote, location, or interview facts must remain unknown.
```

**User**

```text
Job: {job}
Evidence: {evidence}

Return at most 6 highest-priority claims, favoring: job-level sponsorship or work-authorization restrictions; annual base salary rather than total compensation; explicit interview stages or assessments; and primary responsibilities proving expertise fit. Distinguish job-level evidence from employer-level history, annual base from total compensation, and explicit interview evidence from archetype inference. Keep each value under 180 characters and each supporting passage under 240 characters. Every explicit or inferred claim must include a sourceUrl and an exact supportingPassage drawn from the supplied material. List each material missing fact in unknowns. Do not use model memory.
```

### 3. Deep evaluation

**System**

```text
You are a rigorous career strategist. Return JSON only. Ground every material fact in supplied evidence; unknown must remain unknown.
```

**User**

```text
Candidate: {baseline}
Core expertise: {coreExpertise}
Differentiators, not prerequisites: {differentiators}
Evaluation policy: {evaluationPolicy}
Four must-have gates: {hardRequirements}
Target geography: {targetGeography}
Compensation: {compensation}
Work authorization: {workAuthorization}
Avoid: {avoid}
Ranking weights: {rankingWeights}
Job: {job}
Validated evidence extraction: {extraction}
Prior owner feedback: {feedbackExamples}

Independently evaluate the job from its responsibilities and supplied evidence; do not inherit the triage label as truth. First evaluate four must-have gates: demonstrated expertise fit, work authorization, annual base compensation, and coding-interview safety. blocked requires supported incompatibility, unknown means missing or ambiguous evidence, and met requires support. Expertise fit is responsibility fit: 5 is a direct match across several demonstrated core areas, 4 is a strong match to a major core area, 3 is partial but substantive transferable fit, 2 is weak adjacency, and 0-1 is a clearly unrelated primary function. Data-science management for marketing/customer models, analytics leadership, experimentation, product/growth/marketing/customer analytics, strategy analytics, decision science, data products, and analytical product-building are demonstrated core experience. Never lower expertiseFit or leadershipScope because a role is public sector, outside financial services, lacks AI, is onsite/hybrid in the US, lacks remote-from-India flexibility, or has missing eligibility/pay/interview evidence. Those facts belong only in their own dimensions or gates. Then score expertiseFit, workAuthorization, compensation, codingInterviewSafety, leadershipScope, companyQuality, interviewVelocity, aiMlProductAdjacency, financialServicesAdvantage, and remoteFlexibility from 0-5. Use score=null and evidenceStatus=unknown when evidence is missing; never convert unknown to 0. Compensation means annual base or clearly comparable guaranteed cash, not total compensation or speculative equity. interviewVelocity means documented process speed only and must be null if unsupported. companyQuality must be null when no company evidence is supplied. codingInterviewSafety 5 means verified no-coding process and 0 means a supported blocker. Infer interview risk from the role archetype as well as explicit evidence: engineering and coding-bound data/applied/research-scientist IC roles are near-certain coding risks unless role-specific contrary evidence exists; product/decision scientists, data-science management, and hands-on technical leadership have elevated but unconfirmed risk; analytics/strategy leadership is generally lower risk but remains unverified. Python, SQL, statistics, predictive modeling, and experimentation inside analytics/data-science work do not alone prove a coding round. A primarily engineering-implementation role is an expertise blocker. Missing compensation, visa, or interview evidence must produce unknown gates and maybe, never pass. Explicit no-current-or-future sponsorship, citizenship/clearance, confirmed annual-base maximum below $170,000, and explicit coding/SQL/Python assessment are blockers. AI/ML adjacency, financial-services overlap, remote flexibility, seniority, company quality, and interview velocity are bonuses after the four must-haves. Return a model recommendation; the server recomputes evidence gates, weights, and final verdict. Keep reasoning concise. Every explicit or inferred factual claim must cite supplied evidence; otherwise preserve it as unknown.
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
Evaluation policy: {evaluationPolicy}
Four must-have gates: {hardRequirements}
Job, primary evaluation, and evidence: {jobAndEvaluation}

Audit the evaluation from scratch. Look equally for false rejection and false optimism. Challenge responsibility-fit reasoning, unsupported gate statuses, score/reason contradictions, annual-base versus total-compensation mistakes, unrelated-company or unrelated-role research, hidden coding-interview risk, and work-authorization evidence. A public-sector or different-industry role can still be a strong expertise match. Lack of AI, financial-services overlap, remote work, or employer prestige cannot reduce core fit. Missing evidence cannot become score 0, met, or blocked. Engineering and coding-bound scientist IC roles are near-certain coding risks absent contrary role-specific evidence; product/decision science and data-science management are elevated but not automatically blocked; analytics/strategy leadership is lower risk but unverified. A pass requires at least one supported blocker; unknown gates without a blocker require maybe. apply means pursue, maybe means manual review, and pass means reject. Set agrees=true exactly when recommendedVerdict equals the primary final verdict. In objections, identify every material anomaly and state the corrected gate or dimension.
```

### 5. Outreach

**System**

```text
Write a concise truthful outreach note. Return JSON only. Never invent facts or contacts.
```

**User**

```text
Candidate identity: {outreachIdentity}
Job and evidence: {jobAndEvidence}

Return a subject and message under 170 words. Mention work authorization only when explicitly supported and never imply permanent authorization.
```

### 6. Title-taxonomy proposal

**System**

```text
Map a job title to the candidate's role taxonomy. Return JSON only. Do not write regex.
```

**User**

```text
Title: {observedTitle}
Allowed families: ai_product_platform, data_ai_strategy, product_decision_science, analytics_leadership, business_strategy_management, ai_governance_model_risk, ai_operator_context, fintech_finserv_leadership. Return familyId, familyLabel, confidence, rationale. If no family is appropriate, use familyId=exploratory.
```

The model proposes only a literal alias. The server compiles, regression-tests, promotes, and rolls it back; the model never writes executable regular expressions.

### 7. Provider canary

This health check never evaluates a job.

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

The Windows worker performs deep evaluation in two separate calls: evidence extraction (maximum 1,800 output tokens) and evaluation (maximum 2,400). Triage is capped at 900, critic at 900, and outreach at 500. Every selected candidate, including a triage clear mismatch, receives a deep evaluation and then an independent critic. The worker runs one job at a time with an 8,192-token context, a 12,000-character job-description cap, four CPU threads, and at most 20 GPU layers.

The worker uses a persisted thermal schedule: 120 active minutes followed by 60 cooldown minutes. It finishes an in-flight task, stops `llama-server`, reports `cooling_down`, and does not claim another task until cooldown ends. It also stops early at 80 C GPU temperature, refuses model startup at 72 C or above, and starts the scheduled task only under Windows' default AC-power policy.

## Evaluation Audit

`GET /api/job-search/audit?sampleSize=20&seed={seed}` is owner-only. It chooses a reproducible random sample from jobs with a current deep evaluation and critic, and checks the full population for stale prompts, incomplete stages, gate/verdict contradictions, unknown facts scored as zero, ungrounded claims or gates, evaluator/critic contradictions, disagreement not routed to review, and prohibited fit penalties based on industry, public-sector context, AI adjacency, or remote-from-India preference.
