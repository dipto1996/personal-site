import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { z } from "zod";

import { canSpend, getProviderUsageSince, recordProviderUsage } from "./repository.js";
import { parseStructuredContent } from "./schemas.js";

const PRICING = {
  "glm-5.2": { input: 1.4, output: 4.4 },
  "glm-4.7-flash": { input: 0, output: 0 },
  "kimi-k2.5": { cachedInput: 0.1, input: 0.6, output: 3 },
};

function compact(value, max = 24000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sourceId(provider, ...parts) {
  return `${provider}_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 20)}`;
}

export function selectBestJobUrl(job) {
  const links = [...(job.apply_options || []).map((option) => option?.link), job.share_link].filter(Boolean);
  const preferredHosts = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|oraclecloud\.com)/i;
  const aggregatorHosts = /(linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|salutemyjob\.com|builtin[a-z]*\.com)/i;
  return links.find((link) => preferredHosts.test(link))
    || links.find((link) => !aggregatorHosts.test(link))
    || links[0]
    || "";
}

async function fetchJson(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || payload?.error || `Request failed with ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export function providerConfiguration() {
  return {
    local: Boolean(process.env.JOBSEARCH_LOCAL_LLM_BASE_URL),
    serpapi: Boolean(process.env.SERPAPI_API_KEY),
    brave: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    tavily: Boolean(process.env.TAVILY_API_KEY),
    zai: Boolean(process.env.ZAI_API_KEY),
    moonshot: Boolean(process.env.MOONSHOT_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    cloudflare: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    inngest: Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY),
  };
}

export async function searchSerpApiJobs(querySpec, { runId } = {}) {
  if (!process.env.SERPAPI_API_KEY) return { jobs: [], status: "missing_key" };
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_jobs");
  url.searchParams.set("q", querySpec.query);
  url.searchParams.set("location", "United States");
  url.searchParams.set("hl", "en");
  url.searchParams.set("chips", "date_posted:today");
  url.searchParams.set("api_key", process.env.SERPAPI_API_KEY);
  await recordProviderUsage({ provider: "serpapi", operation: "google_jobs", runId, requestCount: 1 });
  const payload = await fetchJson(url);
  const jobs = (payload.jobs_results || []).map((job) => ({
    sourceId: sourceId("serp", job.job_id || job.title, job.company_name, job.location),
    title: compact(job.title, 300),
    company: compact(job.company_name, 300),
    description: compact(job.description, 24000),
    location: compact(job.location, 300),
    postedAt: job.detected_extensions?.posted_at || job.extensions?.find((value) => /ago|today/i.test(value)) || null,
    compensation: compact(
      job.detected_extensions?.salary
      || job.extensions?.find((value) => /(?:\$|usd|salary|compensation|pay).*(?:year|annual|hour)|\d[\d,.]*\s*[-–—]\s*\d[\d,.]*\s*(?:a year|annually|per year)/i.test(value)),
      300,
    ),
    url: selectBestJobUrl(job),
    sourceProvider: "serpapi_google_jobs",
    sourceQuery: querySpec.id,
    raw: job,
  })).filter((job) => job.title && job.company && job.description);
  return { jobs, status: "live", metadata: { query: querySpec.id, count: jobs.length } };
}

export async function searchBrave(query, { runId, freshness = "pd", count = 10 } = {}) {
  if (!process.env.BRAVE_SEARCH_API_KEY) return { results: [], status: "missing_key" };
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(20, count)));
  url.searchParams.set("search_lang", "en");
  url.searchParams.set("country", "us");
  if (freshness) url.searchParams.set("freshness", freshness);
  await recordProviderUsage({ provider: "brave", operation: "web_search", runId, requestCount: 1 });
  const payload = await fetchJson(url, {
    headers: { accept: "application/json", "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY },
  });
  return {
    status: "live",
    results: (payload.web?.results || []).map((item) => ({
      title: compact(item.title, 500),
      url: item.url,
      description: compact(item.description, 3000),
      age: item.age || "",
      profile: item.profile || {},
    })),
  };
}

function parseJsonLd(html) {
  const $ = cheerio.load(html);
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(element).text());
      const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(parsed?.["@graph"] || [])];
      const posting = candidates.find((item) => {
        const type = item?.["@type"];
        return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
      });
      if (posting) return posting;
    } catch {
      // Continue to the next JSON-LD block.
    }
  }
  return null;
}

export function extractJobFromHtml(html, url) {
  const $ = cheerio.load(html);
  const posting = parseJsonLd(html);
  const description = compact(posting?.description ? cheerio.load(posting.description).text() : $("main").text() || $("body").text(), 24000);
  const location = posting?.jobLocation?.address?.addressLocality
    || posting?.jobLocation?.address?.addressRegion
    || posting?.applicantLocationRequirements?.name
    || "";
  return {
    sourceId: sourceId("page", posting?.identifier?.value || url),
    title: compact(posting?.title || $("h1").first().text() || $("title").text(), 300),
    company: compact(posting?.hiringOrganization?.name || $('meta[property="og:site_name"]').attr("content") || new URL(url).hostname, 300),
    description,
    location: compact(location, 300),
    postedAt: posting?.datePosted || null,
    url,
    sourceProvider: posting ? "json_ld" : "generic_html",
    sourceQuery: "page_extract",
    raw: { jsonLd: posting || null },
  };
}

export async function extractJobPage(url, { runId } = {}) {
  try {
    const response = await fetch(url, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 JobIntelligence/1.0" } });
    const html = await response.text();
    if (!response.ok) throw new Error(`Page returned ${response.status}`);
    const job = extractJobFromHtml(html, url);
    if (job.title && job.company && job.description.length >= 200) return { job, status: "direct" };
    throw new Error("Direct extraction did not produce a complete job description.");
  } catch (directError) {
    if (!process.env.TAVILY_API_KEY) return { job: null, status: "failed", error: directError.message };
    try {
      const payload = await fetchJson("https://api.tavily.com/extract", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
        body: JSON.stringify({ urls: [url], extract_depth: "basic", format: "text" }),
      });
      await recordProviderUsage({ provider: "tavily", operation: "extract", runId, requestCount: 1 });
      const content = payload.results?.[0]?.raw_content || "";
      const job = extractJobFromHtml(`<main>${content}</main>`, url);
      return { job: job.description.length >= 200 ? { ...job, sourceProvider: "tavily_extract" } : null, status: "tavily" };
    } catch (error) {
      return { job: null, status: "failed", error: error.message };
    }
  }
}

function estimateCost(model, inputTokens, outputTokens) {
  const pricing = PRICING[model] || { input: 0, output: 0 };
  return ((inputTokens / 1_000_000) * pricing.input) + ((outputTokens / 1_000_000) * pricing.output);
}

const FREE_LIMITS = {
  groqRequestsPerDay: 900,
  groqQwenTokensPerDay: 450000,
  groqGptOssTokensPerDay: 180000,
  cloudflareNeuronsPerDay: 9000,
  openrouterRequestsPerDay: 45,
};

const CLOUDFLARE_NEURON_RATES = {
  "@cf/meta/llama-3.1-8b-instruct-fast": { input: 4119, output: 34868 },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 26668, output: 204805 },
};

const MODEL_ROUTES = {
  triage: [
    { provider: "local", model: process.env.JOBSEARCH_LOCAL_LLM_MODEL || "qwen3-4b", format: "json_schema", thinking: false },
    { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct-fast", format: "json_object" },
    { provider: "groq", model: "openai/gpt-oss-120b", format: "json_schema", reasoningEffort: "low" },
    { provider: "openrouter", model: "openrouter/free", format: "json_schema" },
    { provider: "zai", model: "glm-4.7-flash", format: "json_object" },
  ],
  deep: [
    { provider: "local", model: process.env.JOBSEARCH_LOCAL_LLM_MODEL || "qwen3-4b", format: "json_schema", thinking: true },
    { provider: "groq", model: "openai/gpt-oss-20b", format: "json_object", reasoningEffort: "low" },
    { provider: "groq", model: "openai/gpt-oss-120b", format: "json_object", reasoningEffort: "low" },
    { provider: "cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", format: "json_object" },
    { provider: "openrouter", model: "openrouter/free", format: "json_object" },
    { provider: "zai", model: "glm-5.2", format: "json_object", paid: true },
  ],
  critic: [
    { provider: "local", model: process.env.JOBSEARCH_LOCAL_LLM_MODEL || "qwen3-4b", format: "json_schema", thinking: true },
    { provider: "cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", format: "json_object" },
    { provider: "openrouter", model: "openrouter/free", format: "json_schema" },
    { provider: "groq", model: "openai/gpt-oss-120b", format: "json_schema", reasoningEffort: "low" },
    { provider: "moonshot", model: "kimi-k2.5", format: "json_object", paid: true },
  ],
  utility: [
    { provider: "local", model: process.env.JOBSEARCH_LOCAL_LLM_MODEL || "qwen3-4b", format: "json_schema", thinking: false },
    { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct-fast", format: "json_object" },
    { provider: "groq", model: "openai/gpt-oss-120b", format: "json_schema", reasoningEffort: "low" },
    { provider: "openrouter", model: "openrouter/free", format: "json_schema" },
    { provider: "zai", model: "glm-4.7-flash", format: "json_object" },
  ],
};

function positiveLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function startOfUtcDay() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function estimateTokens(messages) {
  return Math.max(1, Math.ceil(JSON.stringify(messages).length / 4));
}

function cloudflareNeurons(model, inputTokens, outputTokens) {
  const rates = CLOUDFLARE_NEURON_RATES[model] || CLOUDFLARE_NEURON_RATES["@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
  return ((Number(inputTokens) || 0) * rates.input + (Number(outputTokens) || 0) * rates.output) / 1_000_000;
}

function cloudflareUsageNeurons(usage) {
  return Object.entries(usage.byModel || {}).reduce((total, [model, values]) => (
    total + cloudflareNeurons(model, values.inputTokens, values.outputTokens)
  ), 0);
}

function groqTokenPool(route, usage) {
  const gptOss = /^openai\/gpt-oss-/i.test(route.model);
  const models = Object.entries(usage.byModel || {})
    .filter(([model]) => gptOss ? /^openai\/gpt-oss-/i.test(model) : model === route.model);
  return {
    usedTokens: models.reduce((total, [, values]) => (
      total + (Number(values.inputTokens) || 0) + (Number(values.outputTokens) || 0)
    ), 0),
    tokenLimit: gptOss
      ? positiveLimit("JOBSEARCH_GROQ_GPT_OSS_TOKENS_PER_DAY", FREE_LIMITS.groqGptOssTokensPerDay)
      : positiveLimit("JOBSEARCH_GROQ_QWEN_TOKENS_PER_DAY", FREE_LIMITS.groqQwenTokensPerDay),
    name: gptOss ? "gpt-oss" : route.model,
  };
}

function groqReportedUsage(message) {
  const match = String(message || "").match(
    /Limit\s*:?[\s`]*(\d[\d,]*)[\s\S]*?Used\s*:?[\s`]*(\d[\d,]*)[\s\S]*?Requested\s*:?[\s`]*(\d[\d,]*)/i,
  );
  if (!match) return null;
  return {
    limit: Number(match[1].replace(/,/g, "")),
    used: Number(match[2].replace(/,/g, "")),
    requested: Number(match[3].replace(/,/g, "")),
  };
}

