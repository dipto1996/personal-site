const MCA_MASTER_DATA_PORTAL_URL = "https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do";
const MCA_FIND_CIN_URL = "https://www.mca.gov.in/mcafoportal/findCIN.do";
const MCA_OGD_CATALOG_URL = "https://www.data.gov.in/catalog/company-master-data";
const MCA_OGD_RESOURCE_URL = "https://www.data.gov.in/resource/registrars-companies-roc-wise-company-master-data";
const MCA_STATUS_VALUES = new Set([
  "active",
  "strike off",
  "under liquidation",
  "amalgamated",
  "dissolved",
  "converted to llp",
  "not available for efiling",
  "inactive",
]);

const FIELD_SPECS = [
  { key: "cin", label: "CIN", aliases: ["Corporate Identification Number", "CIN/FCRN/LLPIN/FLLPIN"] },
  { key: "companyName", label: "Company Name", aliases: ["Name of Company", "Company / LLP Name"] },
  { key: "rocCode", label: "ROC Code" },
  { key: "registrationNumber", label: "Registration Number" },
  { key: "companyCategory", label: "Company Category" },
  { key: "companySubCategory", label: "Company SubCategory" },
  { key: "companyClass", label: "Class of Company" },
  { key: "authorizedCapital", label: "Authorised Capital(Rs)", aliases: ["Authorized Capital(Rs)", "Authorized Capital"] },
  { key: "paidUpCapital", label: "Paid up Capital(Rs)", aliases: ["Paid Up Capital(Rs)", "Paid-up Capital", "Paid up Capital"] },
  {
    key: "memberCount",
    label: "Number of Members(Applicable in case of company without Share Capital)",
    aliases: ["Number of Members (Applicable in case of company without Share Capital)"],
  },
  { key: "incorporationDate", label: "Date of Incorporation" },
  { key: "registeredAddress", label: "Registered Address" },
  {
    key: "booksAddress",
    label: "Address other than R/o where all or any books of account and papers are maintained",
    aliases: ["Address other than R/o where all or any books of account and papers are maintained"],
  },
  { key: "email", label: "Email Id", aliases: ["Email ID"] },
  { key: "listingStatus", label: "Whether Listed or not" },
  { key: "suspensionStatus", label: "Suspended at stock exchange" },
  { key: "lastAgmDate", label: "Date of last AGM" },
  { key: "balanceSheetDate", label: "Date of Balance Sheet" },
  { key: "filingStatus", label: "Company Status(for efiling)", aliases: ["Company Status (for efiling)", "Company Status"] },
];

const CHARGE_HEADERS = ["Assets under charge", "Charge Amount", "Date of Creation", "Date of Modification", "Status"];
const DIRECTOR_HEADERS = ["DIN/PAN", "Name", "Begin date", "End date", "Surrendered DIN"];
const SECTION_HEADERS = ["Charges", "Directors/Signatory Details"];

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeLine(value) {
  return decodeEntities(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function lineKey(value) {
  return normalizeLine(value).toLowerCase();
}

function stripMarkup(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|tr|td|th|li|table|tbody|thead|span|h[1-6])>/gi, "\n")
    .replace(/<(?:script|style)[^>]*>[\s\S]*?<\/(?:script|style)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n");
}

function sanitizeInput(source) {
  const plain = stripMarkup(source);
  return plain
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean);
}

function matchesLabel(line, spec) {
  const normalized = lineKey(line);
  const candidates = [spec.label, ...(spec.aliases || [])];
  return candidates.some((candidate) => normalized === lineKey(candidate) || normalized.startsWith(`${lineKey(candidate)}:`));
}

function extractInlineValue(line, spec) {
  const candidates = [spec.label, ...(spec.aliases || [])];

  for (const candidate of candidates) {
    const prefix = `${candidate}:`;
    if (lineKey(line).startsWith(lineKey(prefix))) {
      return normalizeLine(line.slice(prefix.length));
    }
  }

  return "";
}

function findSectionIndex(lines, label) {
  return lines.findIndex((line) => lineKey(line) === lineKey(label));
}

