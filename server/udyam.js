import crypto from "node:crypto";
import https from "node:https";

const BASE_URL = "https://udyamregistration.gov.in";
const HOME_PATH = "/";
const VERIFY_PATH = "/Udyam_Verify.aspx";
const VERIFY_URL = `${BASE_URL}${VERIFY_PATH}`;
const PRINT_PATH = "/PrintUdyamApplication.aspx";
const PRINT_URL = `${BASE_URL}${PRINT_PATH}`;
const QR_VERIFY_PATH = "/verifyudyambarcode.aspx";
const QR_VERIFY_URL = `${BASE_URL}${QR_VERIFY_PATH}`;
const CAPTCHA_PATH = "/CaptchaControl.aspx";
const CHALLENGE_TTL_MS = 1000 * 60 * 10;
const MAX_ACTIVE_CHALLENGES = 32;
const SUMMARY_FIELDS = [
  ["Udyam Registration Number", "ctl00_ContentPlaceHolder1_lbludyamregNo"],
  ["Name of Enterprise", "ctl00_ContentPlaceHolder1_lblEnterpriseName"],
  ["Organisation Type", "ctl00_ContentPlaceHolder1_lblOrganisationType"],
  ["Major Activity", "ctl00_ContentPlaceHolder1_lblServices"],
  ["Gender", "ctl00_ContentPlaceHolder1_lblGender"],
  ["Social Category", "ctl00_ContentPlaceHolder1_lblsocialcat"],
  ["Date of Incorporation", "ctl00_ContentPlaceHolder1_lbldateofincorporation"],
  ["Date of Commencement", "ctl00_ContentPlaceHolder1_lbldateofcommencement"],
  ["Official State", "ctl00_ContentPlaceHolder1_lblState"],
  ["Official District", "ctl00_ContentPlaceHolder1_lblDistrict"],
  ["Official City", "ctl00_ContentPlaceHolder1_lblCity"],
  ["Official Pin", "ctl00_ContentPlaceHolder1_lblPin"],
  ["Official Mobile", "ctl00_ContentPlaceHolder1_lblMobile"],
  ["Official Email", "ctl00_ContentPlaceHolder1_lblEmail"],
  ["DIC", "ctl00_ContentPlaceHolder1_lblgmdic"],
  ["MSME-DFO", "ctl00_ContentPlaceHolder1_lblMSMEDI"],
  ["Date of Udyam Registration", "ctl00_ContentPlaceHolder1_lblACKNOWLEDGEMENT"],
];
const IMPORT_FIELD_SPECS = [
  { key: "registrationNumber", label: "Udyam Registration Number", aliases: ["UDYAM REGISTRATION NUMBER", "Udyam Registration No."] },
  { key: "enterpriseName", label: "Name of Enterprise", aliases: ["NAME OF ENTERPRISE"] },
  { key: "organisationType", label: "Organisation Type", aliases: ["ORGANISATION TYPE"] },
  { key: "majorActivity", label: "Major Activity", aliases: ["MAJOR ACTIVITY"] },
  { key: "socialCategory", label: "Social Category", aliases: ["SOCIAL CATEGORY OF ENTREPRENEUR", "Social Category of Entrepreneur"] },
  { key: "gender", label: "Gender", aliases: ["GENDER OF ENTREPRENEUR", "Gender of Entrepreneur"] },
  { key: "dateOfIncorporation", label: "Date of Incorporation", aliases: ["DATE OF INCORPORATION / REGISTRATION OF ENTERPRISE"] },
  { key: "dateOfCommencement", label: "Date of Commencement", aliases: ["DATE OF COMMENCEMENT OF PRODUCTION/BUSINESS"] },
  { key: "officialAddress", label: "Official Address of Enterprise", aliases: ["OFFICAL ADDRESS OF ENTERPRISE", "Official Address of Enterprise"] },
  { key: "officialMobile", label: "Official Mobile", aliases: ["MOBILE", "Mobile"] },
  { key: "officialEmail", label: "Official Email", aliases: ["EMAIL", "Email"] },
  { key: "dateOfRegistration", label: "Date of Udyam Registration", aliases: ["DATE OF UDYAM REGISTRATION"] },
  { key: "enterpriseType", label: "Enterprise Type", aliases: ["TYPE OF ENTERPRISE", "Latest Enterprise Type"] },
  { key: "classificationDate", label: "Classification Date", aliases: ["CLASSIFICATION DATE", "Latest Classification Date"] },
];
const activeChallenges = new Map();

