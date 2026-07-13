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
    local_triage_pending: "Waiting for Mac triage",
    deep_review_pending: "Waiting for Mac deep review",
    critic_pending: "Waiting for critic review",
    queued_local: "Queued for Mac",
  };
  if (labels[value]) return labels[value];
  return String(value || "unknown").replaceAll("_", " ");
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
      return `<article class="job-free-quota"><div><span>Local Qwen</span><strong>${quota.configured ? "unlimited" : "waiting for Mac"}</strong></div><small>$0 inference Â· ${escapeHtml(quota.model || "qwen3-14b")}</small></article>`;
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
    <div class="job-budget-providers">${providers.length ? providers.map(([name, value]) => `<span>${escapeHtml(name)}: ${Number(value.requests || 0)} calls Â· $${Number(value.costUsd || 0).toFixed(2)}</span>`).join("") : "<span>No metered usage yet</span>"}</div>
    ${quotaCards ? `<div class="job-free-quota-grid">${quotaCards}</div>` : ""}
  </section>`;
}

function renderRuntime(runtime = {}) {
  const providers = runtime.providers || {};
  return `<div class="job-runtime-grid">
    ${Object.entries(providers).map(([name, configured]) => `<article class="job-runtime-card"><span>${escapeHtml(name)}</span><strong>${configured ? "configured" : "missing"}</strong></article>`).join("")}
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
    <section class="job-calibration"><div><span>Calibration labels</span><strong>${labelled} / ${target}</strong></div><div class="job-budget-track"><span style="width:${Math.min(100, target ? (labelled / target) * 100 : 0).toFixed(1)}%"></span></div><small>Auto-shortlisting ${calibration.active ? "enabled" : "locked"} Â· top-10 precision ${Math.round(Number(calibration.precisionTopTen || 0) * 100)}% Â· false rejection ${Math.round(Number(calibration.falseRejectionRate || 0) * 100)}%</small></section>`;
}

function renderLocalProcessing(local = {}) {
  const tasks = local.tasks || [];
  const workers = local.workers || [];
  const worker = workers[0] || null;
  const queueControl = local.queueControl || {};
  return `<section class="job-panel"><div class="job-panel-head"><div><p class="eyebrow">Local inference</p><h2>Windows worker</h2></div><span>${worker ? escapeHtml(statusLabel(worker.status)) : "Not connected yet"}</span></div>
    <div class="job-runtime-grid">
      ${tasks.length ? tasks.map((task) => `<article class="job-runtime-card"><span>${escapeHtml(statusLabel(task.taskType))} Â· ${escapeHtml(statusLabel(task.status))}</span><strong>${Number(task.count || 0)}</strong></article>`).join("") : `<article class="job-runtime-card"><span>Queue</span><strong>Empty</strong></article>`}
      ${worker ? `<article class="job-runtime-card"><span>Last seen</span><strong>${escapeHtml(formatDate(worker.lastSeenAt))}</strong></article>` : ""}<article class="job-runtime-card"><span>Queue hold</span><strong>${queueControl.holdNewTasks ? "Enabled" : "Disabled"}</strong></article>
    </div>
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
    <div><strong>${escapeHtml(statusLabel(claim.claimType))}</strong><span>${escapeHtml(claim.evidenceType)} Â· ${Math.round(Number(claim.confidence || 0) * 100)}%</span></div>
    <p>${escapeHtml(claim.value)}</p>
    ${claim.supportingPassage ? `<blockquote>${escapeHtml(claim.supportingPassage)}</blockquote>` : ""}
    ${claim.sourceUrl ? `<a class="inline-link" href="${escapeHtml(claim.sourceUrl)}" target="_blank" rel="noreferrer">Source</a>` : ""}
  </div>`).join("")}</div>`;
}