function nextSignalIndex(lines, startIndex, stopSets) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (stopSets.some((set) => set.has(lineKey(lines[index])))) {
      return index;
    }
  }

  return lines.length;
}

function buildFieldStopSet() {
  return new Set(
    FIELD_SPECS.flatMap((spec) => [spec.label, ...(spec.aliases || [])]).map((value) => lineKey(value)),
  );
}

const FIELD_STOP_SET = buildFieldStopSet();
const SECTION_STOP_SET = new Set(SECTION_HEADERS.map((value) => lineKey(value)));

function parseTableSection(lines, sectionLabel, headers) {
  const sectionIndex = findSectionIndex(lines, sectionLabel);

  if (sectionIndex === -1) {
    return [];
  }

  const stopIndex = nextSignalIndex(lines, sectionIndex + 1, [FIELD_STOP_SET, SECTION_STOP_SET]);
  const sectionLines = lines
    .slice(sectionIndex + 1, stopIndex)
    .filter((line) => !headers.some((header) => lineKey(header) === lineKey(line)));

  const rows = [];
  const width = headers.length;

  for (let index = 0; index + width - 1 < sectionLines.length; index += width) {
    const slice = sectionLines.slice(index, index + width);

    if (slice.length < width) {
      break;
    }

    rows.push(
      headers.reduce((record, header, columnIndex) => {
        record[header] = slice[columnIndex];
        return record;
      }, {}),
    );
  }

  return rows;
}

export function normalizeCin(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function parseMcaCatalogMetrics(html) {
  const updatedMatch = html.match(/Updated On:\s*([0-9/]+)/i) || html.match(/updated_date:"([^"]+)"/i);
  const totalMatch = html.match(/total:([0-9]+)/);
  const fileFormatMatch = html.match(/field_file_format:"([^"]+)"/);
  const fileSizeMatch = html.match(/field_file_size:"([^"]+)"/);

  return {
    updatedLabel: normalizeLine(updatedMatch?.[1] || ""),
    totalRecords: totalMatch ? Number(totalMatch[1]) : null,
    fileFormat: normalizeLine(fileFormatMatch?.[1] || ""),
    fileSize: normalizeLine(fileSizeMatch?.[1] || ""),
  };
}

export function parseMcaFindCinResults(source) {
  const lines = sanitizeInput(source);

  if (!lines.length) {
    throw new Error("Paste the official MCA Find CIN result text or HTML before parsing.");
  }

  const cinRegex = /\b([A-Z][A-Z0-9]{20})\b/g;
  const ignoredLines = new Set([
    "company name",
    "cin",
    "status",
    "llp name",
    "llpin",
    "company/llp name",
    "company status",
  ]);
  const candidates = [];
  const seen = new Set();
  const containsCin = (value) => /\b[A-Z][A-Z0-9]{20}\b/.test(String(value || "").toUpperCase());
  const isCandidateName = (value) => {
    const key = lineKey(value);
    return Boolean(value) && !ignoredLines.has(key) && !containsCin(value) && !MCA_STATUS_VALUES.has(key);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const matches = [...lines[index].toUpperCase().matchAll(cinRegex)];

    for (const match of matches) {
      const cin = normalizeCin(match[1]);

      if (seen.has(cin)) {
        continue;
      }

      const windowLines = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 4));
      const statusLine =
        [lines[index + 1], lines[index + 2], lines[index - 1], lines[index - 2]].find((line) =>
          MCA_STATUS_VALUES.has(lineKey(line)),
        ) || windowLines.find((line) => MCA_STATUS_VALUES.has(lineKey(line)));
      const inlineName = normalizeLine(lines[index].replace(cin, ""));
      const companyName =
        (isCandidateName(inlineName) ? inlineName : "")
        || [lines[index - 1], lines[index + 1], lines[index - 2], lines[index + 2], ...windowLines].find(isCandidateName)
        || "";

      const candidate = { cin, companyName, status: statusLine || "" };

      if (!candidate.companyName) {
        continue;
      }

      seen.add(cin);
      candidates.push(candidate);
    }
  }

  if (!candidates.length) {
    throw new Error("Could not recognize any CIN rows. Copy the official Find CIN results table and try again.");
  }

  return {
    status: "parsed",
    message:
      "Official MCA Find CIN content parsed inside VerifySME. Pick the right CIN, then open the official master-data page and paste that result for full structuring.",
    parsedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidates,
    links: [
      { label: "Official Find CIN", url: MCA_FIND_CIN_URL },
      { label: "Official MCA master data", url: MCA_MASTER_DATA_PORTAL_URL },
    ],
  };
}

