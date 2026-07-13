import {
  compact,
  fetchWithTimeout,
  normalizeString,
  parseTimestamp,
  sourceHash,
  stripHtml,
  uniqueBy,
} from "./utils.js";
import { getConfiguredAtsSources } from "./profile.js";

function boardLabel(token) {
  return normalizeString(token)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function detectAtsFromUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);

    if (host.includes("greenhouse.io")) {
      const boardToken = url.searchParams.get("for") || segments[0] || "";
      const jobId = url.searchParams.get("token") || url.searchParams.get("gh_jid") || segments[segments.indexOf("jobs") + 1] || "";
      return boardToken ? { provider: "greenhouse", boardToken, jobId } : { provider: "generic" };
    }

    if (host === "jobs.lever.co" || host.endsWith(".lever.co")) {
      return segments[0]
        ? { provider: "lever", company: segments[0], jobId: segments[1] || "" }
        : { provider: "generic" };
    }

    if (host === "jobs.ashbyhq.com" || host.endsWith(".ashbyhq.com")) {
      return segments[0]
        ? { provider: "ashby", company: segments[0], jobId: segments[1] || "" }
        : { provider: "generic" };
    }

    if (host.includes("myworkdayjobs.com")) {
      const tenant = host.split(".")[0];
      const jobIndex = segments.indexOf("job");
      const site = jobIndex > 1 ? segments[jobIndex - 1] : segments[1] || "External";
      const jobPath = jobIndex >= 0 ? segments.slice(jobIndex + 1).join("/") : "";
      return { provider: "workday", tenant, site, jobPath, host };
    }

    if (host === "jobs.smartrecruiters.com" || host.endsWith(".smartrecruiters.com")) {
      return segments[0]
        ? { provider: "smartrecruiters", company: segments[0], jobId: (segments[1] || "").split("-")[0] }
        : { provider: "generic" };
    }
  } catch {
    return { provider: "invalid" };
  }

  return { provider: "generic" };
}

function normalizeGreenhouseJob(job, boardToken, sourceQuery = "greenhouse_board") {
  const offices = (job.offices || []).map((office) => office.name).filter(Boolean);
  const description = stripHtml(job.content || "");

  return {
    sourceId: `greenhouse_${job.id || sourceHash(boardToken, job.title, job.absolute_url)}`,
    title: normalizeString(job.title, "Untitled role"),
    company: boardLabel(boardToken),
    description: compact(description, 16000),
    url: normalizeString(job.absolute_url),
    location: offices.join(", "),
    postedAt: parseTimestamp(job.updated_at || job.first_published || job.created_at),
    sourceQuery,
    sourceProvider: "greenhouse",
    raw: {
      ats: {
        provider: "greenhouse",
        boardToken,
        jobId: job.id ? String(job.id) : "",
        validated: true,
      },
      job,
    },
  };
}

function normalizeLeverJob(job, company, sourceQuery = "lever_company") {
  const lists = (job.lists || [])
    .map((list) => `${list.text || ""}: ${(list.content || "").replace(/<[^>]+>/g, " ")}`)
    .join(" ");
  const description = stripHtml(`${job.description || ""} ${job.descriptionPlain || ""} ${lists}`);

  return {
    sourceId: `lever_${job.id || sourceHash(company, job.text, job.hostedUrl)}`,
    title: normalizeString(job.text, "Untitled role"),
    company: boardLabel(company),
    description: compact(description, 16000),
    url: normalizeString(job.hostedUrl || job.applyUrl),
    location: normalizeString(job.categories?.location),
    postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    sourceQuery,
    sourceProvider: "lever",
    raw: {
      ats: {
        provider: "lever",
        company,
        jobId: job.id || "",
        validated: true,
      },
      job,
    },
  };
}

function normalizeAshbyJob(job, company, sourceQuery = "ashby_company") {
  const location = normalizeString(job.location || job.locationName || job.secondaryLocations?.map((item) => item.location).join(", "));
  const description = stripHtml(job.descriptionHtml || job.description || job.plainTextDescription || "");
  const url = normalizeString(job.jobUrl || job.applyUrl || `https://jobs.ashbyhq.com/${company}/${job.id || ""}`);

  return {
    sourceId: `ashby_${job.id || sourceHash(company, job.title, url)}`,
    title: normalizeString(job.title, "Untitled role"),
    company: boardLabel(company),
    description: compact(description, 16000),
    url,
    location,
    postedAt: parseTimestamp(job.publishedAt || job.postedAt),
    sourceQuery,
    sourceProvider: "ashby",
    raw: {
      ats: {
        provider: "ashby",
        company,
        jobId: job.id || "",
        validated: true,
      },
      job,
    },
  };
}

