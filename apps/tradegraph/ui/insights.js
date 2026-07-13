function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatValue(value) {
  if (typeof value === "number") {
    return value.toLocaleString("en-US");
  }

  return String(value ?? "—");
}

function getField(item, candidates = [], fallback = "") {
  for (const key of candidates) {
    const value = item?.[key];

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return fallback;
}

function unwrapChart(chart) {
  if (Array.isArray(chart)) {
    return chart;
  }

  if (chart && Array.isArray(chart.data)) {
    return chart.data;
  }

  return [];
}

function maxValue(items, key = "value") {
  return Math.max(...items.map((item) => Number(item?.[key] || 0)), 1);
}

function renderHighlightCards(items = []) {
  if (!items.length) {
    return "";
  }

  return `
    <div class="tradegraph-insight-highlight-grid">
      ${items
        .map(
          (item) => `
            <article class="tradegraph-insight-highlight">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(formatValue(item.value))}</strong>
              <p>${escapeHtml(item.detail || "")}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderBarList(items = [], modifier = "") {
  if (!items.length) {
    return '<p class="tradegraph-insight-empty">No source-backed values available in the current slice.</p>';
  }

  const highest = maxValue(items);

  return `
    <div class="tradegraph-insight-bars">
      ${items
        .map(
          (item) => `
            <div class="tradegraph-insight-bar-row">
              <div class="tradegraph-insight-bar-head">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(formatValue(item.value))}</strong>
              </div>
              <div class="tradegraph-insight-bar-track">
                <span class="tradegraph-insight-bar-fill ${modifier}" style="width:${Math.max((Number(item.value || 0) / highest) * 100, Number(item.value || 0) ? 14 : 0)}%"></span>
              </div>
              ${item.detail ? `<p class="tradegraph-insight-caption">${escapeHtml(item.detail)}</p>` : ""}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderHeatmap(matrix = {}) {
  const columns = Array.isArray(matrix.columns) ? matrix.columns : [];
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];

  if (!columns.length || !rows.length) {
    return '<p class="tradegraph-insight-empty">Not enough structured records to render a heatmap yet.</p>';
  }

  return `
    <div class="tradegraph-insight-heatmap">
      <div class="tradegraph-insight-heatmap-head">
        <span></span>
        ${columns.map((column) => `<span>${escapeHtml(column)}</span>`).join("")}
      </div>
      ${rows
        .map(
          (row) => `
            <div class="tradegraph-insight-heatmap-row">
              <span class="tradegraph-insight-heatmap-label">${escapeHtml(row.label)}</span>
              ${(row.cells || [])
                .map((cell) => {
                  const intensity = Math.max(0, Math.min(100, Number(cell.intensity || 0)));
                  return `
                    <span
                      class="tradegraph-insight-heatmap-cell"
                      title="${escapeHtml(`${row.label} · ${cell.label || ""} · ${cell.value || ""}`)}"
                      style="--heat:${intensity}%;"
                    >
                      ${escapeHtml(formatValue(cell.value))}
                    </span>
                  `;
                })
                .join("")}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderTimeline(items = []) {
  if (!items.length) {
    return '<p class="tradegraph-insight-empty">No historical points available yet.</p>';
  }

  const normalized = items.map((item, index) => ({
    ...item,
    timelineValue:
      typeof item.value === "number"
        ? item.value
        : typeof item.metric === "number"
          ? item.metric
          : Math.max(items.length - index, 1),
  }));
  const highest = maxValue(normalized, "timelineValue");

  return `
    <div class="tradegraph-insight-timeline">
      ${normalized
        .map(
          (item) => `
            <div class="tradegraph-insight-timeline-row">
              <div class="tradegraph-insight-timeline-meta">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(formatValue(item.valueText ?? item.value ?? item.metric ?? "—"))}</strong>
              </div>
              <div class="tradegraph-insight-timeline-track">
                <span style="width:${Math.max((Number(item.timelineValue || 0) / highest) * 100, Number(item.timelineValue || 0) ? 12 : 0)}%"></span>
              </div>
              ${item.detail ? `<p class="tradegraph-insight-caption">${escapeHtml(item.detail)}</p>` : ""}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderScatter(items = []) {
  if (!items.length) {
    return '<p class="tradegraph-insight-empty">No scored points available in the current view.</p>';
  }

  const maxX = Math.max(...items.map((item) => Number(item.x || 0)), 1);
  const maxY = Math.max(...items.map((item) => Number(item.y || 0)), 1);

  return `
    <div class="tradegraph-insight-scatter">
      ${items
        .map((item) => {
          const left = (Number(item.x || 0) / maxX) * 100;
          const bottom = (Number(item.y || 0) / maxY) * 100;
          return `
            <button
              type="button"
              class="tradegraph-insight-point"
              style="left:${left}%; bottom:${bottom}%;"
              title="${escapeHtml(`${item.label}: ${item.xLabel || item.x}, ${item.yLabel || item.y}`)}"
            >
              <span>${escapeHtml(item.shortLabel || item.label?.slice(0, 2) || "•")}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderProvenance(items = []) {
  const normalized = Array.isArray(items)
    ? items
    : items && typeof items === "object"
      ? [
          {
            source: "Data mode",
            label: items.dataMode || "unknown",
            detail: items.latestMetricAt ? `Latest metric ${items.latestMetricAt}` : "No daily metric snapshot yet.",
          },
          {
            source: "Source history",
            label: formatValue(items.sourceHistoryCount ?? 0),
            detail: `${formatValue(items.metricCount ?? 0)} metric snapshots persisted`,
          },
          ...(Array.isArray(items.sourceSummary)
            ? items.sourceSummary.slice(0, 4).map((source) => ({
                source: source.label || source.key || "Source",
                label: source.status || "unknown",
                detail: `${formatValue(source.itemCount ?? 0)} records · ${source.note || "No additional note"}`,
              }))
            : []),
        ]
      : [];

  if (!normalized.length) {
    return "";
  }

  return `
    <div class="tradegraph-insight-provenance">
      ${normalized
        .map(
          (item) => `
            <article class="tradegraph-insight-provenance-card">
              <span>${escapeHtml(item.source || "Source")}</span>
              <strong>${escapeHtml(item.label || item.status || "Available")}</strong>
              <p>${escapeHtml(item.detail || "")}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSummary(summary = {}) {
  if (!summary || typeof summary !== "object" || !Object.keys(summary).length) {
    return "";
  }

  const parts = [
    summary.subject,
    summary.dataModeLabel,
    summary.freshness ? `Freshness: ${summary.freshness}` : "",
    summary.confidence ? `Confidence: ${summary.confidence}` : "",
  ].filter(Boolean);

  return `
    <article class="tradegraph-insight-highlight">
      <span>Decision summary</span>
      <strong>${escapeHtml(summary.decision || summary.subject || "Current insight slice")}</strong>
      <p>${escapeHtml(parts.join(" · "))}</p>
    </article>
  `;
}

function renderExplainability(payload = {}) {
  const factors = Array.isArray(payload?.factors) ? payload.factors : [];

  if (!factors.length) {
    return "";
  }

  const rows = factors.map((factor) => ({
    label: factor.label,
    value: Math.abs(Number(factor.contribution || 0)),
    detail: `${factor.value || "—"} · ${factor.detail || ""}`,
  }));

  return renderInsightCard(
    payload.headline || "Explainability",
    "Factor contributions",
    renderBarList(rows, "tradegraph-insight-bar-fill--confidence"),
  );
}

function renderNextActions(actions = []) {
  const items = Array.isArray(actions) ? actions : [];

  if (!items.length) {
    return "";
  }

  return renderInsightCard(
    "Recommended next actions",
    "Operator follow-through",
    `
      <div class="tradegraph-insight-action-list">
        ${items
          .map(
            (action) => `
              <div class="tradegraph-insight-action-item">
                <strong>${escapeHtml(action.label || "Next action")}</strong>
                <p>${escapeHtml(action.detail || "")}</p>
              </div>
            `,
          )
          .join("")}
      </div>
    `,
  );
}

function renderSummaryHighlights(payload = {}) {
  const highlightCards = (payload.highlights || [])
    .map(
      (item) => `
        <article class="tradegraph-insight-highlight">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(formatValue(item.value))}</strong>
          <p>${escapeHtml(item.detail || "")}</p>
        </article>
      `,
    )
    .join("");
  const summaryCard = renderSummary(payload.summary);

  if (!summaryCard && !highlightCards) {
    return "";
  }

  return `
    <div class="tradegraph-insight-highlight-grid">
      ${summaryCard}
      ${highlightCards}
    </div>
  `;
}

function renderInsightCard(title, subtitle, body) {
  return `
    <article class="tradegraph-insight-card">
      <div class="tradegraph-insight-card-head">
        <div>
          <span>${escapeHtml(subtitle)}</span>
          <h3>${escapeHtml(title)}</h3>
        </div>
      </div>
      ${body}
    </article>
  `;
}

function renderCardGrid(cards = []) {
  return `<div class="tradegraph-insight-grid">${cards.filter(Boolean).join("")}</div>`;
}

function mapStatusIntensity(status) {
  if (status === "live") {
    return 100;
  }

  if (status === "restricted") {
    return 65;
  }

  if (status === "error") {
    return 25;
  }

  return 15;
}

function mapReadinessIntensity(value) {
  if (value === "Ready now") {
    return 100;
  }

  if (value === "Needs 1-2 fixes") {
    return 68;
  }

  return 30;
}

function mapMarginIntensity(value) {
  if (value === "High") {
    return 92;
  }

  if (value === "Medium") {
    return 62;
  }

  return 32;
}

function toBarItems(chart, options = {}) {
  const data = unwrapChart(chart);
  const labelKeys = options.labelKeys || ["label", "stage", "bucket", "sector", "state"];
  const valueKeys = options.valueKeys || ["value", "count", "average", "score"];

  return data.map((item) => ({
    label: getField(item, labelKeys, "Unknown"),
    value: Number(getField(item, valueKeys, 0)) || 0,
    detail: typeof options.detail === "function" ? options.detail(item) : options.detail || "",
  }));
}

function toTimelineItems(chart, options = {}) {
  const data = unwrapChart(chart);
  const labelKeys = options.labelKeys || ["label", "day", "bucket", "noticeDate"];
  const valueKeys = options.valueKeys || ["value", "count", "metric"];

  return data.map((item, index) => ({
    label: getField(item, labelKeys, `Point ${index + 1}`),
    value: Number(getField(item, valueKeys, Number.NaN)),
    valueText: options.valueText ? options.valueText(item, index) : formatValue(getField(item, valueKeys, "—")),
    detail: typeof options.detail === "function" ? options.detail(item, index) : options.detail || "",
    metric: Number(getField(item, valueKeys, index + 1)) || index + 1,
  }));
}

function toVerifyHeatmap(chart) {
  const data = unwrapChart(chart);
  const highestItemCount = Math.max(...data.map((item) => Number(item.itemCount || 0)), 1);

  return {
    columns: ["Status", "Age", "Records"],
    rows: data.map((item) => ({
      label: item.label || item.sourceKey || "Source",
      cells: [
        {
          label: "Status",
          value: item.status || "unknown",
          intensity: mapStatusIntensity(item.status),
        },
        {
          label: "Age",
          value: item.ageDays === null || item.ageDays === undefined ? "—" : `${item.ageDays}d`,
          intensity:
            item.ageDays === null || item.ageDays === undefined
              ? 20
              : Math.max(10, 100 - Math.min(Number(item.ageDays || 0) * 10, 100)),
        },
        {
          label: "Records",
          value: formatValue(item.itemCount || 0),
          intensity: Math.max((Number(item.itemCount || 0) / highestItemCount) * 100, item.itemCount ? 18 : 0),
        },
      ],
    })),
  };
}

function toExportReadinessMatrix(chart) {
  const data = unwrapChart(chart);

  return {
    columns: ["Readiness", "Score", "Margin", "Channel"],
    rows: data.map((item) => ({
      label: item.market || item.id || "Route",
      cells: [
        {
          label: "Readiness",
          value: item.readinessBand || "Unknown",
          intensity: mapReadinessIntensity(item.readinessBand),
        },
        {
          label: "Score",
          value: formatValue(item.score || 0),
          intensity: Math.max(Math.min(Number(item.score || 0), 100), item.score ? 18 : 0),
        },
        {
          label: "Margin",
          value: item.marginBand || "Unknown",
          intensity: mapMarginIntensity(item.marginBand),
        },
        {
          label: "Channel",
          value: item.channelModel || "N/A",
          intensity: 48,
        },
      ],
    })),
  };
}

function toTenderScatter(chart) {
  return unwrapChart(chart).map((item) => ({
    label: item.title || item.id || "Bid",
    shortLabel: getField(item, ["fitBand"], "B").slice(0, 1),
    x: Number(item.valueCrore || 0),
    y: Number(item.turnoverCrore || 0),
    xLabel: `₹${formatValue(item.valueCrore || 0)} Cr`,
    yLabel: `₹${formatValue(item.turnoverCrore || 0)} Cr capacity`,
  }));
}

function toExportScatter(chart) {
  const marginScore = { High: 90, Medium: 60, Low: 30 };

  return unwrapChart(chart).map((item) => ({
    label: item.market || item.id || "Route",
    shortLabel: String(item.market || "RT").slice(0, 2).toUpperCase(),
    x: marginScore[item.marginBand] || 20,
    y: Number(item.score || 0),
    xLabel: item.marginBand || "Unknown margin",
    yLabel: `${formatValue(item.score || 0)}/100 readiness`,
  }));
}

export function renderVerifyInsights(payload = {}) {
  const charts = payload.charts || {};
  const cards = [
    renderInsightCard(
      "Supplier trust funnel",
      "Qualification funnel",
      renderBarList(
        toBarItems(charts.trustFunnel, { labelKeys: ["stage"], valueKeys: ["value"] }),
        "tradegraph-insight-bar-fill--trust",
      ),
    ),
    renderInsightCard(
      "Evidence freshness by source",
      "Freshness heatmap",
      renderHeatmap(toVerifyHeatmap(charts.evidenceFreshness)),
    ),
    renderInsightCard(
      "Risk composition by sector",
      "Risk concentration",
      renderBarList(
        toBarItems(charts.riskBySector, {
          labelKeys: ["sector", "label"],
          valueKeys: ["average", "value"],
          detail: (item) => `${formatValue(item.count || 0)} suppliers`,
        }),
        "tradegraph-insight-bar-fill--risk",
      ),
    ),
    renderInsightCard(
      "Diligence queue aging",
      "Queue pressure",
      renderTimeline(
        toTimelineItems(charts.queueAging, {
          labelKeys: ["day", "bucket", "label"],
          valueKeys: ["value", "count"],
          detail: (item) => item.detail || "",
        }),
      ),
    ),
    renderInsightCard(
      "Entity confidence board",
      "Identity quality",
      renderBarList(
        toBarItems(charts.entityConfidence, { labelKeys: ["label"], valueKeys: ["value"] }),
        "tradegraph-insight-bar-fill--confidence",
      ),
    ),
    renderExplainability(payload.explainability),
    renderNextActions(payload.nextActions),
  ];

  return `
    <section class="tradegraph-insight-section">
      ${renderSummaryHighlights(payload)}
      ${renderCardGrid(cards)}
      ${renderProvenance(payload.provenance || [])}
    </section>
  `;
}

export function renderTenderInsights(payload = {}) {
  const charts = payload.charts || {};
  const cards = [
    renderInsightCard(
      "Bid qualification funnel",
      "Decision flow",
      renderBarList(
        toBarItems(charts.qualificationFunnel, { labelKeys: ["stage"], valueKeys: ["value"] }),
        "tradegraph-insight-bar-fill--tender",
      ),
    ),
    renderInsightCard(
      "Closing urgency",
      "Deadline pressure",
      renderTimeline(
        toTimelineItems(charts.closingBuckets || charts.closingCalendar, {
          labelKeys: ["day", "bucket", "label"],
          valueKeys: ["value", "count"],
          detail: (item) => item.detail || "",
        }),
      ),
    ),
    renderInsightCard(
      "Eligibility gap distribution",
      "Most common blockers",
      renderBarList(
        toBarItems(charts.eligibilityGaps, { labelKeys: ["label"], valueKeys: ["value"] }),
        "tradegraph-insight-bar-fill--risk",
      ),
    ),
    renderInsightCard(
      "Ticket size vs capacity",
      "Value pressure",
      renderScatter(toTenderScatter(charts.valueVsCapacity)),
    ),
    renderInsightCard(
      "Buyer concentration",
      "Exposure mix",
      renderBarList(
        toBarItems(charts.buyerConcentration, { labelKeys: ["label"], valueKeys: ["value"] }),
        "tradegraph-insight-bar-fill--buyer",
      ),
    ),
    renderInsightCard(
      "Source reliability",
      "Parser and freshness",
      renderBarList(
        toBarItems(charts.sourceReliability, { labelKeys: ["label"], valueKeys: ["value"] }),
        "tradegraph-insight-bar-fill--confidence",
      ),
    ),
    renderExplainability(payload.explainability),
    renderNextActions(payload.nextActions),
  ];

  return `
    <section class="tradegraph-insight-section">
      ${renderSummaryHighlights(payload)}
      ${renderCardGrid(cards)}
      ${renderProvenance(payload.provenance || [])}
    </section>
  `;
}

export function renderExportInsights(payload = {}) {
  const charts = payload.charts || {};
  const cards = [
    renderInsightCard(
      "Route readiness matrix",
      "Market x readiness",
      renderHeatmap(toExportReadinessMatrix(charts.readinessMatrix)),
    ),
    renderInsightCard(
      "Blocker waterfall",
      "Readiness blockers",
      renderBarList(
        toBarItems(charts.blockerMix, { labelKeys: ["label"], valueKeys: ["value"] }),
        "tradegraph-insight-bar-fill--risk",
      ),
    ),
    renderInsightCard(
      "Notice impact timeline",
      "Trade-policy signals",
      renderTimeline(
        toTimelineItems(charts.noticeTimeline, {
          labelKeys: ["noticeDate", "label"],
          valueKeys: ["value"],
          valueText: (item) => item.impactTag || "Trade notice",
          detail: (item) => item.title || "",
        }),
      ),
    ),
    renderInsightCard(
      "Margin-risk frontier",
      "Route prioritization",
      renderScatter(toExportScatter(charts.marginRiskFrontier)),
    ),
    renderInsightCard(
      "30-day action burnup",
      "Execution progress",
      renderTimeline(
        toTimelineItems(charts.actionBurnup, {
          labelKeys: ["day", "label"],
          valueKeys: ["value"],
          detail: (item) => item.detail || "",
        }),
      ),
    ),
    renderExplainability(payload.explainability),
    renderNextActions(payload.nextActions),
  ];

  return `
    <section class="tradegraph-insight-section">
      ${renderSummaryHighlights(payload)}
      ${renderCardGrid(cards)}
      ${renderProvenance(payload.provenance || [])}
    </section>
  `;
}
