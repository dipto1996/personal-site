import { buildCompanyGraphSnapshot, suiteProfiles } from "../../lib/companygraph.js";
import { formatCrore } from "../../lib/tenderradar.js";

const STORAGE_KEY = "companygraph.profile";

function safeRead(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function renderMetric(label, value, hint) {
  return `
    <article class="suite-stat-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <p>${hint}</p>
    </article>
  `;
}

export function mountCompanyGraph(root) {
  if (!root) {
    return;
  }

  const state = {
    profileId: safeRead(STORAGE_KEY, suiteProfiles[0].id),
  };

  function render() {
    const snapshot = buildCompanyGraphSnapshot(state.profileId);
    const { suite, supplier, verify, tender, export: exportView, nextActions } = snapshot;

    root.innerHTML = `
      <div class="suite-shell">
        <div class="suite-head">
          <div class="section-heading">
            <p class="eyebrow">Live Company Graph</p>
            <h2>One supplier record, three decision surfaces.</h2>
            <p class="section-intro">
              Pick a supplier profile to see how public trust signals, bid qualification,
              and export readiness connect into one operating picture.
            </p>
          </div>
          <div class="suite-profile-list">
            ${suiteProfiles
              .map(
                (item) => `
                  <button type="button" class="suite-profile ${item.id === state.profileId ? "suite-profile--active" : ""}" data-suite-profile="${item.id}">
                    <strong>${item.label}</strong>
                    <span>${item.thesis}</span>
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>

        <div class="suite-stat-grid">
          ${renderMetric("VerifySME", `${verify.composite}`, `${supplier.evidence.length} public evidence points visible`)}
          ${renderMetric("TenderRadar", tender.topTender ? `${tender.topTender.analysis.fitBand} / ${tender.topTender.analysis.totalScore}` : "No tender", `${tender.summary.counts.highFit} high-fit bids in the visible queue`)}
          ${renderMetric("ExportPulse", exportView.topRoute ? `${exportView.topRoute.analysis.readinessBand} / ${exportView.topRoute.analysis.totalScore}` : "No route", `${exportView.summary.readyNow} ready-now routes in the current export slice`)}
        </div>

        <div class="suite-grid">
          <article class="suite-card">
            <p class="suite-label">VerifySME</p>
            <h3>${supplier.name}</h3>
            <p>${supplier.summary}</p>
            <ul class="suite-detail-list">
              <li>Trust score: ${supplier.trustScore}</li>
              <li>Risk band: ${supplier.riskBand}</li>
              <li>Data confidence: ${supplier.dataConfidence}</li>
              <li>Visible evidence: ${supplier.evidence.slice(0, 3).join(", ")}</li>
            </ul>
            <a class="inline-link" href="./solutions.html">Open VerifySME workspace</a>
          </article>

          <article class="suite-card">
            <p class="suite-label">TenderRadar</p>
            <h3>${tender.topTender ? tender.topTender.title : "No tender match visible"}</h3>
            <p>
              ${tender.topTender ? tender.topTender.scopeSummary : "No tender data in the current slice."}
            </p>
            ${
              tender.topTender
                ? `
                  <ul class="suite-detail-list">
                    <li>Buyer: ${tender.topTender.buyer}</li>
                    <li>Fit: ${tender.topTender.analysis.fitBand} (${tender.topTender.analysis.totalScore})</li>
                    <li>Eligibility: ${tender.topTender.analysis.soloBidEligible ? "Visible thresholds cleared" : "Threshold blockers visible"}</li>
                    <li>Estimated value: ${formatCrore(tender.topTender.estimatedValueCrore)}</li>
                  </ul>
                `
                : ""
            }
            <a class="inline-link" href="./dashboards.html">Open TenderRadar dashboard</a>
          </article>

          <article class="suite-card">
            <p class="suite-label">ExportPulse</p>
            <h3>${exportView.topRoute ? `${exportView.topRoute.market} ${exportView.topRoute.channelModel ? `· ${exportView.topRoute.channelModel}` : ""}` : "No route visible"}</h3>
            <p>
              ${exportView.topRoute ? exportView.topRoute.demandSignal : "No export route in the current slice."}
            </p>
            ${
              exportView.topRoute
                ? `
                  <ul class="suite-detail-list">
                    <li>Readiness: ${exportView.topRoute.analysis.readinessBand} (${exportView.topRoute.analysis.totalScore})</li>
                    <li>Market proof: ${exportView.topRoute.analysis.directMatch ? "Visible" : "Not yet visible"}</li>
                    <li>Margin band: ${exportView.topRoute.marginBand}</li>
                    <li>Primary blocker: ${exportView.topRoute.analysis.blockers[0] || "No material blocker visible"}</li>
                  </ul>
                `
                : ""
            }
            <a class="inline-link" href="./solutions.html">Open ExportPulse workspace</a>
          </article>
        </div>

        <div class="suite-action-band">
          <div>
            <p class="suite-label">Operator next actions</p>
            <h3>What the team should do next for ${suite.label}</h3>
          </div>
          <ul class="suite-action-list">
            ${nextActions.map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </div>
      </div>
    `;

    root.querySelectorAll("[data-suite-profile]").forEach((button) => {
      button.addEventListener("click", () => {
        state.profileId = button.dataset.suiteProfile;
        safeWrite(STORAGE_KEY, state.profileId);
        render();
      });
    });
  }

  render();
}
