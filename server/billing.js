import { nowIso, readDb, updateDb } from "./persistence.js";

const PLAN_CATALOG = [
  {
    key: "free",
    label: "Free",
    monthlyUsd: 0,
    alertLimit: 1,
    seatsIncluded: 1,
    automatedAlerts: false,
    features: [
      "Manual source refresh",
      "1 saved alert rule",
      "Workspace persistence",
    ],
  },
  {
    key: "pro",
    label: "Pro",
    monthlyUsd: 79,
    alertLimit: 10,
    seatsIncluded: 5,
    automatedAlerts: true,
    features: [
      "10 saved alert rules",
      "Scheduled alert delivery",
      "Shared workspace and invite flow",
    ],
  },
  {
    key: "enterprise",
    label: "Enterprise",
    monthlyUsd: 299,
    alertLimit: 50,
    seatsIncluded: 25,
    automatedAlerts: true,
    features: [
      "50 saved alert rules",
      "Priority onboarding",
      "Custom data adapter support",
    ],
  },
];

function normalizePlanKey(planKey) {
  const normalized = String(planKey || "free").trim().toLowerCase();
  return PLAN_CATALOG.some((plan) => plan.key === normalized) ? normalized : "free";
}

export function listPlans() {
  return PLAN_CATALOG.map((plan) => ({ ...plan }));
}

export function getPlanDefinition(planKey = "free") {
  return PLAN_CATALOG.find((plan) => plan.key === normalizePlanKey(planKey)) || PLAN_CATALOG[0];
}

function buildDefaultSubscription(workspaceId, billingEmail = "") {
  return {
    workspaceId,
    planKey: "free",
    status: "active",
    seats: 1,
    billingEmail: billingEmail || null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function decorateSubscription(subscription) {
  const plan = getPlanDefinition(subscription.planKey);

  return {
    ...subscription,
    plan,
    canUseAutomatedAlerts: plan.automatedAlerts,
    alertLimit: plan.alertLimit,
    seatsIncluded: plan.seatsIncluded,
  };
}

export async function getWorkspaceSubscription(workspaceId, billingEmail = "") {
  const db = await readDb();
  const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);

  if (!subscription) {
    return decorateSubscription(buildDefaultSubscription(workspaceId, billingEmail));
  }

  return decorateSubscription({
    ...buildDefaultSubscription(workspaceId, billingEmail),
    ...subscription,
    billingEmail: subscription.billingEmail || billingEmail || null,
  });
}

export async function upsertWorkspaceSubscription(workspaceId, patch = {}, billingEmail = "") {
  const subscription = await updateDb((db) => {
    const existing = db.subscriptions.find((item) => item.workspaceId === workspaceId);
    const next = {
      ...(existing || buildDefaultSubscription(workspaceId, billingEmail)),
      ...patch,
      workspaceId,
      planKey: normalizePlanKey(patch.planKey || existing?.planKey || "free"),
      updatedAt: nowIso(),
      createdAt: existing?.createdAt || nowIso(),
    };

    db.subscriptions = db.subscriptions.filter((item) => item.workspaceId !== workspaceId);
    db.subscriptions.push(next);
    return db;
  });

  const next = subscription.subscriptions.find((item) => item.workspaceId === workspaceId);
  return decorateSubscription(next || buildDefaultSubscription(workspaceId, billingEmail));
}

export async function assertAlertCapacity(workspaceId) {
  const db = await readDb();
  const subscription = await getWorkspaceSubscription(workspaceId);
  const count = db.alertRules.filter((item) => item.workspaceId === workspaceId).length;

  if (count >= subscription.alertLimit) {
    throw new Error(
      `The ${subscription.plan.label} plan supports ${subscription.alertLimit} saved alert${subscription.alertLimit === 1 ? "" : "s"}. Upgrade the workspace plan to save more.`,
    );
  }
}

export async function changePlanLocally(workspaceId, planKey, billingEmail = "") {
  const plan = getPlanDefinition(planKey);
  const subscription = await upsertWorkspaceSubscription(
    workspaceId,
    {
      planKey: plan.key,
      status: "active",
      seats: plan.seatsIncluded,
      billingEmail: billingEmail || null,
      stripeCheckoutSessionId: null,
    },
    billingEmail,
  );

  return {
    mode: "simulated",
    message:
      plan.key === "free"
        ? "Workspace moved to the Free plan."
        : `Stripe is not configured, so ${plan.label} was applied in local simulation mode.`,
    subscription,
  };
}

async function stripeRequest(pathname, params = null) {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  const response = await fetch(`https://api.stripe.com${pathname}`, {
    method: params ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${secretKey}`,
      ...(params
        ? {
            "content-type": "application/x-www-form-urlencoded",
          }
        : {}),
    },
    body: params ? params.toString() : undefined,
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error?.message || "Stripe request failed.");
  }

  return payload;
}

export async function startCheckoutSession({
  workspaceId,
  billingEmail,
  planKey,
  successUrl,
  cancelUrl,
}) {
  const plan = getPlanDefinition(planKey);

  if (plan.key === "free") {
    return changePlanLocally(workspaceId, "free", billingEmail);
  }

  if (plan.key === "enterprise") {
    const subscription = await upsertWorkspaceSubscription(
      workspaceId,
      {
        planKey: plan.key,
        status: "contact_sales",
        seats: plan.seatsIncluded,
        billingEmail: billingEmail || null,
      },
      billingEmail,
    );

    return {
      mode: "contact_sales",
      message: "Enterprise plan requests are routed through a manual sales workflow.",
      subscription,
    };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return changePlanLocally(workspaceId, plan.key, billingEmail);
  }

  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("customer_creation", "always");
  if (billingEmail) {
    params.set("customer_email", billingEmail);
  }
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(plan.monthlyUsd * 100));
  params.set("line_items[0][price_data][recurring][interval]", "month");
  params.set("line_items[0][price_data][product_data][name]", `TradeGraph India ${plan.label}`);
  params.set(
    "line_items[0][price_data][product_data][description]",
    `Workspace plan for ${plan.alertLimit} saved alerts and shared procurement/export workflows.`,
  );
  params.set("metadata[workspaceId]", workspaceId);
  params.set("metadata[planKey]", plan.key);
  params.set("subscription_data[metadata][workspaceId]", workspaceId);
  params.set("subscription_data[metadata][planKey]", plan.key);

  const session = await stripeRequest("/v1/checkout/sessions", params);
  const subscription = await upsertWorkspaceSubscription(
    workspaceId,
    {
      planKey: plan.key,
      status: "checkout_pending",
      seats: plan.seatsIncluded,
      billingEmail: billingEmail || null,
      stripeCheckoutSessionId: session.id,
    },
    billingEmail,
  );

  return {
    mode: "stripe",
    checkoutUrl: session.url,
    subscription,
  };
}

export async function refreshSubscriptionFromProvider(workspaceId) {
  const subscription = await getWorkspaceSubscription(workspaceId);

  if (!process.env.STRIPE_SECRET_KEY || !subscription.stripeCheckoutSessionId) {
    return subscription;
  }

  const session = await stripeRequest(`/v1/checkout/sessions/${subscription.stripeCheckoutSessionId}`);

  if (session.status !== "complete") {
    return subscription;
  }

  return upsertWorkspaceSubscription(workspaceId, {
    status: "active",
    stripeCustomerId: session.customer || null,
    stripeSubscriptionId: session.subscription || null,
  });
}