function providerConfigured(provider) {
  if (provider === "local") return Boolean(process.env.JOBSEARCH_LOCAL_LLM_BASE_URL);
  if (provider === "groq") return Boolean(process.env.GROQ_API_KEY);
  if (provider === "cloudflare") return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
  if (provider === "openrouter") return Boolean(process.env.OPENROUTER_API_KEY);
  if (provider === "zai") return Boolean(process.env.ZAI_API_KEY);
  if (provider === "moonshot") return Boolean(process.env.MOONSHOT_API_KEY);
  return false;
}

async function quotaStatus(route, estimatedInputTokens, maxTokens) {
  if (!providerConfigured(route.provider)) return { allowed: false, status: "missing_key" };
  if (route.paid && process.env.JOBSEARCH_ENABLE_PAID_MODEL_FALLBACKS !== "true") {
    return { allowed: false, status: "paid_fallback_disabled" };
  }
  if (route.paid) {
    const cost = estimateCost(route.model, estimatedInputTokens, maxTokens);
    return { allowed: await canSpend(route.provider, cost), status: "budget_blocked" };
  }
  if (!["groq", "cloudflare", "openrouter"].includes(route.provider)) return { allowed: true, status: "available" };
  const usage = await getProviderUsageSince(route.provider, startOfUtcDay());
  if (route.provider === "openrouter") {
    const limit = positiveLimit("JOBSEARCH_OPENROUTER_REQUESTS_PER_DAY", FREE_LIMITS.openrouterRequestsPerDay);
    return { allowed: usage.requests < limit, status: "quota_blocked", used: usage.requests, limit };
  }
  if (route.provider === "cloudflare") {
    const limit = positiveLimit("JOBSEARCH_CLOUDFLARE_NEURONS_PER_DAY", FREE_LIMITS.cloudflareNeuronsPerDay);
    const used = cloudflareUsageNeurons(usage);
    const requested = cloudflareNeurons(route.model, estimatedInputTokens, maxTokens);
    return { allowed: used + requested <= limit, status: "quota_blocked", used, requested, limit };
  }
  const requestLimit = positiveLimit("JOBSEARCH_GROQ_REQUESTS_PER_DAY", FREE_LIMITS.groqRequestsPerDay);
  const pool = groqTokenPool(route, usage);
  return {
    allowed: usage.requests < requestLimit && pool.usedTokens + estimatedInputTokens + maxTokens <= pool.tokenLimit,
    status: "quota_blocked",
    used: usage.requests,
    limit: requestLimit,
    usedTokens: pool.usedTokens,
    tokenLimit: pool.tokenLimit,
    tokenPool: pool.name,
  };
}