function normalizeSmartRecruitersJob(job, company, sourceQuery = "smartrecruiters_company") {
  const sections = job.jobAd?.sections || {};
  const description = stripHtml([
    sections.companyDescription?.text,
    sections.jobDescription?.text,
    sections.qualifications?.text,
    sections.additionalInformation?.text,
  ].filter(Boolean).join(" "));
  return {
    sourceId: `smartrecruiters_${job.id || sourceHash(company, job.name, job.ref)}`,
    title: normalizeString(job.name, "Untitled role"),
    company: normalizeString(job.company?.name, boardLabel(company)),
    description: compact(description, 16000),
    url: normalizeString(job.ref || `https://jobs.smartrecruiters.com/${company}/${job.id || ""}`),
    location: normalizeString([job.location?.city, job.location?.region, job.location?.country].filter(Boolean).join(", ")),
    postedAt: parseTimestamp(job.releasedDate || job.createdOn),
    sourceQuery,
    sourceProvider: "smartrecruiters",
    raw: { ats: { provider: "smartrecruiters", company, jobId: job.id || "", validated: true }, job },
  };
}

function normalizeWorkdayJob(job, descriptor, sourceQuery = "workday_job") {
  const info = job.jobPostingInfo || job;
  const description = stripHtml(info.jobDescription || job.jobDescription || "");
  return {
    sourceId: `workday_${info.jobReqId || info.id || sourceHash(descriptor.tenant, info.title, descriptor.jobPath)}`,
    title: normalizeString(info.title, "Untitled role"),
    company: boardLabel(descriptor.tenant),
    description: compact(description, 16000),
    url: normalizeString(info.externalUrl || `https://${descriptor.host}/${descriptor.jobPath}`),
    location: normalizeString(info.location || info.additionalLocations),
    postedAt: parseTimestamp(info.startDate || info.postedOn),
    sourceQuery,
    sourceProvider: "workday",
    raw: { ats: { provider: "workday", tenant: descriptor.tenant, site: descriptor.site, validated: true }, job },
  };
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Request failed with ${response.status}`);
  }

  return payload;
}

async function fetchGreenhouseBoard(boardToken, { jobId = "", sourceQuery = "greenhouse_board" } = {}) {
  const payload = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`);
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  return jobs
    .filter((job) => !jobId || String(job.id) === String(jobId))
    .map((job) => normalizeGreenhouseJob(job, boardToken, sourceQuery));
}

async function fetchLeverCompany(company, { jobId = "", sourceQuery = "lever_company" } = {}) {
  const payload = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`);
  const jobs = Array.isArray(payload) ? payload : [];
  return jobs
    .filter((job) => !jobId || job.id === jobId)
    .map((job) => normalizeLeverJob(job, company, sourceQuery));
}

async function fetchAshbyCompany(company, { jobId = "", sourceQuery = "ashby_company" } = {}) {
  const payload = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company)}`);
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  return jobs
    .filter((job) => !jobId || job.id === jobId)
    .map((job) => normalizeAshbyJob(job, company, sourceQuery));
}

async function fetchSmartRecruitersCompany(company, { jobId = "", sourceQuery = "smartrecruiters_company" } = {}) {
  if (jobId) {
    const job = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(jobId)}`);
    return [normalizeSmartRecruitersJob(job, company, sourceQuery)];
  }
  const payload = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100`);
  return (payload.content || []).map((job) => normalizeSmartRecruitersJob(job, company, sourceQuery));
}

async function fetchWorkdayJob(descriptor, sourceQuery = "workday_job") {
  if (!descriptor.jobPath) return [];
  const endpoint = `https://${descriptor.host}/wday/cxs/${encodeURIComponent(descriptor.tenant)}/${encodeURIComponent(descriptor.site)}/job/${descriptor.jobPath}`;
  const payload = await fetchJson(endpoint);
  return [normalizeWorkdayJob(payload, descriptor, sourceQuery)];
}

function extractJsonLdJobPosting(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter(Boolean);

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block.trim());
      const items = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] || [])];
      const posting = items.find((item) => {
        const type = item?.["@type"];
        return Array.isArray(type) ? type.includes("JobPosting") : type === "JobPosting";
      });

      if (posting) {
        return posting;
      }
    } catch {
      // Ignore invalid embedded JSON-LD and continue with plain HTML extraction.
    }
  }

  return null;
}

function textBetween(html, expression) {
  const match = html.match(expression);
  return match ? stripHtml(match[1]) : "";
}

function inferCompanyFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return "Unknown company";
  }
}