export function parseMcaMasterData(source) {
  const lines = sanitizeInput(source);

  if (!lines.length) {
    throw new Error("Paste the official MCA master-data page text or HTML before parsing.");
  }

  const details = [];
  const extracted = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const spec = FIELD_SPECS.find((candidate) => matchesLabel(line, candidate));

    if (!spec) {
      continue;
    }

    let value = extractInlineValue(line, spec);

    if (!value) {
      let cursor = index + 1;
      const values = [];

      while (cursor < lines.length) {
        const nextLine = lines[cursor];
        const nextIsField = FIELD_SPECS.some((candidate) => matchesLabel(nextLine, candidate));
        const nextIsSection = SECTION_STOP_SET.has(lineKey(nextLine));

        if (nextIsField || nextIsSection) {
          break;
        }

        values.push(nextLine);
        cursor += 1;
      }

      value = normalizeLine(values.join(" "));
    }

    if (!value || extracted[spec.key]) {
      continue;
    }

    extracted[spec.key] = value;
    details.push({ label: spec.label, value });
  }

  const charges = parseTableSection(lines, "Charges", CHARGE_HEADERS).map((row) => ({
    assetsUnderCharge: row["Assets under charge"] || "",
    chargeAmount: row["Charge Amount"] || "",
    createdOn: row["Date of Creation"] || "",
    modifiedOn: row["Date of Modification"] || "",
    status: row.Status || "",
  }));

  const directors = parseTableSection(lines, "Directors/Signatory Details", DIRECTOR_HEADERS).map((row) => ({
    dinPan: row["DIN/PAN"] || "",
    name: row.Name || "",
    beginDate: row["Begin date"] || "",
    endDate: row["End date"] || "",
    surrenderedDin: row["Surrendered DIN"] || "",
  }));

  if (!extracted.companyName && !extracted.cin) {
    throw new Error("Could not recognize MCA master-data fields. Copy the official master-data table and try again.");
  }

  const matchedFieldCount = details.length;
  const confidence = matchedFieldCount >= 10 ? "High" : matchedFieldCount >= 6 ? "Medium" : "Low";

  return {
    status: "parsed",
    message:
      "Official MCA content parsed inside VerifySME. This flow keeps the human captcha step in the government portal and structures the result locally.",
    parsedAt: new Date().toISOString(),
    confidence,
    matchedFieldCount,
    cin: normalizeCin(extracted.cin),
    companyName: extracted.companyName || "",
    companyStatus: extracted.filingStatus || "",
    registrationNumber: extracted.registrationNumber || "",
    companyClass: extracted.companyClass || "",
    companyCategory: extracted.companyCategory || "",
    companySubCategory: extracted.companySubCategory || "",
    incorporatedOn: extracted.incorporationDate || "",
    registeredAddress: extracted.registeredAddress || "",
    email: extracted.email || "",
    listingStatus: extracted.listingStatus || "",
    details,
    charges,
    directors,
    links: [
      { label: "Official MCA master data", url: MCA_MASTER_DATA_PORTAL_URL },
      { label: "Official Find CIN", url: MCA_FIND_CIN_URL },
      { label: "Official MCA OGD catalog", url: MCA_OGD_CATALOG_URL },
    ],
  };
}

export {
  MCA_FIND_CIN_URL,
  MCA_MASTER_DATA_PORTAL_URL,
  MCA_OGD_CATALOG_URL,
  MCA_OGD_RESOURCE_URL,
};