function routeConnection(route) {
  if (route.provider === "local") {
    const baseUrl = String(process.env.JOBSEARCH_LOCAL_LLM_BASE_URL || "http://127.0.0.1:8080/v1").replace(/\/$/, "");
    return {
      url: `${baseUrl}/chat/completions`,
      headers: process.env.JOBSEARCH_LOCAL_LLM_API_KEY
        ? { authorization: `Bearer ${process.env.JOBSEARCH_LOCAL_LLM_API_KEY}` }
        : {},
    };
  }
  if (route.provider === "groq") {
    return {
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    };
  }
  if (route.provider === "cloudflare") {
    return {
      url: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
      headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    };
  }
  if (route.provider === "openrouter") {
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "http-referer": process.env.APP_URL || "https://tradegraph-india-site.vercel.app",
        "x-title": "Diptopal Roy Job Intelligence",
      },
    };
  }
  if (route.provider === "zai") {
    return {
      url: "https://api.z.ai/api/paas/v4/chat/completions",
      headers: { authorization: `Bearer ${process.env.ZAI_API_KEY}` },
    };
  }
  return {
    url: "https://api.moonshot.ai/v1/chat/completions",
    headers: { authorization: `Bearer ${process.env.MOONSHOT_API_KEY}` },
  };
}