async function fetchGenericJobPage(url, sourceQuery = "generic_page") {
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "text/html, application/xhtml+xml",
    },
  });
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Page fetch failed with ${response.status}`);
  }

  const jsonLd = extractJsonLdJobPosting(html);
  const title = normalizeString(
    jsonLd?.title || textBetween(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    "Untitled role",
  );
  const company = normalizeString(
    jsonLd?.hiringOrganization?.name || textBetween(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["'][^>]*>/i),
    boardLabel(inferCompanyFromUrl(url)),
  );
  const description = compact(
    stripHtml(jsonLd?.description || textBetween(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) || html),
    16000,
  );
  const location = normalizeString(
    jsonLd?.jobLocation?.address?.addressLocality
      || jsonLd?.jobLocation?.address?.addressRegion
      || jsonLd?.applicantLocationRequirements?.name,
  );

  return [{
    sourceId: `page_${sourceHash(title, company, url)}`,
    title,
    company,
    description,
    url,
    location,
    postedAt: parseTimestamp(jsonLd?.datePosted || jsonLd?.validThrough),
    sourceQuery,
    sourceProvider: "generic_page",
    raw: {
      ats: {
        provider: "generic_page",
        validated: Boolean(jsonLd),
      },
      evidence: [
        {
          label: "Page validation",
          value: jsonLd ? "JobPosting JSON-LD detected." : "Generic page text extracted; manual validation recommended.",
          strength: jsonLd ? "positive" : "neutral",
        },
      ],
    },
  }];
}

export async function fetchJobsFromAtsDescriptor(descriptor, sourceQuery = "ats_descriptor") {
  if (!descriptor || descriptor.provider === "invalid") {
    return [];
  }

  if (descriptor.provider === "greenhouse") {
    return fetchGreenhouseBoard(descriptor.boardToken, { jobId: descriptor.jobId, sourceQuery });
  }

  if (descriptor.provider === "lever") {
    return fetchLeverCompany(descriptor.company, { jobId: descriptor.jobId, sourceQuery });
  }

  if (descriptor.provider === "ashby") {
    return fetchAshbyCompany(descriptor.company, { jobId: descriptor.jobId, sourceQuery });
  }

  if (descriptor.provider === "workday") {
    return fetchWorkdayJob(descriptor, sourceQuery);
  }

  if (descriptor.provider === "smartrecruiters") {
    return fetchSmartRecruitersCompany(descriptor.company, { jobId: descriptor.jobId, sourceQuery });
  }

  return fetchGenericJobPage(descriptor.url, sourceQuery);
}

export async function fetchConfiguredAtsJobs() {
  const sources = getConfiguredAtsSources();
  const provider = {
    status: "not_configured",
    configured: sources,
    fetched: 0,
    errors: [],
  };
  const tasks = [];

  sources.greenhouse.forEach((boardToken) => {
    tasks.push(fetchGreenhouseBoard(boardToken, { sourceQuery: "configured_greenhouse" }));
  });
  sources.lever.forEach((company) => {
    tasks.push(fetchLeverCompany(company, { sourceQuery: "configured_lever" }));
  });
  sources.ashby.forEach((company) => {
    tasks.push(fetchAshbyCompany(company, { sourceQuery: "configured_ashby" }));
  });
  sources.smartrecruiters.forEach((company) => {
    tasks.push(fetchSmartRecruitersCompany(company, { sourceQuery: "configured_smartrecruiters" }));
  });
  sources.workday.forEach((source) => {
    const [host, tenant, site, jobPath] = source.split("|");
    if (host && tenant && site && jobPath) {
      tasks.push(fetchWorkdayJob({ provider: "workday", host, tenant, site, jobPath }, "configured_workday"));
    }
  });

  if (!tasks.length) {
    return { jobs: [], provider };
  }

  const settled = await Promise.allSettled(tasks);
  const jobs = [];
  settled.forEach((result) => {
    if (result.status === "fulfilled") {
      jobs.push(...result.value);
    } else {
      provider.errors.push(result.reason?.message || "ATS fetch failed.");
    }
  });

  provider.fetched = jobs.length;
  provider.status = provider.errors.length === settled.length ? "error" : "live";
  return { jobs: uniqueBy(jobs, (job) => job.sourceId), provider };
}

export async function validateDiscoveryCandidates(candidates = []) {
  const limit = Number(process.env.JOBSEARCH_DISCOVERY_VALIDATE_LIMIT || 25);
  const provider = {
    status: candidates.length ? "validating" : "no_candidates",
    checked: 0,
    fetched: 0,
    errors: [],
  };
  const jobs = [];

  for (const candidate of candidates.slice(0, limit)) {
    if (!candidate.url) {
      continue;
    }

    const descriptor = {
      ...detectAtsFromUrl(candidate.url),
      url: candidate.url,
    };

    try {
      const validated = await fetchJobsFromAtsDescriptor(descriptor, candidate.sourceQuery || candidate.sourceProvider);
      jobs.push(...validated.map((job) => ({
        ...job,
        raw: {
          ...(job.raw || {}),
          discovery: {
            candidate,
            validatedFrom: descriptor.provider,
          },
        },
      })));
    } catch (error) {
      provider.errors.push({ url: candidate.url, error: error.message });
    } finally {
      provider.checked += 1;
    }
  }

  provider.fetched = jobs.length;
  provider.status = provider.errors.length === provider.checked && provider.checked ? "error" : provider.checked ? "live" : provider.status;
  return { jobs: uniqueBy(jobs, (job) => job.sourceId), provider };
}

export async function fetchJobsFromUrls(urls = []) {
  const candidates = urls.map((url) => ({
    url,
    sourceQuery: "manual_url",
    sourceProvider: "manual_url",
  }));
  return validateDiscoveryCandidates(candidates);
}
