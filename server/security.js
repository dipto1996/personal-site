const rateBuckets = new Map();

function cleanupBucket(bucket, windowMs, now) {
  bucket.hits = bucket.hits.filter((timestamp) => now - timestamp < windowMs);
  return bucket;
}

function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return request.socket?.remoteAddress || "unknown";
}

function getRequestOrigin(request) {
  const host = request.headers.host || "localhost:4173";
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" && forwardedProto.trim()
    ? forwardedProto.split(",")[0].trim()
    : ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].some((value) => host.includes(value))
      ? "http"
      : "https";

  return `${protocol}://${host}`;
}

function getAllowedOrigins(request) {
  const origins = new Set([getRequestOrigin(request)]);

  if (process.env.APP_URL) {
    origins.add(new URL(process.env.APP_URL).origin);
  }

  return origins;
}

export function enforceSameOrigin(request) {
  const origin = request.headers.origin;

  if (!origin) {
    return;
  }

  if (!getAllowedOrigins(request).has(origin)) {
    const error = new Error("Cross-site mutation blocked.");
    error.statusCode = 403;
    throw error;
  }
}

export function enforceRateLimit(request, key, { windowMs, max }) {
  const clientKey = `${key}:${getClientIp(request)}`;
  const bucket = cleanupBucket(rateBuckets.get(clientKey) || { hits: [] }, windowMs, Date.now());

  if (bucket.hits.length >= max) {
    const error = new Error("Rate limit exceeded.");
    error.statusCode = 429;
    throw error;
  }

  bucket.hits.push(Date.now());
  rateBuckets.set(clientKey, bucket);
}

export function enforceMutationSecurity(request, category = "write") {
  enforceSameOrigin(request);

  if (category === "auth") {
    enforceRateLimit(request, "auth", { windowMs: 60_000, max: 25 });
    return;
  }

  if (category === "lead") {
    enforceRateLimit(request, "lead", { windowMs: 60_000, max: 10 });
    return;
  }

  if (category === "cron") {
    enforceRateLimit(request, "cron", { windowMs: 60_000, max: 30 });
    return;
  }

  if (category === "analytics") {
    enforceRateLimit(request, "analytics", { windowMs: 60_000, max: 240 });
    return;
  }

  enforceRateLimit(request, "write", { windowMs: 60_000, max: 60 });
}