function structuredResponseFormat(route, schema, operation) {
  if (route.format !== "json_schema") return { type: "json_object" };
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });
  delete jsonSchema.$schema;
  return {
    type: "json_schema",
    json_schema: {
      name: String(operation || "job_intelligence").replace(/[^a-z0-9_]+/gi, "_").slice(0, 60),
      strict: false,
      schema: jsonSchema,
    },
  };
}

function classifyProviderError(error) {
  if (error.name === "AbortError") return "timeout";
  if (error.statusCode === 401) return "authentication_blocked";
  if (error.statusCode === 402) return "payment_blocked";
  if (error.statusCode === 429) return "rate_limited";
  if ([400, 403].includes(error.statusCode)) return "provider_blocked";
  if (error.statusCode >= 500) return "provider_unavailable";
  return "provider_error";
}

function completionPayload(payload) {
  return payload?.result?.choices ? payload.result : payload;
}

function completionContent(completion) {
  const content = completion?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || "").join("");
  return String(content || "");
}

function modelAttempt(response, retry = 0) {
  return {
    provider: response.provider,
    model: response.model,
    status: response.status,
    retry,
    ...(response.error ? {
      reason: String(response.error)
        .replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, "[redacted]")
        .slice(0, 300),
    } : {}),
  };
}

