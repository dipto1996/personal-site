import { clamp, compact, normalizeNumber, normalizeString } from "./utils.js";
import { TARGET_PROFILE } from "./profile.js";

function parseJsonObject(text) {
  const raw = normalizeString(text);

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("No JSON object found in model response.");
    }
    return JSON.parse(match[0]);
  }
}

function openAiCompatibleBaseFor(provider, explicitBaseUrl) {
  const normalized = normalizeString(provider).toLowerCase();

  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/$/, "");
  }

  if (normalized === "ollama") {
    return "http://localhost:11434/v1";
  }

  if (normalized === "openrouter") {
    return "https://openrouter.ai/api/v1";
  }

  if (normalized === "moonshot") {
    return "https://api.moonshot.ai/v1";
  }

  return "";
}

function getReasonerConfig() {
  const provider = process.env.JOBSEARCH_REASONER_PROVIDER || process.env.JOBSEARCH_LLM_PROVIDER || "";
  const baseUrl = openAiCompatibleBaseFor(
    provider,
    process.env.JOBSEARCH_REASONER_BASE_URL || process.env.JOBSEARCH_LLM_BASE_URL,
  );
  const model = process.env.JOBSEARCH_REASONER_MODEL || process.env.JOBSEARCH_LLM_MODEL || "";
  const apiKey = process.env.JOBSEARCH_REASONER_API_KEY || process.env.JOBSEARCH_LLM_API_KEY || "";

  return {
    provider: provider || (baseUrl ? "openai-compatible" : ""),
    baseUrl,
    model,
    apiKey,
    configured: Boolean(baseUrl && model),
  };
}

function getEmbeddingConfig() {
  const provider = process.env.JOBSEARCH_EMBEDDING_PROVIDER || "";
  let baseUrl = openAiCompatibleBaseFor(provider, process.env.JOBSEARCH_EMBEDDING_BASE_URL || "");
  let model = process.env.JOBSEARCH_EMBEDDING_MODEL || "";
  let apiKey = process.env.JOBSEARCH_EMBEDDING_API_KEY || "";

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    baseUrl = "https://api.openai.com/v1";
    model = model || process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
    apiKey = process.env.OPENAI_API_KEY;
  }

  return {
    provider: provider || (baseUrl ? "openai-compatible" : ""),
    baseUrl,
    model,
    apiKey,
    configured: Boolean(baseUrl && model),
  };
}

export function getModelRuntimeStatus() {
  const reasoner = getReasonerConfig();
  const embeddings = getEmbeddingConfig();

  return {
    reasoner: reasoner.configured
      ? {
        status: "configured",
        provider: reasoner.provider,
        model: reasoner.model,
        baseUrl: reasoner.baseUrl.replace(/\/v1$/, "/v1"),
      }
      : { status: "local-rules-fallback" },
    embeddings: embeddings.configured
      ? {
        status: "configured",
        provider: embeddings.provider,
        model: embeddings.model,
        baseUrl: embeddings.baseUrl.replace(/\/v1$/, "/v1"),
      }
      : { status: "local-keyword-rules-fallback" },
  };
}

function buildReasonerPrompt(job, rules) {
  return [
    {
      role: "system",
      content:
        "You are an expert recruiter and career strategist. Evaluate a job for a specific candidate. Return only JSON.",
    },
    {
      role: "user",
      content: `Candidate profile:
${TARGET_PROFILE.baseline}

Target:
- Geography: ${TARGET_PROFILE.targetGeography}
- Compensation: ${TARGET_PROFILE.compensation}
- Avoid: ${TARGET_PROFILE.avoid}
- Outreach identity: ${TARGET_PROFILE.outreachIdentity}

Deterministic pre-analysis:
${JSON.stringify(rules, null, 2)}

Job:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || "Unknown"}
Description: ${compact(job.description, 12000)}

Score 0-100. Penalize backend IC engineering, coding-heavy interview language, citizenship/clearance-only roles, and US-only remote when the posting must remain viable from India. Reward fintech/finserv, AI product, product science, analytics leadership, data strategy, RAG/governance, startup operator fit, and explicit 120k+ USD or high-equity upside.

Return JSON with:
{
  "llm_score": number,
  "llm_reasoning": "one concise sentence",
  "is_match": boolean
}`,
    },
  ];
}

function normalizeModelResult(result) {
  const llmScore = clamp(Math.round(normalizeNumber(result?.llm_score ?? result?.llmScore, 0)), 0, 100);

  return {
    llmScore,
    llmReasoning: compact(result?.llm_reasoning || result?.llmReasoning || "No reasoning returned.", 700),
    isMatch: Boolean(result?.is_match ?? result?.isMatch ?? llmScore >= 80),
  };
}

async function callOpenAiCompatibleChat(config, messages) {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Reasoner failed with ${response.status}`);
  }

  const text = payload.choices?.[0]?.message?.content || "";
  return parseJsonObject(text);
}

export async function evaluateWithConfiguredReasoner(job, rules) {
  const config = getReasonerConfig();

  if (!config.configured) {
    return null;
  }

  const result = await callOpenAiCompatibleChat(config, buildReasonerPrompt(job, rules));
  return normalizeModelResult(result);
}

export async function fetchConfiguredEmbeddings(texts) {
  const config = getEmbeddingConfig();

  if (!config.configured) {
    return null;
  }

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      input: texts,
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Embeddings failed with ${response.status}`);
  }

  return (payload.data || [])
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding || []);
}