function renderDimensions(dimensions) {
  if (!dimensions) return "";
  return `<div class="job-dimensions">${Object.entries(dimensions).map(([name, value]) => `<div><span>${escapeHtml(statusLabel(name))}</span><strong>${escapeHtml(value.score)}/5</strong><p>${escapeHtml(value.reasoning)}</p></div>`).join("")}</div>`;
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
        <p>${escapeHtml(job.company || "Company not identified")} Â· ${escapeHtml(job.location || "Location not listed")}</p></div>
      <div class="job-result-score"><span>${score === null ? "Pending" : score}</span><small>${escapeHtml(statusLabel(job.status))}</small></div>
    </div>
    ${renderCardFacts(job)}
    <p class="job-reasoning">${escapeHtml(job.summary)}</p>
    <div class="job-pill-row">
      ${(job.greenFlags || []).slice(0, 4).map((flag) => `<span class="job-pill job-pill--good">${escapeHtml(flag)}</span>`).join("")}
      ${(job.redFlags || []).slice(0, 3).map((flag) => `<span class="job-pill job-pill--bad">${escapeHtml(flag)}</span>`).join("")}
      ${(job.unknowns || []).slice(0, 3).map((flag) => `<span class="job-pill">Unknown: ${escapeHtml(flag)}</span>`).join("")}
    </div>
    <div class="job-result-meta"><span>${escapeHtml(job.sourceProvider)}</span><span>${escapeHtml(job.lane)}</span><span>${activeModel ? `AI: ${escapeHtml(activeModel.provider)} Â· ${escapeHtml(activeModel.model)}` : "AI: pending"}</span><span>Agreement: ${escapeHtml(job.modelAgreement)}</span><span>${formatDate(job.postedAt || job.firstSeenAt)}</span></div>
    <div class="job-result-actions">
      ${safeExternalUrl(job.url) ? `<a class="button button-secondary" href="${escapeHtml(safeExternalUrl(job.url))}" target="_blank" rel="noreferrer">Open role</a>` : ""}
      <button type="button" class="verify-inline-button" data-rerun-job="${escapeHtml(job.id)}">Rerun</button>
      ${outreach ? `<button type="button" class="verify-inline-button" data-copy-outreach="${escapeHtml(job.id)}">Copy outreach</button>` : ""}
    </div>
    ${renderFeedbackForm(job)}
    <details class="job-detail"><summary>Evidence and full evaluation</summary>
      ${renderDimensions(job.dimensions)}
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

function renderDiscoveryLeads(leads = []) {
  if (!leads.length) return `<div class="ops-empty"><strong>No raw leads retained yet</strong><p>The next local portal collection will populate this view.</p></div>`;
  return `<section class="job-panel"><div class="job-panel-head"><div><p class="eyebrow">Metadata-first intake</p><h2>Raw discovery leads</h2></div><span>${leads.length} retained</span></div>
    <div class="job-run-list">${leads.map((lead) => {
      const url = safeExternalUrl(lead.url);
      return `<article class="job-run-card"><div><span>${escapeHtml(lead.sourceProvider)}</span><strong>${escapeHtml(statusLabel(lead.status))}</strong></div>
        <h3>${escapeHtml(lead.title)}</h3><p>${escapeHtml(lead.company)}${lead.location ? ` Â· ${escapeHtml(lead.location)}` : ""}</p>
        <p>${escapeHtml(statusLabel(lead.lane))} Â· ${escapeHtml(statusLabel(lead.familyId))} Â· ${formatDate(lead.lastSeenAt)}</p>
        <small>${escapeHtml(lead.reason)}</small>${url ? `<a class="inline-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}</article>`;
    }).join("")}</div></section>`;
}

function renderTaxonomy(taxonomy = {}) {
  const proposed = taxonomy.proposed || [];
  const active = taxonomy.active || [];
  return `<section class="job-panel"><div class="job-panel-head"><div><p class="eyebrow">Title intelligence</p><h2>Pattern proposals</h2></div><span>${proposed.length} awaiting review</span></div>
    <div class="job-taxonomy-list">${proposed.length ? proposed.map((pattern) => `<article><div><strong>${escapeHtml(pattern.expression)}</strong><span>${escapeHtml(pattern.familyLabel)} Â· ${escapeHtml(pattern.matchType)} Â· support ${pattern.supportCount}</span></div><p>${escapeHtml(pattern.metrics?.rationale || "Observed title alias")}</p><div><button class="verify-inline-button" data-taxonomy-action="approve" data-pattern-id="${escapeHtml(pattern.id)}">Approve</button><button class="verify-inline-button" data-taxonomy-action="reject" data-pattern-id="${escapeHtml(pattern.id)}">Reject</button></div></article>`).join("") : `<p class="verify-note">No pending proposals.</p>`}</div>
    <details class="job-active-patterns"><summary>${active.length} active patterns</summary><div>${active.map((pattern) => `<span>${escapeHtml(pattern.familyLabel)}: ${escapeHtml(pattern.expression)}${pattern.version > 1 ? `<button class="verify-inline-button" data-taxonomy-action="rollback" data-pattern-id="${escapeHtml(pattern.id)}">Rollback</button>` : ""}</span>`).join("")}</div></details>
  </section>`;
}

function renderRuns(runs = []) {
  const collectorSummary = (run) => Object.entries(run.providers?.collector?.sources || {})
    .map(([sourceId, state]) => `${sourceId}: ${state.status} (${Number(state.jobCount || 0)} jobs)`)
    .join(" · ");
  return `<section class="job-panel"><div class="job-panel-head"><div><p class="eyebrow">Operations</p><h2>Workflow runs</h2></div></div>
    <div class="job-run-list">${runs.length ? runs.map((run) => `<article class="job-run-card"><div><span>${escapeHtml(run.trigger)}</span><strong>${escapeHtml(statusLabel(run.status))}</strong></div><p>${escapeHtml(statusLabel(run.phase))} · ${formatDate(run.startedAt)}</p><p>${Number(run.stats?.discovered || 0)} discovered · ${Number(run.stats?.triaged || 0)} triaged · ${Number(run.stats?.deepEvaluated || 0)} deep · ${Number(run.stats?.shortlisted || 0)} shortlisted</p>${collectorSummary(run) ? `<small>${escapeHtml(collectorSummary(run))}</small>` : ""}${(run.errors || []).map((error) => `<small>${escapeHtml(error.message)}</small>`).join("")}</article>`).join("") : `<p class="verify-note">No runs yet.</p>`}</div>
  </section>`;
}

const TABS = [
  ["discovery", "Discovery"],
  ["all_candidates", "All candidates"], ["relevant", "Relevant"],
  ["uncertain", "Uncertain"], ["clear_mismatch", "Clear mismatches"],
  ["shortlist", "Shortlist"], ["needs_review", "Deep review"],
  ["passed", "Passed"], ["expired", "Expired"], ["taxonomy", "Title rules"], ["runs", "Runs"],
];

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
      : active === "discovery" ? renderDiscoveryLeads(dashboard.discoveryLeads)
        : renderJobs(dashboard.jobs);
  return `<section class="job-hero"><div><p class="eyebrow">Private command center</p><h1>Job Intelligence</h1>
      <p class="section-intro">Evidence-grounded sourcing for AI product, data strategy, analytics leadership, and fintech roles.</p></div>
    <div class="job-actions"><button type="button" class="button button-primary" data-run-ingest ${state.loading ? "disabled" : ""}>${state.loading ? "Queueing..." : "Run now"}</button>
      <label class="verify-field"><span>Manual job URLs</span><textarea rows="3" data-manual-urls placeholder="One URL per line">${escapeHtml(state.manualUrls)}</textarea></label></div></section>
    ${state.error ? `<p class="auth-error">${escapeHtml(state.error)}</p>` : ""}
    ${state.notice ? `<p class="job-notice">${escapeHtml(state.notice)}</p>` : ""}
    ${renderSummary(dashboard.summary)}${renderBudget(dashboard.usage)}${renderLocalProcessing(dashboard.localProcessing)}${renderRuntime(dashboard.runtime)}
    <nav class="job-filter-tabs" aria-label="Job intelligence views">${TABS.map(([value, label]) => `<button type="button" class="${active === value ? "is-active" : ""}" data-job-view="${value}">${label}</button>`).join("")}</nav>
    ${content}`;
}

export function mountJobSearch(root) {
  if (!root) return;
  const state = { status: null, dashboard: null, loading: false, error: "", notice: "", view: "all_candidates", manualUrls: "" };

  async function loadStatus() { state.status = await request("/api/job-search/status"); }
  async function loadDashboard() {
    const view = ["taxonomy", "runs"].includes(state.view) ? "all_candidates" : state.view;
    state.dashboard = await request(`/api/job-search/jobs?view=${encodeURIComponent(view)}`);
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
      state.notice = `Run ${statusLabel(run.status)} Â· ${statusLabel(run.phase)}`;
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
    root.querySelectorAll("[data-job-view]").forEach((node) => node.addEventListener("click", async () => {
      try { state.view = node.dataset.jobView; state.error = ""; await loadDashboard(); }
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
      try { const queued = await request(`/api/job-search/jobs/${encodeURIComponent(node.dataset.rerunJob)}/rerun`, { method: "POST", body: "{}" }); state.notice = `Rerun queued: ${queued.runId}`; await render(); pollRun(queued.runId); }
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
