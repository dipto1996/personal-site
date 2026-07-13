const DASHBOARD_STORAGE_KEY = "makhanamart-dashboard-key";

const accessForm = document.querySelector("[data-desk-access-form]");
const accessInput = document.querySelector("[data-desk-access-input]");
const accessMessage = document.querySelector("[data-desk-access-message]");
const refreshButton = document.querySelector("[data-desk-refresh]");
const clearButton = document.querySelector("[data-desk-clear]");
const summarySection = document.querySelector("[data-desk-summary-section]");
const tableSection = document.querySelector("[data-desk-table-section]");
const statusTitle = document.querySelector("[data-desk-status-title]");
const statusCopy = document.querySelector("[data-desk-status-copy]");
const emptyState = document.querySelector("[data-desk-empty]");
const rowsTarget = document.querySelector("[data-desk-rows]");

const summaryTargets = {
  total: document.querySelector("[data-summary-total]"),
  buyers: document.querySelector("[data-summary-buyers]"),
  sellers: document.querySelector("[data-summary-sellers]"),
  lastSubmittedAt: document.querySelector("[data-summary-last]"),
};

const formatDate = (value) => {
  if (!value) {
    return "No leads yet";
  }

  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const setAccessMessage = (message, isError = false) => {
  if (!accessMessage) {
    return;
  }

  accessMessage.textContent = message;
  accessMessage.classList.toggle("is-error", isError);
};

const setStatus = (title, copy) => {
  if (statusTitle) {
    statusTitle.textContent = title;
  }

  if (statusCopy) {
    statusCopy.textContent = copy;
  }
};

const renderSummary = (summary) => {
  if (!summarySection) {
    return;
  }

  summarySection.hidden = false;
  summaryTargets.total.textContent = summary.total ?? 0;
  summaryTargets.buyers.textContent = summary.buyers ?? 0;
  summaryTargets.sellers.textContent = summary.sellers ?? 0;
  summaryTargets.lastSubmittedAt.textContent = formatDate(summary.lastSubmittedAt);
};

const renderLeads = (leads) => {
  if (!tableSection || !rowsTarget || !emptyState) {
    return;
  }

  tableSection.hidden = false;
  rowsTarget.innerHTML = "";

  if (!leads.length) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  leads.forEach((lead) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="lead-type lead-type-${lead.formType}">${lead.formType}</span></td>
      <td>
        <strong>${lead.fullName}</strong>
        <span>${lead.company || "-"}</span>
      </td>
      <td>
        <strong>${lead.grade || "-"}</strong>
        <span>${lead.quantity || "-"}</span>
      </td>
      <td>
        <strong>${lead.destination || "-"}</strong>
        <span>${lead.packaging || "-"}</span>
      </td>
      <td>
        <strong>${lead.phone}</strong>
        <span>${lead.email || "-"}</span>
      </td>
      <td>
        <strong>${formatDate(lead.submittedAt || lead.createdAt)}</strong>
        <span>${lead.requestId}</span>
      </td>
      <td class="lead-notes">${lead.notes || "-"}</td>
    `;
    rowsTarget.appendChild(row);
  });
};

const loadDesk = async (accessKey) => {
  setAccessMessage("");
  setStatus("Loading lead desk…", "Fetching the latest buyer and seller inquiries.");

  try {
    const response = await fetch("/api/makhana-leads?limit=80", {
      headers: {
        "x-dashboard-key": accessKey,
      },
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `Request failed with status ${response.status}`);
    }

    sessionStorage.setItem(DASHBOARD_STORAGE_KEY, accessKey);
    renderSummary(payload.summary || {});
    renderLeads(payload.leads || []);
    setStatus("Lead desk connected.", "Recent inquiries are visible below.");
  } catch (error) {
    summarySection.hidden = true;
    tableSection.hidden = true;
    setAccessMessage(error.message, true);
    setStatus("Lead desk unavailable.", "Check the dashboard key or server configuration.");
  }
};

if (accessForm && accessInput) {
  accessForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const key = accessInput.value.trim();

    if (!key) {
      setAccessMessage("Enter the dashboard key first.", true);
      return;
    }

    loadDesk(key);
  });
}

refreshButton?.addEventListener("click", () => {
  const key = sessionStorage.getItem(DASHBOARD_STORAGE_KEY);

  if (!key) {
    setAccessMessage("Enter the dashboard key first.", true);
    return;
  }

  loadDesk(key);
});

clearButton?.addEventListener("click", () => {
  sessionStorage.removeItem(DASHBOARD_STORAGE_KEY);
  accessInput.value = "";
  summarySection.hidden = true;
  tableSection.hidden = true;
  setAccessMessage("Stored dashboard key cleared.");
  setStatus("Not connected yet.", "Enter the dashboard key to load recent inquiries.");
});

const savedKey = sessionStorage.getItem(DASHBOARD_STORAGE_KEY);

if (savedKey) {
  accessInput.value = savedKey;
  loadDesk(savedKey);
}