const defaultHeaders = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "upgrade-insecure-requests": "1",
  referer: `${BASE_URL}/`,
};

export function normalizeUdyamNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function isValidUdyamNumber(value) {
  return /^[A-Z]{5}-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/.test(normalizeUdyamNumber(value));
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTitle(html) {
  const match = html.match(/<title>\s*([^<]+)\s*<\/title>/i);
  return decodeHtml(match?.[1] || "");
}

function stripMarkup(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|tr|td|th|li|table|tbody|thead|span|h[1-6]|b|strong)>/gi, "\n")
    .replace(/<(?:script|style)[^>]*>[\s\S]*?<\/(?:script|style)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n");
}

function sanitizeImportedContent(source) {
  return stripMarkup(source)
    .split("\n")
    .map(decodeHtml)
    .map((line) => line.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

function lineKey(value) {
  return decodeHtml(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function matchesImportLabel(line, spec) {
  const normalized = lineKey(line);
  const candidates = [spec.label, ...(spec.aliases || [])];
  return candidates.some((candidate) => normalized === lineKey(candidate) || normalized.startsWith(`${lineKey(candidate)}:`));
}

function extractInlineImportValue(line, spec) {
  const candidates = [spec.label, ...(spec.aliases || [])];

  for (const candidate of candidates) {
    const prefix = `${candidate}:`;
    if (lineKey(line).startsWith(lineKey(prefix))) {
      return decodeHtml(line.slice(prefix.length)).replace(/\s+/g, " ").trim();
    }
  }

  return "";
}

function extractQrVerificationToken(source) {
  const match = String(source || "").match(/verifyudrn=([^&"'\s>]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function extractMaintenanceNotice(html) {
  const match = html.match(/Udyam Registration Portal is under maintenance[\s\S]*?Inconvenience is regretted\./i);
  return decodeHtml(match?.[0] || "");
}

function parseCookieJar(setCookieHeader) {
  const jar = {};
  const values = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];

  for (const cookie of values) {
    const [pair] = String(cookie).split(";");
    const separator = pair.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    jar[name] = value;
  }

  return jar;
}

function mergeCookies(...parts) {
  return Object.assign({}, ...parts);
}

function cookieHeader(cookies) {
  return Object.entries(cookies || {})
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function requestUdyamOnce(
  path,
  { method = "GET", headers = {}, body, cookies = {}, rejectUnauthorized = true } = {},
) {
  return new Promise((resolve, reject) => {
    const requestHeaders = {
      ...defaultHeaders,
      ...headers,
    };

    if (cookies && Object.keys(cookies).length) {
      requestHeaders.cookie = cookieHeader(cookies);
    }

    if (body) {
      requestHeaders["content-length"] = Buffer.byteLength(body);
    }

    const request = https.request(
      {
        hostname: "udyamregistration.gov.in",
        path,
        method,
        headers: requestHeaders,
        rejectUnauthorized,
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            statusCode: response.statusCode || 0,
            headers: response.headers,
            buffer,
            text: buffer.toString("utf8"),
            cookies: parseCookieJar(response.headers["set-cookie"]),
          });
        });
      },
    );

    request.on("error", reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

async function requestUdyam(path, options = {}) {
  try {
    return await requestUdyamOnce(path, options);
  } catch (error) {
    if (
      error?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      error?.code === "SELF_SIGNED_CERT_IN_CHAIN" ||
      error?.code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"
    ) {
      return requestUdyamOnce(path, {
        ...options,
        rejectUnauthorized: false,
      });
    }

    throw error;
  }
}

async function fetchHomePage() {
  const response = await requestUdyam(HOME_PATH);
  return {
    statusCode: response.statusCode,
    html: response.text,
    title: parseTitle(response.text),
    cookies: response.cookies,
  };
}

function extractHiddenFields(html) {
  const fields = {
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: "",
    __VIEWSTATEGENERATOR: "",
    __VIEWSTATEENCRYPTED: "",
    "ctl00$ContentPlaceHolder1$hdnSetPassword": "",
  };

  for (const key of Object.keys(fields)) {
    const escaped = key.replace(/\$/g, "\\$");
    const match = html.match(new RegExp(`name="${escaped}"[^>]*value="([^"]*)"`, "i"));
    fields[key] = decodeHtml(match?.[1] || "");
  }

  return fields;
}

function extractFieldById(html, id) {
  const escaped = id.replace(/\$/g, "\\$");
  const match = html.match(new RegExp(`id="${escaped}"[^>]*>([\\s\\S]*?)<\\/span>`, "i"));
  return decodeHtml(match?.[1] || "");
}

function extractErrors(html) {
  const ids = [
    "ctl00_ContentPlaceHolder1_lblCaptcha",
    "ctl00_ContentPlaceHolder1_lblMessage",
    "ctl00_ContentPlaceHolder1_Label1",
  ];

  return ids.map((id) => extractFieldById(html, id)).filter(Boolean);
}

function extractPrintDetails(html) {
  if (!/id="divPrint"/i.test(html)) {
    return [];
  }

  const details = [];

  for (const [label, id] of SUMMARY_FIELDS) {
    const value = extractFieldById(html, id);
    if (value) {
      details.push({ label, value });
    }
  }

  const plantTableMatch = html.match(/id="ctl00_ContentPlaceHolder1_gvPlant"[\s\S]*?<\/table>/i);
  if (plantTableMatch) {
    const rowCount = Math.max((plantTableMatch[0].match(/<tr/gi) || []).length - 1, 0);
    details.push({ label: "Plant Locations", value: String(rowCount) });
  }

  const enterpriseSectionMatch = html.match(/<b>Enterprise Type<\/b><hr \/>[\s\S]*?<table[\s\S]*?<\/table>/i);
  if (enterpriseSectionMatch) {
    const firstDataRowMatch = enterpriseSectionMatch[0].match(/<tr[^>]*>\s*<td[\s\S]*?<\/tr>/i);
    if (firstDataRowMatch) {
      const cells = [...firstDataRowMatch[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
        decodeHtml(match[1].replace(/<[^>]+>/g, " ")),
      );

      if (cells.length >= 5) {
        details.push({ label: "Latest Classification Year", value: cells[2] });
        details.push({ label: "Latest Enterprise Type", value: cells[3] });
        details.push({ label: "Latest Classification Date", value: cells[4] });
      }
    }
  }

  return details;
}

function extractResultLinks(html, finalUrl) {
  if (/PrintUdyamApplication\.aspx/i.test(finalUrl || "")) {
    return [
      {
        label: "Official print page",
        url: finalUrl.startsWith("http") ? finalUrl : `${BASE_URL}${finalUrl}`,
      },
    ];
  }

  return [];
}

function cleanupExpiredChallenges() {
  const now = Date.now();

  for (const [token, challenge] of activeChallenges.entries()) {
    if (now - challenge.createdAt > CHALLENGE_TTL_MS) {
      activeChallenges.delete(token);
    }
  }

  if (activeChallenges.size <= MAX_ACTIVE_CHALLENGES) {
    return;
  }

  const overflow = [...activeChallenges.entries()]
    .sort((left, right) => left[1].createdAt - right[1].createdAt)
    .slice(0, activeChallenges.size - MAX_ACTIVE_CHALLENGES);

  for (const [token] of overflow) {
    activeChallenges.delete(token);
  }
}

async function fetchVerifyPage() {
  const response = await requestUdyam(VERIFY_PATH);
  const title = parseTitle(response.text);

  if (response.statusCode !== 200 || !/Udyam Verify/i.test(title)) {
    throw new Error("Udyam verify page returned a non-verification response.");
  }

  return {
    html: response.text,
    title,
    cookies: response.cookies,
  };
}

async function fetchCaptcha(cookies) {
  const response = await requestUdyam(CAPTCHA_PATH, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      referer: VERIFY_URL,
    },
    cookies,
  });

  if (response.statusCode !== 200 || !String(response.headers["content-type"] || "").includes("image/")) {
    throw new Error("Udyam captcha could not be loaded.");
  }

  return {
    mimeType: String(response.headers["content-type"]).split(";")[0] || "image/png",
    bytes: response.buffer,
    cookies: response.cookies,
  };
}

function buildChallengeResponse(token, captcha) {
  return {
    token,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    captchaMimeType: captcha.mimeType,
    captchaByteLength: captcha.bytes.length,
    captchaDataUrl: `data:${captcha.mimeType};base64,${captcha.bytes.toString("base64")}`,
    fieldHint: "Use the official Udyam registration number format: UDYAM-XX-00-0000000",
  };
}

export async function probeUdyamService() {
  try {
    const page = await fetchVerifyPage();

    return {
      status: "live",
      title: page.title,
      formAction: "./Udyam_Verify.aspx",
      captchaPath: "CaptchaControl.aspx",
      fieldNames: {
        registrationNumber: "ctl00$ContentPlaceHolder1$txtUdyamNo",
        captcha: "ctl00$ContentPlaceHolder1$txtCaptcha",
        submit: "ctl00$ContentPlaceHolder1$btnVerify",
      },
    };
  } catch (error) {
    const home = await fetchHomePage().catch(() => null);
    const maintenanceNotice = home ? extractMaintenanceNotice(home.html) : "";

    if (maintenanceNotice) {
      return {
        status: "maintenance",
        title: "Udyam registration portal maintenance",
        note: maintenanceNotice,
      };
    }

    throw error;
  }
}

export async function createUdyamChallenge() {
  cleanupExpiredChallenges();

  const page = await fetchVerifyPage().catch(async (error) => {
    const home = await fetchHomePage().catch(() => null);
    const maintenanceNotice = home ? extractMaintenanceNotice(home.html) : "";

    if (maintenanceNotice) {
      const maintenanceError = new Error(
        `${maintenanceNotice} Use the official certificate import below if you already have a copied Udyam certificate or QR verification page.`,
      );
      maintenanceError.statusCode = 503;
      throw maintenanceError;
    }

    throw error;
  });
  const captcha = await fetchCaptcha(page.cookies);
  const token = `udyam_${crypto.randomBytes(18).toString("base64url")}`;

  activeChallenges.set(token, {
    createdAt: Date.now(),
    cookies: mergeCookies(page.cookies, captcha.cookies),
    hiddenFields: extractHiddenFields(page.html),
  });

  return buildChallengeResponse(token, captcha);
}

export function parseUdyamImportedRecord(source) {
  const lines = sanitizeImportedContent(source);

  if (!lines.length) {
    throw new Error("Paste the official Udyam certificate or QR verification text/HTML before parsing.");
  }

  const details = [];
  const extracted = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const spec = IMPORT_FIELD_SPECS.find((candidate) => matchesImportLabel(line, candidate));

    if (!spec) {
      continue;
    }

    let value = extractInlineImportValue(line, spec);

    if (!value) {
      let cursor = index + 1;
      const values = [];

      while (cursor < lines.length) {
        const nextLine = lines[cursor];
        const nextIsField = IMPORT_FIELD_SPECS.some((candidate) => matchesImportLabel(nextLine, candidate));

        if (nextIsField) {
          break;
        }

        values.push(nextLine);
        cursor += 1;
      }

      value = values.join(" ").replace(/\s+/g, " ").trim();
    }

    if (!value || extracted[spec.key]) {
      continue;
    }

    extracted[spec.key] = value;
    details.push({ label: spec.label, value });
  }

  const qrToken = extractQrVerificationToken(source);
  const registrationNumber = normalizeUdyamNumber(extracted.registrationNumber || "");

  if (!registrationNumber && !extracted.enterpriseName) {
    throw new Error("Could not recognize Udyam certificate fields. Copy the official certificate or QR verification page and try again.");
  }

  const matchedFieldCount = details.length;
  const confidence = matchedFieldCount >= 8 ? "High" : matchedFieldCount >= 5 ? "Medium" : "Low";
  const links = [
    { label: "Official Udyam verify page", url: VERIFY_URL },
    { label: "Official print certificate", url: PRINT_URL },
  ];

  if (qrToken) {
    links.push({ label: "Official QR verification link", url: `${QR_VERIFY_URL}?verifyudrn=${encodeURIComponent(qrToken)}` });
  }

  return {
    status: "parsed",
    message:
      "Official Udyam certificate or QR verification content parsed inside VerifySME. This keeps the government verification step official while structuring the record inside your workspace.",
    parsedAt: new Date().toISOString(),
    confidence,
    matchedFieldCount,
    registrationNumber,
    enterpriseName: extracted.enterpriseName || "",
    organisationType: extracted.organisationType || "",
    majorActivity: extracted.majorActivity || "",
    socialCategory: extracted.socialCategory || "",
    gender: extracted.gender || "",
    officialAddress: extracted.officialAddress || "",
    officialMobile: extracted.officialMobile || "",
    officialEmail: extracted.officialEmail || "",
    dateOfIncorporation: extracted.dateOfIncorporation || "",
    dateOfCommencement: extracted.dateOfCommencement || "",
    dateOfRegistration: extracted.dateOfRegistration || "",
    enterpriseType: extracted.enterpriseType || "",
    classificationDate: extracted.classificationDate || "",
    qrToken,
    details,
    links,
  };
}

async function submitVerification(challenge, registrationNumber, captcha) {
  const body = new URLSearchParams({
    __EVENTTARGET: challenge.hiddenFields.__EVENTTARGET || "",
    __EVENTARGUMENT: challenge.hiddenFields.__EVENTARGUMENT || "",
    __VIEWSTATE: challenge.hiddenFields.__VIEWSTATE || "",
    __VIEWSTATEGENERATOR: challenge.hiddenFields.__VIEWSTATEGENERATOR || "",
    __VIEWSTATEENCRYPTED: challenge.hiddenFields.__VIEWSTATEENCRYPTED || "",
    "ctl00$ContentPlaceHolder1$hdnSetPassword": challenge.hiddenFields["ctl00$ContentPlaceHolder1$hdnSetPassword"] || "",
    "ctl00$ContentPlaceHolder1$txtUdyamNo": registrationNumber,
    "ctl00$ContentPlaceHolder1$txtCaptcha": captcha,
    "ctl00$ContentPlaceHolder1$btnVerify": "Verify",
  }).toString();

  const response = await requestUdyam(VERIFY_PATH, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE_URL,
      referer: VERIFY_URL,
    },
    cookies: challenge.cookies,
    body,
  });

  const cookies = mergeCookies(challenge.cookies, response.cookies);

  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    const followPath = new URL(response.headers.location, BASE_URL).pathname;
    const followed = await requestUdyam(followPath, {
      cookies,
      headers: {
        referer: VERIFY_URL,
      },
    });

    return {
      html: followed.text,
      cookies: mergeCookies(cookies, followed.cookies),
      finalUrl: `${BASE_URL}${followPath}`,
    };
  }

  return {
    html: response.text,
    cookies,
    finalUrl: VERIFY_URL,
  };
}

export async function verifyUdyamRegistration({ token, registrationNumber, captcha }) {
  cleanupExpiredChallenges();

  const challenge = activeChallenges.get(token);

  if (!challenge) {
    const error = new Error("The Udyam verification challenge expired. Load a new captcha and try again.");
    error.statusCode = 400;
    throw error;
  }

  const normalizedNumber = normalizeUdyamNumber(registrationNumber);

  if (!isValidUdyamNumber(normalizedNumber)) {
    const error = new Error("Enter a valid Udyam registration number in the format UDYAM-XX-00-0000000.");
    error.statusCode = 400;
    throw error;
  }

  if (!String(captcha || "").trim()) {
    const error = new Error("Enter the verification code shown in the official Udyam captcha.");
    error.statusCode = 400;
    throw error;
  }

  activeChallenges.delete(token);

  const result = await submitVerification(challenge, normalizedNumber, String(captcha || "").trim());
  const details = extractPrintDetails(result.html);
  const errors = extractErrors(result.html);
  let status = "not_found";
  let message = "No verification record was returned by the portal for the supplied registration number.";

  if (errors.some((value) => /incorrect verification code/i.test(value))) {
    status = "invalid_captcha";
    message = errors[0];
  } else if (details.length || /PrintUdyamApplication\.aspx/i.test(result.finalUrl)) {
    status = "verified";
    message = "Udyam registration was verified against the official portal.";
  } else if (errors.length) {
    message = errors[0];
  }

  const payload = {
    status,
    message,
    registrationNumber: normalizedNumber,
    details,
    links: extractResultLinks(result.html, result.finalUrl),
    pageTitle: parseTitle(result.html),
    finalUrl: result.finalUrl,
  };

  if (status !== "verified") {
    payload.nextChallenge = await createUdyamChallenge();
  }

  return payload;
}