function shouldRetryGroq({ stage, route, response }) {
  if (route.provider !== "groq" || !["deep", "critic"].includes(stage)) return false;
  if (["provider_error", "provider_unavailable", "timeout", "invalid_response"].includes(response.status)) {
    return true;
  }
  return response.status === "provider_blocked"
    && /failed(?:_|\s+)generation|failed to generate json/i.test(String(response.error || ""));
}

function retryDelayMs(response) {
  const message = String(response.error || "");
  const match = message.match(/try again in\s+([\d.]+)\s*(ms|milliseconds?|s|seconds?|m|minutes?)/i);
  if (!match) {
    return ["rate_limited", "invalid_response", "provider_blocked"].includes(response.status) ? 65000 : 1500;
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const delay = /^m(?:s|illisecond)/.test(unit) ? amount
    : /^m(?:inute)?/.test(unit) ? amount * 60000
      : amount * 1000;
  return Math.min(70000, Math.max(250, Math.ceil(delay + 500)));
}

async function callRoute({ route, messages, schema, runId, operation, maxTokens }) {
  const estimatedInputTokens = estimateTokens(messages);
  const quota = await quotaStatus(route, estimatedInputTokens, maxTokens);
  if (!quota.allowed) {
    return { result: null, status: quota.status, provider: route.provider, model: route.model, quota };
  }
  const connection = routeConnection(route);
  const routedMessages = route.provider === "local"
    ? messages.map((message, index) => (
      index === messages.length - 1 && message.role === "user"
        ? { ...message, content: `${route.thinking ? "/think" : "/no_think"}\n${message.content}` }
        : message
    ))
    : messages;
  let payload;
  try {
    payload = await fetchJson(connection.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...connection.headers },
      body: JSON.stringify({
        model: route.model,
        messages: routedMessages,
        temperature: 0.1,
        max_tokens: maxTokens,
        response_format: structuredResponseFormat(route, schema, operation),
        ...(route.reasoningEffort ? { reasoning_effort: route.reasoningEffort } : {}),
        ...(route.provider === "local" ? { cache_prompt: true } : {}),
        ...(route.provider === "zai" ? { thinking: { type: route.model === "glm-4.7-flash" ? "disabled" : "enabled" } } : {}),
      }),
    }, route.provider === "local" ? 600000 : 90000);
  } catch (error) {
    const status = classifyProviderError(error);
    let failedInputTokens = 0;
    let failedOutputTokens = 0;
    if (route.provider === "groq") {
      const reported = groqReportedUsage(error.message);
      if (reported && Number.isFinite(quota.usedTokens)) {
        failedInputTokens = Math.max(0, reported.used - quota.usedTokens);
      } else if (status === "rate_limited" && /tokens per day|\bTPD\b/i.test(String(error.message || ""))) {
        failedInputTokens = Math.max(0, (quota.tokenLimit || 0) - (quota.usedTokens || 0));
      } else if (status === "timeout" || /failed(?:_|\s+)generation|failed to generate json/i.test(String(error.message || ""))) {
        failedInputTokens = estimatedInputTokens;
        failedOutputTokens = maxTokens;
      }
    }
    await recordProviderUsage({
      provider: route.provider,
      operation,
      model: route.model,
      runId,
      inputTokens: failedInputTokens,
      outputTokens: failedOutputTokens,
      requestCount: 1,
    });
    return {
      result: null,
      status,
      provider: route.provider,
      model: route.model,
      error: error.message,
    };
  }
  const completion = completionPayload(payload);
  const inputTokens = Number(completion?.usage?.prompt_tokens) || estimatedInputTokens;
  const finishReason = completion?.choices?.[0]?.finish_reason || "unknown";
  const outputTokens = Number(completion?.usage?.completion_tokens)
    || (finishReason === "length" ? maxTokens : 0);
  const estimatedCostUsd = route.paid ? estimateCost(route.model, inputTokens, outputTokens) : 0;
  const usage = {
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    finishReason,
    ...(route.provider === "cloudflare" ? { estimatedNeurons: cloudflareNeurons(route.model, inputTokens, outputTokens) } : {}),
  };
  await recordProviderUsage({
    provider: route.provider, operation, model: route.model, runId,
    inputTokens, outputTokens, estimatedCostUsd, requestCount: 1,
  });
  if (finishReason === "length") {
    return { result: null, status: "truncated_response", provider: route.provider, model: route.model, usage };
  }
  try {
    return {
      result: parseStructuredContent(schema, completionContent(completion)),
      status: "live",
      provider: route.provider,
      model: completion?.model || route.model,
      usage,
    };
  } catch (error) {
    const rawOutput = completionContent(completion).replace(/\s+/g, " ").trim().slice(0, 220);
    return {
      result: null,
      status: "invalid_response",
      provider: route.provider,
      model: route.model,
      usage,
      error: `${rawOutput ? `Model output: ${rawOutput} | ` : ""}Validation: ${error.message}`,
    };
  }
}

