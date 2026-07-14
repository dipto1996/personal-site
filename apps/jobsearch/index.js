import { loginWithPassword, registerAccount } from "../../lib/workspace-client.js";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function statusLabel(value) {
  const labels = {
    local_triage_pending: "Waiting for Windows triage",
    deep_review_pending: "Waiting for Windows deep review",
    critic_pending: "Waiting for critic review",
    queued_local: "Queued for Windows",
    resource_waiting: "paused for safe resources",
    cooling_down: "cooling down",
    starting: "starting",
    claiming: "checking queue",
    processing: "processing",
    idle: "ready",
    blocked: "blocked",
  };
  if (labels[value]) return labels[value];
  return String(value || "unknown").replaceAll("_", " ");
}

const WORKER_HEARTBEAT_STALE_MS = 3 * 60 * 1000;

function workerIsConnected(worker) {
  const lastSeenAt = new Date(worker?.lastSeenAt || "").getTime();
  return Number.isFinite(lastSeenAt) && Date.now() - lastSeenAt <= WORKER_HEARTBEAT_STALE_MS;
}

function workerStatusLabel(worker) {
  if (!worker) return "not connected";
  return workerIsConnected(worker) ? statusLabel(worker.status) : "offline";
}

function workerStatusDetail(worker) {
  if (!workerIsConnected(worker)) return "The Windows worker is not currently connected.";
  const metadata = worker?.metadata || {};
  const temperature = Number(metadata.gpuTemperatureCelsius);
  if (worker.status === "cooling_down") {
    return `Processing is safely paused${Number.isFinite(temperature) ? ` at ${temperature} C` : ""}${metadata.cooldownUntil ? ` until ${formatDate(metadata.cooldownUntil)}` : ""}. It resumes automatically.`;
  }
  if (worker.status === "resource_waiting") {
    return `Processing is waiting for safe laptop resources${Number.isFinite(temperature) ? `; GPU temperature is ${temperature} C` : ""}. It retries automatically.`;
  }
  if (worker.status === "blocked") return metadata.reason || "The worker needs attention before processing can continue.";
  return "";
}

function safeExternalUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}`);
  return payload;
}

function renderLogin(error = "") {
  return `<section class="job-gate">
    <div><p class="eyebrow">Private tool</p><h1>Job Intelligence</h1><p class="section-intro">Owner access is required.</p></div>
    <div class="job-login-stack">
      <form class="job-login-panel" data-job-login>
        <p class="verify-block-label">Sign in</p>
        <label class="verify-field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
        <label class="verify-field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
        <button class="button button-primary" type="submit">Sign in</button>
      </form>
      <form class="job-login-panel" data-job-register>
        <p class="verify-block-label">Create owner account</p>
        <label class="verify-field"><span>Name</span><input name="name" autocomplete="name" required></label>
        <label class="verify-field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
        <label class="verify-field"><span>Password</span><input type="password" name="password" minlength="8" required></label>
        <button class="button button-secondary" type="submit">Create account</button>
      </form>
      ${error ? `<p class="auth-error">${escapeHtml(error)}</p>` : ""}
    </div>
  </section>`;
}

function renderForbidden(status) {
  return `<section class="job-gate"><div><p class="eyebrow">Private tool</p><h1>Owner access required</h1>
    <p class="section-intro">Signed in as ${escapeHtml(status.email)}. This account is not on the owner allowlist.</p></div></section>`;
}

function renderBudget(usage = {}) {
  const spent = Number(usage.spentUsd || 0);
  const budget = Number(usage.budgetUsd || 5);
  const percent = budget ? Math.min(100, (spent / budget) * 100) : 0;
  const providers = Object.entries(usage.byProvider || {});
  const quotas = usage.freeQuotas || {};
  const quotaCards = Object.entries(quotas).map(([provider, quota]) => {
    if (provider === "local") {
      return `<article class="job-free-quota"><div><span>Windows Qwen</span><strong>${quota.configured ? "unlimited" : "worker status below"}</strong></div><small>$0 inference &middot; ${escapeHtml(quota.model || "Qwen")}</small></article>`;
    }
    const isCloudflare = provider === "cloudflare";
    const used = isCloudflare ? Number(quota.neurons || 0) : Number(quota.requests || 0);
    const limit = isCloudflare ? Number(quota.neuronLimit || 0) : Number(quota.requestLimit || 0);
    const unit = isCloudflare ? "neurons" : "requests";
    const percent = limit ? Math.min(100, (used / limit) * 100) : 0;
    return `<article class="job-free-quota"><div><span>${escapeHtml(provider)}</span><strong>${quota.configured ? `${Math.round(used).toLocaleString()} / ${Math.round(limit).toLocaleString()}` : "not configured"}</strong></div>
      <div class="job-budget-track"><span style="width:${percent.toFixed(1)}%"></span></div><small>${escapeHtml(unit)} today</small></article>`;
  }).join("");
  return `<section class="job-budget" aria-label="Monthly job-search budget">
    <div class="job-budget-head"><div><span>Monthly API spend</span><strong>$${spent.toFixed(2)} / $${budget.toFixed(2)}</strong></div><span>${escapeHtml(usage.month || "Current month")}</span></div>
    <div class="job-budget-track"><span style="width:${percent.toFixed(1)}%"></span></div>
    <div class="job-budget-providers">${providers.length ? providers.map(([name, value]) => `<span>${escapeHtml(name)}: ${Number(value.requests || 0)} calls &middot; $${Number(value.costUsd || 0).toFixed(2)}</span>`).join("") : "<span>No metered usage yet</span>"}</div>
    ${quotaCards ? `<div class="job-free-quota-grid">${quotaCards}</div>` : ""}
  </section>`;
}

function renderRuntime(runtime = {}, localProcessing = {}) {
  const providers = Object.entries(runtime.providers || {}).filter(([name]) => name !== "local");
  const worker = localProcessing.workers?.[0];
  return `<div class="job-runtime-grid">
    <article class="job-runtime-card"><span>Windows AI worker</span><strong>${escapeHtml(workerStatusLabel(worker))}</strong></article>
    ${providers.map(([name, configured]) => `<article class="job-runtime-card"><span>${escapeHtml(name)}</span><strong>${configured ? "configured" : "missing"}</strong></article>`).join("")}
    <article class="job-runtime-card"><span>Repository</span><strong>${escapeHtml(runtime.repository)}</strong></article>
    <article class="job-runtime-card"><span>Fallbacks</span><strong>${escapeHtml(runtime.productionFallbacks)}</strong></article>
  </div>`;
}

function renderSummary(summary = {}) {
  const entries = [
    ["Raw leads retained", summary.rawLeads || 0], ["Awaiting extraction", summary.extractionPending || 0],
    ["All candidates", summary.total || 0], ["Relevant", summary.relevant || 0],
    ["Uncertain", summary.uncertain || 0], ["Clear mismatches", summary.clearMismatches || 0],
    ["Deep review queue", summary.needsReview || 0], ["Shortlisted", summary.shortlist || 0],
  ];
  const labelled = Number(summary.labelled || 0);
  const target = Number(summary.calibrationTarget || 20);
  const calibration = summary.calibration || {};
  return `<div class="job-summary-grid">${entries.map(([label, value]) => `<article class="job-stat-card"><span>${label}</span><strong>${value}</strong></article>`).join("")}</div>
    <section class="job-calibration"><div><span>Calibration labels</span><strong>${labelled} / ${target}</strong></div><div class="job-budget-track"><span style="width:${Math.min(100, target ? (labelled / target) * 100 : 0).toFixed(1)}%"></span></div><small>Auto-shortlisting ${calibration.active ? "enabled" : "locked"} &middot; top-10 precision ${Math.round(Number(calibration.precisionTopTen || 0) * 100)}% &middot; false rejection ${Math.round(Number(calibration.falseRejectionRate || 0) * 100)}%</small></section>`;
}

function renderAudit(audit) {
  if (!audit) return "";
  const population = audit.population || {};
  const anomalyEntries = Object.entries(population.anomaliesByCode || {});
  const sample = audit.sample || [];
  const gateNames = [
    ["expertiseFit", "Expertise"],
    ["workAuthorization", "Visa / OPT"],
    ["compensation", "Compensation"],
    ["codingInterview", "Coding interview"],
  ];
  return `<section class="job-calibration">
    <div><span>Independent evaluation audit</span><strong>${Number(audit.sample?.length || 0)} / ${Number(audit.requestedSampleSize || 20)} sampled</strong></div>
    <small>${Number(population.currentDeepAndCritic || 0)} current evaluator + critic results &middot; ${Number(population.incompleteOrStale || 0)} incomplete or stale &middot; ${Number(population.jobsWithAutomatedAnomalies || 0)} jobs with anomalies</small>
    ${anomalyEntries.length ? `<div class="job-budget-providers">${anomalyEntries.map(([code, count]) => `<span>${escapeHtml(statusLabel(code))}: ${Number(count || 0)}</span>`).join("")}</div>` : `<small>No automated anomalies found in the evaluated population.</small>`}
    ${sample.length ? `<details class="job-audit-details"><summary>Inspect the ${sample.length} sampled evaluations</summary><div class="job-audit-list">${sample.map((job, index) => {
      const deep = job.deepEvaluation || {};
      const critic = job.critic || {};
      const findings = job.findings || [];
      return `<div class="job-audit-row">
        <div class="job-audit-heading"><span>${index + 1}</span><div><strong>${escapeHtml(job.title || "Untitled role")}</strong><small>${escapeHtml(job.company || "Unknown company")}${job.location ? ` &middot; ${escapeHtml(job.location)}` : ""}</small></div><div><strong>${escapeHtml(statusLabel(deep.verdict || "missing"))} ${Number.isFinite(Number(deep.overallScore)) ? `&middot; ${Number(deep.overallScore)}` : ""}</strong><small>Critic: ${escapeHtml(statusLabel(critic.recommendedVerdict || "missing"))}${critic.agrees === false ? " &middot; disagrees" : critic.agrees === true ? " &middot; agrees" : ""}</small></div></div>
        <div class="job-audit-gates">${gateNames.map(([key, label]) => `<span><small>${label}</small><strong>${escapeHtml(statusLabel(deep.mustHave?.[key]?.status || "missing"))}</strong></span>`).join("")}</div>
        ${findings.length ? `<div class="job-audit-findings">${findings.map((finding) => `<span>${escapeHtml(statusLabel(finding.code))}</span>`).join("")}</div>` : `<small>No automated finding for this evaluation.</small>`}
        ${deep.summary ? `<p>${escapeHtml(deep.summary)}</p>` : ""}
        ${job.url ? `<a class="inline-link" href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">Open role</a>` : ""}
      </div>`;
    }).join("")}</div></details>` : ""}
  </section>`;
}

function renderLocalProcessing(local = {}, audit = null, loadingAction = "") {
  const tasks = local.tasks || [];
  const workers = local.workers || [];
  const worker = workers[0] || null;
  const queueControl = local.queueControl || {};
  const connected = workerIsConnected(worker);
  const activeCalibrationSize = Array.isArray(queueControl.activeReleaseJobIds)
    ? queueControl.activeReleaseJobIds.length
    : 0;
  const workerDetail = workerStatusDetail(worker);
  return `<section class="job-panel"><div class="job-panel-head"><div><p class="eyebrow">Local inference</p><h2>Windows worker</h2></div><span>${escapeHtml(workerStatusLabel(worker))}</span></div>
    <div class="job-runtime-grid">
      ${tasks.length ? tasks.map((task) => `<article class="job-runtime-card"><span>${escapeHtml(statusLabel(task.taskType))} &middot; ${escapeHtml(statusLabel(task.status))}</span><strong>${Number(task.count || 0)}</strong></article>`).join("") : `<article class="job-runtime-card"><span>Queue</span><strong>Empty</strong></article>`}
      ${worker ? `<article class="job-runtime-card"><span>Last seen</span><strong>${escapeHtml(formatDate(worker.lastSeenAt))}</strong></article>` : ""}<article class="job-runtime-card"><span>Queue hold</span><strong>${queueControl.holdNewTasks ? "Enabled" : "Disabled"}</strong></article>
    </div>
    ${workerDetail ? `<p class="job-muted">${escapeHtml(workerDetail)}</p>` : ""}
    <div class="job-actions">
      <button type="button" class="button button-primary" data-queue-release ${!queueControl.holdNewTasks || !connected || loadingAction ? "disabled" : ""}>${loadingAction === "release" ? "Releasing..." : "Release calibration 20"}</button>
      <button type="button" class="button button-primary" data-cloud-calibration ${activeCalibrationSize !== 20 || loadingAction ? "disabled" : ""}>${loadingAction === "cloud-calibration" ? "Starting..." : `Run free cloud calibration (${activeCalibrationSize})`}</button>
      <button type="button" class="button button-secondary" data-queue-retry ${!connected || loadingAction ? "disabled" : ""}>${loadingAction === "retry" ? "Retrying..." : "Retry failed"}</button>
      <button type="button" class="button button-secondary" data-run-audit ${loadingAction ? "disabled" : ""}>${loadingAction === "audit" ? "Auditing..." : "Audit 20 evaluations"}</button>
    </div>
    ${!connected ? `<p class="job-muted">The worker must send a current heartbeat before a calibration cohort can be released.</p>` : ""}
    ${!queueControl.holdNewTasks ? `<p class="job-muted">Pause the full queue before releasing a bounded calibration cohort.</p>` : ""}
    ${renderAudit(audit)}
  </section>`;
}

const FEEDBACK_REASONS = [
  ["wrong_function", "Wrong function"], ["too_hands_on", "Too hands-on"],
  ["coding_interview", "Coding interview"], ["seniority", "Seniority"],
  ["compensation", "Compensation"], ["location_work_authorization", "Location / authorization"],
  ["domain", "Domain"], ["company", "Company"], ["duplicate_expired", "Duplicate / expired"], ["other", "Other"],
];

function renderClaims(claims = []) {
  if (!claims.length) return `<p class="job-muted">No grounded claims yet.</p>`;
  return `<div class="job-claims">${claims.slice(0, 12).map((claim) => `<div class="job-claim">
    <div><strong>${escapeHtml(statusLabel(claim.claimType))}</strong><span>${escapeHtml(claim.evidenceType)} &middot; ${Math.round(Number(claim.confidence || 0) * 100)}%</span></div>
    <p>${escapeHtml(claim.value)}</p>
    ${claim.supportingPassage ? `<blockquote>${escapeHtml(claim.supportingPassage)}</blockquote>` : ""}
    ${claim.sourceUrl ? `<a class="inline-link" href="${escapeHtml(claim.sourceUrl)}" target="_blank" rel="noreferrer">Source</a>` : ""}
  </div>`).join("")}</div>`;
}

const DIMENSION_LABELS = {
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
  roleFit: "Legacy role fit",
  locationAuthorization: "Legacy location / authorization",
  compensationUpside: "Legacy compensation upside",
  codingInterviewRisk: "Legacy coding-interview signal",
  leadershipLevel: "Legacy leadership level",
  aiDataRelevance: "Legacy AI / data relevance",
};

const GATE_LABELS = {
  expertiseFit: "Responsibilities match past experience",
  workAuthorization: "F-1 OPT / future sponsorship",
  compensation: "Base compensation reaches $170K",
  codingInterview: "No software-engineering coding interview",
};

function renderMustHaves(job) {
  if (!job.mustHave) return "";
  return `<section class="job-must-have"><div class="job-section-heading"><strong>Must-have gates</strong><span>Any confirmed blocker means pass; unknown means review</span></div>
    <div class="job-gate-grid">${Object.entries(job.mustHave).map(([name, gate]) => {
      const sourceUrl = safeExternalUrl(gate.sourceUrl);
      return `<article class="job-gate-result job-gate-result--${escapeHtml(gate.status || "unknown")}">
        <div><span>${escapeHtml(GATE_LABELS[name] || statusLabel(name))}</span><strong>${escapeHtml(gate.status || "unknown")}</strong></div>
        <p>${escapeHtml(gate.reasoning || "Evidence has not been established.")}</p>
        <small>${escapeHtml(gate.evidenceStatus || "unknown")} evidence${gate.riskLevel ? ` &middot; ${escapeHtml(statusLabel(gate.riskLevel))} role risk` : ""}${sourceUrl ? ` &middot; <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Source</a>` : ""}</small>
      </article>`;
    }).join("")}</div></section>`;
}

function renderDimensions(job) {
  const dimensions = job.dimensions;
  if (!dimensions) return "";
  const weights = job.decision?.weights || {};
  return `<section><div class="job-section-heading"><strong>Weighted evaluation</strong><span>Unknown evidence is not scored as failure</span></div>
    <div class="job-dimensions">${Object.entries(dimensions).map(([name, value]) => {
      const score = value?.score === null || value?.score === undefined ? "Unknown" : `${escapeHtml(value.score)}/5`;
      const weight = weights[name] ? `${weights[name]}% weight` : "legacy result";
      return `<div class="${value?.score === null || value?.score === undefined ? "is-unknown" : ""}"><span>${escapeHtml(DIMENSION_LABELS[name] || statusLabel(name))}</span><strong>${score}</strong><small>${escapeHtml(weight)} &middot; ${escapeHtml(value?.evidenceStatus || "unknown")} evidence</small><p>${escapeHtml(value?.reasoning || "Evidence has not been established.")}</p></div>`;
    }).join("")}</div></section>`;
}

function renderFeedbackForm(job) {
  return `<form class="job-feedback-form" data-feedback-form="${escapeHtml(job.id)}">
    <div class="job-disposition-row">
      ${["apply", "maybe", "pass"].map((value) => `<button type="submit" name="disposition" value="${value}" class="verify-inline-button ${job.disposition === value ? "verify-inline-button--saved" : ""}">${value === "apply" ? "Shortlist" : value === "maybe" ? "Review" : "Pass"}</button>`).join("")}
    </div>
    <details><summary>Feedback reasons</summary><div class="job-feedback-reasons">
      ${FEEDBACK_REASONS.map(([value, label]) => `<label><input type="checkbox" name="reasons" value="${value}" ${(job.feedbackReasons || []).includes(value) ? "checked" : ""}><span>${label}</span></label>`).join("")}
      <label class="job-feedback-note"><span>Note</span><textarea name="note" rows="2" maxlength="1000">${escapeHtml(job.feedbackNote || "")}</textarea></label>
    </div></details>
  </form>`;
}

function renderCardFact(label, fact, { showEvidence = false } = {}) {
  const sourceUrl = safeExternalUrl(fact?.sourceUrl);
  const tone = ["not_available", "citizenship_required"].includes(fact?.status) ? "bad"
    : ["listed", "available", "opt_friendly"].includes(fact?.status) ? "good" : "neutral";
  return `<div class="job-card-fact job-card-fact--${tone}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(fact?.label || "Unknown")}</strong>
    ${showEvidence && fact?.evidence ? `<small>${escapeHtml(fact.evidence)}</small>` : ""}
    ${showEvidence && sourceUrl && fact?.evidenceType !== "unknown" ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">View evidence</a>` : ""}
  </div>`;
}

function renderCardFacts(job) {
  const facts = job.cardFacts || {};
  const postingUrl = safeExternalUrl(facts.posting?.url || job.url);
  return `<section class="job-card-facts" aria-label="Essential job facts">
    ${renderCardFact("Company", facts.company || { label: job.company || "Company not identified" })}
    ${renderCardFact("Location", { label: job.location || "Not listed", status: job.location ? "listed" : "unknown" })}
    ${renderCardFact("Compensation", facts.compensation, { showEvidence: true })}
    ${renderCardFact("Visa / sponsorship", facts.visa, { showEvidence: true })}
    <div class="job-card-fact job-card-fact--url"><span>Job URL</span>
      ${postingUrl ? `<a href="${escapeHtml(postingUrl)}" target="_blank" rel="noreferrer">${escapeHtml(postingUrl)}</a>` : `<strong>Original posting URL unavailable</strong>`}
    </div>
  </section>`;
}

function renderJob(job) {
  const hasScore = job.score !== null && job.score !== undefined && job.score !== "";
  const score = hasScore && Number.isFinite(Number(job.score)) ? Math.round(Number(job.score)) : null;
  const outreach = job.outreach?.message || "";
  const activeModel = job.models?.deep?.model ? job.models.deep
    : job.models?.triage?.model ? job.models.triage : null;
  return `<article class="job-result" data-job-id="${escapeHtml(job.id)}">
    <div class="job-result-head">
      <div><p class="eyebrow">${escapeHtml(job.roleFamily || "Exploratory")}</p><h3>${escapeHtml(job.title)}</h3>
        <p>${escapeHtml(job.company || "Company not identified")} &middot; ${escapeHtml(job.location || "Location not listed")}</p></div>
      <div class="job-result-score"><span>${score === null ? "Pending" : score}</span><small>${escapeHtml(statusLabel(job.status))}</small></div>
    </div>
    ${renderCardFacts(job)}
    <p class="job-reasoning">${escapeHtml(job.summary)}</p>
    <div class="job-pill-row">
      ${(job.greenFlags || []).slice(0, 4).map((flag) => `<span class="job-pill job-pill--good">${escapeHtml(flag)}</span>`).join("")}
      ${(job.redFlags || []).slice(0, 3).map((flag) => `<span class="job-pill job-pill--bad">${escapeHtml(flag)}</span>`).join("")}
      ${(job.unknowns || []).slice(0, 3).map((flag) => `<span class="job-pill">Unknown: ${escapeHtml(flag)}</span>`).join("")}
    </div>
    <div class="job-result-meta"><span>${escapeHtml(job.sourceProvider)}</span><span>${escapeHtml(job.lane)}</span><span>${activeModel ? `AI: ${escapeHtml(activeModel.provider)} &middot; ${escapeHtml(activeModel.model)}` : "AI: pending"}</span><span>Decision: ${job.decisionSource === "owner" ? "You" : "AI"}</span><span>Agreement: ${escapeHtml(job.modelAgreement)}</span><span>${formatDate(job.postedAt || job.firstSeenAt)}</span></div>
    <div class="job-result-actions">
      ${safeExternalUrl(job.url) ? `<a class="button button-secondary" href="${escapeHtml(safeExternalUrl(job.url))}" target="_blank" rel="noreferrer">Open role</a>` : ""}
      <button type="button" class="verify-inline-button" data-rerun-job="${escapeHtml(job.id)}">Rerun</button>
      ${outreach ? `<button type="button" class="verify-inline-button" data-copy-outreach="${escapeHtml(job.id)}">Copy outreach</button>` : ""}
    </div>
    ${renderFeedbackForm(job)}
    <details class="job-detail"><summary>Evidence and full evaluation</summary>
      ${renderMustHaves(job)}
      ${renderDimensions(job)}
      ${job.critic ? `<section class="job-critic"><strong>Independent AI review</strong><p>${escapeHtml(job.critic.summary)}</p>${(job.critic.objections || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</section>` : ""}
      ${renderClaims(job.claims)}
      ${(job.contactCandidates || []).length ? `<section class="job-contacts"><strong>Hiring contact candidates</strong>${job.contactCandidates.map((contact) => `<a href="${escapeHtml(contact.url)}" target="_blank" rel="noreferrer"><span>${escapeHtml(contact.nameOrTitle)}</span><small>${escapeHtml(contact.evidence || "Search evidence")}</small></a>`).join("")}</section>` : ""}
      ${outreach ? `<section class="job-outreach"><strong>${escapeHtml(job.outreach.subject || "Outreach")}</strong><p>${escapeHtml(outreach)}</p></section>` : ""}
      <p class="job-description">${escapeHtml(job.description)}</p>
    </details>
  </article>`;
}

function renderJobs(jobs = []) {
  if (!jobs.length) return `<div class="ops-empty"><strong>No jobs in this view</strong><p>New or reclassified jobs will appear after the next completed run.</p></div>`;
  return `<div class="job-results">${jobs.map(renderJob).join("")}</div>`;
}

function renderDiscoveryLeads(leads = [], pagination = {}) {
  if (!leads.length) return `<div class="ops-empty"><strong>No raw leads retained yet</strong><p>The next local portal collection will populate this view.</p></div>`;
  return `<section class="job-panel"><div class="job-panel-head"><div><p class="eyebrow">Metadata-first intake</p><h2>Raw discovery leads</h2></div><span>${Number(pagination.total || leads.length)} retained</span></div>
    <div class="job-run-list">${leads.map((lead) => {
      const url = safeExternalUrl(lead.url);
      return `<article class="job-run-card"><div><span>${escapeHtml(lead.sourceProvider)}</span><strong>${escapeHtml(statusLabel(lead.status))}</strong></div>
        <h3>${escapeHtml(lead.title)}</h3><p>${escapeHtml(lead.company)}${lead.location ? ` &middot; ${escapeHtml(lead.location)}` : ""}</p>
        <p>${escapeHtml(statusLabel(lead.lane))} &middot; ${escapeHtml(statusLabel(lead.familyId))} &middot; ${formatDate(lead.lastSeenAt)}</p>
        <small>${escapeHtml(lead.reason)}</small>${url ? `<a class="inline-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}</article>`;
    }).join("")}</div></section>`;
}

function renderTaxonomy(taxonomy = {}) {
  const proposed = taxonomy.proposed || [];
  const active = taxonomy.active || [];
  const entries = [...proposed, ...active];
  const totals = taxonomy.totals || {};
  return `<section class="job-panel"><div class="job-panel-head"><div><p class="eyebrow">Title intelligence</p><h2>Title rules</h2></div><span>${Number(totals.proposed || 0)} awaiting review &middot; ${Number(totals.active || 0)} active</span></div>
    <p class="job-muted"><strong>Candidate routing:</strong> (target function AND target seniority) OR specialist exception OR at least two distinct target functions. Engineering IC exclusions are applied first, with a leadership override for eligible analytics, science, product, strategy, platform, or architecture management.</p>
    <div class="job-taxonomy-list">${entries.length ? entries.map((pattern) => `<article><div><strong>${escapeHtml(pattern.expression)}</strong><span>${escapeHtml(pattern.familyLabel)} &middot; ${escapeHtml(pattern.matchType)} &middot; ${escapeHtml(pattern.status)}</span></div><p>${escapeHtml(pattern.metrics?.rationale || "Curated title alias")}</p><div>${pattern.status === "proposed" ? `<button class="verify-inline-button" data-taxonomy-action="approve" data-pattern-id="${escapeHtml(pattern.id)}">Approve</button><button class="verify-inline-button" data-taxonomy-action="reject" data-pattern-id="${escapeHtml(pattern.id)}">Reject</button>` : pattern.version > 1 ? `<button class="verify-inline-button" data-taxonomy-action="rollback" data-pattern-id="${escapeHtml(pattern.id)}">Rollback</button>` : ""}</div></article>`).join("") : `<p class="verify-note">No title rules on this page.</p>`}</div>
  </section>`;
}

function renderRuns(runs = []) {
  const collectorSummary = (run) => Object.entries(run.providers?.collector?.sources || {})
    .map(([sourceId, state]) => `${sourceId}: ${state.status} (${Number(state.jobCount || 0)} jobs)`)
    .join(" | ");
  return `<section class="job-panel"><div class="job-panel-head"><div><p class="eyebrow">Operations</p><h2>Workflow runs</h2></div></div>
    <div class="job-run-list">${runs.length ? runs.map((run) => `<article class="job-run-card"><div><span>${escapeHtml(run.trigger)}</span><strong>${escapeHtml(statusLabel(run.status))}</strong></div><p>${escapeHtml(statusLabel(run.phase))} &middot; ${formatDate(run.startedAt)}</p><p>${Number(run.stats?.discovered || 0)} discovered &middot; ${Number(run.stats?.triaged || 0)} triaged &middot; ${Number(run.stats?.deepEvaluated || 0)} deep &middot; ${Number(run.stats?.shortlisted || 0)} shortlisted</p>${collectorSummary(run) ? `<small>${escapeHtml(collectorSummary(run))}</small>` : ""}${(run.errors || []).map((error) => `<small>${escapeHtml(error.message)}</small>`).join("")}</article>`).join("") : `<p class="verify-note">No runs yet.</p>`}</div>
  </section>`;
}

const TABS = [
  ["discovery", "Discovery"],
  ["all_candidates", "All candidates"], ["relevant", "Relevant"],
  ["uncertain", "Uncertain"], ["clear_mismatch", "Clear mismatches"],
  ["shortlist", "Shortlist"], ["needs_review", "Deep review"],
  ["passed", "Passed"], ["expired", "Expired"], ["taxonomy", "Title rules"], ["runs", "Runs"],
];

const NON_JOB_VIEWS = new Set(["discovery", "taxonomy", "runs"]);

function renderViewFilters(dashboard, state) {
  if (NON_JOB_VIEWS.has(state.view)) return "";
  const filters = dashboard.filters || {};
  const counts = filters.decisionCounts || {};
  const families = filters.roleFamilies || [];
  return `<section class="job-view-controls" aria-label="View filters">
    <div class="job-source-filter" role="group" aria-label="Decision source">
      ${[["all", "All", counts.all], ["owner", "My decisions", counts.owner], ["model", "AI decisions", counts.model]].map(([value, label, count]) => `<button type="button" class="${state.decisionSource === value ? "is-active" : ""}" data-decision-source="${value}">${label} (${Number(count || 0)})</button>`).join("")}
    </div>
    <label><span>Role family</span><select data-role-family><option value="all">All role families</option>${families.map((family) => `<option value="${escapeHtml(family.id)}" ${state.roleFamily === family.id ? "selected" : ""}>${escapeHtml(family.label)} (${Number(family.count || 0)})</option>`).join("")}</select></label>
  </section>`;
}

function renderPagination(pagination = {}) {
  const page = Number(pagination.page || 1);
  const totalPages = Number(pagination.totalPages || 1);
  const total = Number(pagination.total || 0);
  const start = total ? (page - 1) * Number(pagination.pageSize || 10) + 1 : 0;
  const end = Math.min(total, page * Number(pagination.pageSize || 10));
  return `<nav class="job-pagination" aria-label="Results pages">
    <button type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Previous page" title="Previous page">&#8592;</button>
    <span>${start}-${end} of ${total} &middot; Page ${page} of ${totalPages}</span>
    <button type="button" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""} aria-label="Next page" title="Next page">&#8594;</button>
  </nav>`;
}

function renderDashboard(state) {
  if (!state.dashboard) {
    return `<section class="job-gate"><div><p class="eyebrow">Private command center</p><h1>Job Intelligence</h1>
      <p class="section-intro">The dashboard data could not be loaded.</p>
      ${state.error ? `<p class="auth-error">${escapeHtml(state.error)}</p>` : ""}
      <button type="button" class="button button-primary" data-retry-dashboard>Retry</button></div></section>`;
  }

  const dashboard = state.dashboard;
  const active = state.view;
  const content = active === "taxonomy" ? renderTaxonomy(dashboard.taxonomy)
    : active === "runs" ? renderRuns(dashboard.runs)
      : active === "discovery" ? renderDiscoveryLeads(dashboard.discoveryLeads, dashboard.pagination)
        : renderJobs(dashboard.jobs);
  return `<section class="job-hero"><div><p class="eyebrow">Private command center</p><h1>Job Intelligence</h1>
      <p class="section-intro">Evidence-grounded sourcing for analytics, experimentation, product data science, strategy, and adjacent AI roles.</p></div>
    <div class="job-actions"><button type="button" class="button button-primary" data-run-ingest ${state.loading ? "disabled" : ""}>${state.loading ? "Queueing..." : "Run now"}</button>
      <label class="verify-field"><span>Manual job URLs</span><textarea rows="3" data-manual-urls placeholder="One URL per line">${escapeHtml(state.manualUrls)}</textarea></label></div></section>
    ${state.error ? `<p class="auth-error">${escapeHtml(state.error)}</p>` : ""}
    ${state.notice ? `<p class="job-notice">${escapeHtml(state.notice)}</p>` : ""}
    ${renderSummary(dashboard.summary)}${renderBudget(dashboard.usage)}${renderLocalProcessing(dashboard.localProcessing, state.audit, state.loadingAction)}${renderRuntime(dashboard.runtime, dashboard.localProcessing)}
    <nav class="job-filter-tabs" aria-label="Job intelligence views">${TABS.map(([value, label]) => `<button type="button" class="${active === value ? "is-active" : ""}" data-job-view="${value}">${label} (${Number(dashboard.tabCounts?.[value] || 0)})</button>`).join("")}</nav>
    ${renderViewFilters(dashboard, state)}
    ${content}
    ${renderPagination(dashboard.pagination)}`;
}

export function mountJobSearch(root) {
  if (!root) return;
  const state = { status: null, dashboard: null, audit: null, loading: false, loadingAction: "", error: "", notice: "", view: "all_candidates", page: 1, decisionSource: "all", roleFamily: "all", manualUrls: "" };

  async function loadStatus() { state.status = await request("/api/job-search/status"); }
  async function loadDashboard() {
    const params = new URLSearchParams({
      view: state.view,
      page: String(state.page),
      decisionSource: state.decisionSource,
      roleFamily: state.roleFamily,
    });
    state.dashboard = await request(`/api/job-search/jobs?${params}`);
    state.page = Number(state.dashboard.pagination?.page || 1);
  }

  async function render() {
    if (!state.status) { root.innerHTML = `<div class="ops-empty"><strong>Loading...</strong></div>`; return; }
    if (!state.status.signedIn) { root.innerHTML = renderLogin(state.error); bindLogin(); return; }
    if (!state.status.allowed) { root.innerHTML = renderForbidden(state.status); return; }
    root.innerHTML = renderDashboard(state); bindDashboard();
  }

  function bindLogin() {
    root.querySelector("[data-job-login]")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      try { state.error = ""; await loginWithPassword(form.get("email"), form.get("password")); await loadStatus(); if (state.status.allowed) await loadDashboard(); }
      catch (error) { state.error = error.message; }
      await render();
    });
    root.querySelector("[data-job-register]")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      try { state.error = ""; await registerAccount(form.get("name"), form.get("email"), form.get("password")); await loadStatus(); if (state.status.allowed) await loadDashboard(); else state.error = "Account created, but the email is not on the owner allowlist."; }
      catch (error) { state.error = error.message; }
      await render();
    });
  }

  async function pollRun(runId) {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const { run } = await request(`/api/job-search/runs/${encodeURIComponent(runId)}`);
      state.notice = `Run ${statusLabel(run.status)} | ${statusLabel(run.phase)}`;
      if (["completed", "partial", "failed", "blocked"].includes(run.status)) { await loadDashboard(); await render(); return; }
      if (attempt % 3 === 0) await render();
    }
    state.notice = "Run is continuing in the background."; await render();
  }

  function bindDashboard() {
    root.querySelector("[data-retry-dashboard]")?.addEventListener("click", async () => {
      try { state.error = ""; await loadDashboard(); }
      catch (error) { state.error = error.message; }
      await render();
    });
    root.querySelector("[data-run-ingest]")?.addEventListener("click", async () => {
      try {
        state.loading = true; state.error = ""; state.notice = "";
        state.manualUrls = root.querySelector("[data-manual-urls]")?.value || ""; await render();
        const discoveryUrls = state.manualUrls.split(/\n+/).map((item) => item.trim()).filter(Boolean);
        const queued = await request("/api/job-search/ingest", { method: "POST", body: JSON.stringify({ discoveryUrls }) });
        state.notice = `Run queued: ${queued.runId}`; state.loading = false; await render();
        pollRun(queued.runId).catch((error) => { state.error = error.message; render(); });
      } catch (error) { state.loading = false; state.error = error.message; await render(); }
    });
    root.querySelector("[data-queue-release]")?.addEventListener("click", async () => {
      try {
        state.loadingAction = "release"; state.error = ""; await render();
        const operationKey = `dashboard-calibration-v4-${Date.now()}`;
        const result = await request("/api/job-search/local-queue/release", { method: "POST", body: JSON.stringify({ operationKey, limit: 20 }) });
        state.notice = `Released ${Number(result.selectedCount || 0)} jobs for the evaluator and critic.`;
        await loadDashboard();
      } catch (error) { state.error = error.message; }
      state.loadingAction = ""; await render();
    });
    root.querySelector("[data-queue-retry]")?.addEventListener("click", async () => {
      try {
        state.loadingAction = "retry"; state.error = ""; await render();
        const operationKey = `dashboard-retry-v4-${Date.now()}`;
        const result = await request("/api/job-search/local-queue/retry-failed", { method: "POST", body: JSON.stringify({ operationKey, limit: 20 }) });
        state.notice = `Requeued ${Number(result.retriedCount || 0)} failed tasks in the active cohort.`;
        await loadDashboard();
      } catch (error) { state.error = error.message; }
      state.loadingAction = ""; await render();
    });
    root.querySelector("[data-cloud-calibration]")?.addEventListener("click", async () => {
      try {
        state.loadingAction = "cloud-calibration"; state.error = ""; await render();
        const operationKey = `dashboard-cloud-calibration-${Date.now()}`;
        const result = await request("/api/job-search/calibration/free-cloud", {
          method: "POST",
          body: JSON.stringify({ operationKey, expectedSize: 20 }),
        });
        state.notice = `Free evaluator and critic run queued for ${Number(result.cohort?.length || 0)} jobs: ${result.runId}`;
        await loadDashboard();
        pollRun(result.runId).catch((error) => { state.error = error.message; render(); });
      } catch (error) { state.error = error.message; }
      state.loadingAction = ""; await render();
    });
    root.querySelector("[data-run-audit]")?.addEventListener("click", async () => {
      try {
        state.loadingAction = "audit"; state.error = ""; await render();
        const result = await request(`/api/job-search/audit?sampleSize=20&seed=${encodeURIComponent(`dashboard-${new Date().toISOString().slice(0, 10)}`)}`);
        state.audit = result.audit;
        state.notice = `Audit sampled ${Number(result.audit?.sample?.length || 0)} current evaluator-and-critic results.`;
      } catch (error) { state.error = error.message; }
      state.loadingAction = ""; await render();
    });
    root.querySelectorAll("[data-job-view]").forEach((node) => node.addEventListener("click", async () => {
      try { state.view = node.dataset.jobView; state.page = 1; state.decisionSource = "all"; state.roleFamily = "all"; state.error = ""; await loadDashboard(); }
      catch (error) { state.error = error.message; }
      await render();
    }));
    root.querySelectorAll("[data-decision-source]").forEach((node) => node.addEventListener("click", async () => {
      try { state.decisionSource = node.dataset.decisionSource; state.page = 1; state.error = ""; await loadDashboard(); }
      catch (error) { state.error = error.message; }
      await render();
    }));
    root.querySelector("[data-role-family]")?.addEventListener("change", async (event) => {
      try { state.roleFamily = event.currentTarget.value; state.page = 1; state.error = ""; await loadDashboard(); }
      catch (error) { state.error = error.message; }
      await render();
    });
    root.querySelectorAll("[data-page]").forEach((node) => node.addEventListener("click", async () => {
      if (node.disabled) return;
      try { state.page = Number(node.dataset.page || 1); state.error = ""; await loadDashboard(); }
      catch (error) { state.error = error.message; }
      await render();
    }));
    root.querySelectorAll("[data-feedback-form]").forEach((form) => form.addEventListener("submit", async (event) => {
      event.preventDefault(); const submitter = event.submitter; if (!submitter?.value) return;
      const data = new FormData(event.currentTarget);
      try {
        await request(`/api/job-search/jobs/${encodeURIComponent(form.dataset.feedbackForm)}/feedback`, { method: "POST", body: JSON.stringify({ disposition: submitter.value, reasons: data.getAll("reasons"), note: data.get("note") || "" }) });
        await loadDashboard(); await render();
      } catch (error) { state.error = error.message; await render(); }
    }));
    root.querySelectorAll("[data-taxonomy-action]").forEach((node) => node.addEventListener("click", async () => {
      try { await request(`/api/job-search/taxonomy/${encodeURIComponent(node.dataset.patternId)}/${node.dataset.taxonomyAction}`, { method: "POST", body: "{}" }); await loadDashboard(); await render(); }
      catch (error) { state.error = error.message; await render(); }
    }));
    root.querySelectorAll("[data-rerun-job]").forEach((node) => node.addEventListener("click", async () => {
      try { const queued = await request(`/api/job-search/jobs/${encodeURIComponent(node.dataset.rerunJob)}/rerun`, { method: "POST", body: "{}" }); state.notice = `Deep evaluation queued for the Windows worker: ${queued.taskId}`; await loadDashboard(); await render(); }
      catch (error) { state.error = error.message; await render(); }
    }));
    root.querySelectorAll("[data-copy-outreach]").forEach((node) => node.addEventListener("click", async () => {
      const job = (state.dashboard?.jobs || []).find((item) => item.id === node.dataset.copyOutreach);
      if (job?.outreach?.message && navigator.clipboard) { await navigator.clipboard.writeText(job.outreach.message); node.textContent = "Copied"; }
    }));
  }

  loadStatus().then(async () => { if (state.status.allowed) await loadDashboard(); })
    .catch((error) => { state.error = error.message; }).finally(render);
}
