import { getPersistenceMode } from "./persistence.js";

function hasValue(value) {
  return Boolean(String(value || "").trim());
}

export function getAppUrl(request = null) {
  if (hasValue(process.env.APP_URL)) {
    return process.env.APP_URL.trim();
  }

  if (hasValue(process.env.VERCEL_URL)) {
    return `https://${process.env.VERCEL_URL.trim()}`;
  }

  const host = request?.headers?.host || "localhost:4173";
  const localHosts = ["localhost", "127.0.0.1", "0.0.0.0"];
  const protocol = localHosts.some((value) => host.includes(value)) ? "http" : "https";
  return `${protocol}://${host}`;
}

export function getRuntimeStatus(request = null) {
  const deploymentMode = process.env.VERCEL ? "vercel" : "local";
  const environment = process.env.NODE_ENV || (deploymentMode === "vercel" ? "production" : "development");
  const billingConfigured = hasValue(process.env.STRIPE_SECRET_KEY);
  const emailConfigured = hasValue(process.env.RESEND_API_KEY) && hasValue(process.env.ALERT_FROM_EMAIL);

  return {
    appUrl: getAppUrl(request),
    environment,
    deploymentMode,
    authMode: "local-workspace",
    persistenceMode: getPersistenceMode(),
    providers: [
      {
        key: "database",
        label: "Postgres",
        status: hasValue(process.env.DATABASE_URL) ? "configured" : "fallback",
        note: hasValue(process.env.DATABASE_URL)
          ? "Neon/Postgres persistence is configured."
          : "Using local JSON persistence until DATABASE_URL is set.",
      },
      {
        key: "email",
        label: "Resend",
        status: emailConfigured ? "configured" : "not_configured",
        note: emailConfigured
          ? "Transactional alert delivery is enabled."
          : "Alert tests fall back to preview mode until RESEND_API_KEY and ALERT_FROM_EMAIL are set.",
      },
      {
        key: "billing",
        label: "Stripe",
        status: billingConfigured ? "configured" : "simulated",
        note: billingConfigured
          ? "Checkout sessions use Stripe when a plan upgrade is requested."
          : "Plan upgrades run in local simulation mode until STRIPE_SECRET_KEY is set.",
      },
      {
        key: "cron",
        label: "Vercel Cron",
        status: hasValue(process.env.CRON_SECRET) ? "configured" : "not_configured",
        note: hasValue(process.env.CRON_SECRET)
          ? "Source sync and automated alert delivery can run from a protected cron endpoint."
          : "Manual source refresh works now; set CRON_SECRET to enable scheduled sync.",
      },
    ],
  };
}