export async function callRoutedModel({ stage, messages, schema, runId, operation, maxTokens = 1000 }) {
  const routes = (MODEL_ROUTES[stage] || MODEL_ROUTES.utility)
    .filter((route) => route.provider !== "local" || providerConfigured("local"));
  const attempts = [];
  for (const route of routes) {
    let response = await callRoute({ route, messages, schema, runId, operation, maxTokens });
    attempts.push(modelAttempt(response));
    if (response.result) return { ...response, attempts };

    if (shouldRetryGroq({ stage, route, response })) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response)));
      response = await callRoute({ route, messages, schema, runId, operation, maxTokens });
      attempts.push(modelAttempt(response, 1));
      if (response.result) return { ...response, attempts };
    }
  }
  return {
    result: null,
    status: attempts.length && attempts.every((attempt) => ["quota_blocked", "rate_limited", "paid_fallback_disabled", "missing_key"].includes(attempt.status))
      ? "quota_blocked" : "providers_exhausted",
    attempts,
  };
}

export function callTriageModel(options) {
  return callRoutedModel({ ...options, stage: "triage", maxTokens: options.maxTokens || 1800 });
}

export function callDeepModel(options) {
  return callRoutedModel({ ...options, stage: "deep", maxTokens: options.maxTokens || 3500 });
}

export function callCriticModel(options) {
  return callRoutedModel({ ...options, stage: "critic", maxTokens: options.maxTokens || 900 });
}

export function callUtilityModel(options) {
  return callRoutedModel({ ...options, stage: "utility", maxTokens: options.maxTokens || 700 });
}

export function callLocalModel({ stage = "deep", ...options }) {
  const route = (MODEL_ROUTES[stage] || MODEL_ROUTES.utility).find((candidate) => candidate.provider === "local");
  return callRoute({
    route,
    ...options,
    maxTokens: options.maxTokens || (stage === "deep" ? 3500 : stage === "critic" ? 1200 : 1800),
  });
}

