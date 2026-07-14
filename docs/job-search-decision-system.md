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

The exact routing formula is:

```text
(target function AND target seniority)
OR specialist exception
OR at least two distinct target functions
```

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

Dynamic fields below are enclosed in braces. The Windows worker uses Qwen with JSON-schema-constrained output. Cloud fallbacks use the equivalent prompts and the same schemas.

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