export async function getFreeProviderQuotaSummary() {
  const since = startOfUtcDay();
  const [groq, cloudflare, openrouter] = await Promise.all([
    getProviderUsageSince("groq", since),
    getProviderUsageSince("cloudflare", since),
    getProviderUsageSince("openrouter", since),
  ]);
  return {
    local: {
      configured: providerConfigured("local"), period: "unlimited", requests: 0,
      model: process.env.JOBSEARCH_LOCAL_LLM_MODEL || "qwen3-4b",
    },
    groq: {
      configured: providerConfigured("groq"), period: "day", requests: groq.requests,
      requestLimit: positiveLimit("JOBSEARCH_GROQ_REQUESTS_PER_DAY", FREE_LIMITS.groqRequestsPerDay),
      gptOssTokens: groqTokenPool({ model: "openai/gpt-oss-20b" }, groq).usedTokens,
      gptOssTokenLimit: positiveLimit("JOBSEARCH_GROQ_GPT_OSS_TOKENS_PER_DAY", FREE_LIMITS.groqGptOssTokensPerDay),
      byModel: groq.byModel,
    },
    cloudflare: {
      configured: providerConfigured("cloudflare"), period: "day",
      neurons: cloudflareUsageNeurons(cloudflare),
      neuronLimit: positiveLimit("JOBSEARCH_CLOUDFLARE_NEURONS_PER_DAY", FREE_LIMITS.cloudflareNeuronsPerDay),
      requests: cloudflare.requests,
    },
    openrouter: {
      configured: providerConfigured("openrouter"), period: "day", requests: openrouter.requests,
      requestLimit: positiveLimit("JOBSEARCH_OPENROUTER_REQUESTS_PER_DAY", FREE_LIMITS.openrouterRequestsPerDay),
    },
  };
}

const providerCanarySchema = z.object({
  ok: z.boolean(),
  provider: z.string().min(1),
});

export async function runFreeProviderCanary(runId = null) {
  const canaryRoutes = [
    { stage: "triage", route: MODEL_ROUTES.triage.find((route) => route.provider === "groq") },
    { stage: "deep", route: MODEL_ROUTES.deep.find((route) => route.provider === "groq") },
    { stage: "critic", route: MODEL_ROUTES.critic.find((route) => route.provider === "cloudflare") },
    { stage: "fallback", route: MODEL_ROUTES.deep.find((route) => route.provider === "openrouter") },
  ];
  const results = [];
  for (const { stage, route } of canaryRoutes) {
    if (!providerConfigured(route.provider)) {
      results.push({ stage, provider: route.provider, model: route.model, status: "missing_key" });
      continue;
    }
    const response = await callRoute({
      route,
      runId,
      operation: "provider_canary",
      maxTokens: 400,
      schema: providerCanarySchema,
      messages: [
        { role: "system", content: "Return only valid JSON matching the requested shape." },
        { role: "user", content: `Return {"ok":true,"provider":"${route.provider}"}.` },
      ],
    });
    results.push({
      stage,
      provider: route.provider,
      model: response.model || route.model,
      status: response.result?.ok ? "live" : response.status,
      inputTokens: Number(response.usage?.inputTokens) || 0,
      outputTokens: Number(response.usage?.outputTokens) || 0,
      reason: response.result?.ok ? undefined : String(response.error || "").replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, "[redacted]").slice(0, 240) || undefined,
    });
  }
  return { ok: results.every((result) => result.status === "live"), results };
}

export function callGlmFlash(options) {
  return callRoute({
    route: MODEL_ROUTES.utility.find((route) => route.provider === "zai"),
    ...options,
    maxTokens: options.maxTokens || 3000,
  });
}

export function callGlmDeep(options) {
  return callRoute({
    route: MODEL_ROUTES.deep.find((route) => route.provider === "zai"),
    ...options,
    maxTokens: options.maxTokens || 1200,
  });
}

export function callKimiCritic(options) {
  return callRoute({
    route: MODEL_ROUTES.critic.find((route) => route.provider === "moonshot"),
    ...options,
    maxTokens: options.maxTokens || 900,
  });
}

export { CLOUDFLARE_NEURON_RATES, FREE_LIMITS, MODEL_ROUTES, PRICING, compact, sourceId };
