document.documentElement.classList.add("js");

const configNode = document.getElementById("makhana-config");
const rawInlineConfig = configNode?.textContent ? JSON.parse(configNode.textContent) : {};
const rawConfig =
  typeof window !== "undefined" && window.MAKHANAMART_CONFIG
    ? window.MAKHANAMART_CONFIG
    : rawInlineConfig;

const siteConfig = {
  brandName: rawConfig.brandName || "Makhanamart",
  supportPhone: rawConfig.supportPhone || "",
  supportWhatsapp: rawConfig.supportWhatsapp || rawConfig.supportPhone || "",
  notificationEmails: Array.isArray(rawConfig.notificationEmails)
    ? rawConfig.notificationEmails.filter(Boolean)
    : [],
  orderWebhookUrl: rawConfig.orderWebhookUrl || "",
  sellerWebhookUrl: rawConfig.sellerWebhookUrl || "",
};

const body = document.body;
const topbar = document.querySelector("[data-topbar]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const revealNodes = document.querySelectorAll(".reveal");
const forms = document.querySelectorAll(".trade-form");

const digitsOnly = (value) => value.replace(/[^\d]/g, "");

const formatEmailList = (emails) => {
  if (!emails.length) {
    return "Add real notification emails in the page config.";
  }

  if (emails.length === 1) {
    return emails[0];
  }

  return `${emails.slice(0, -1).join(", ")} and ${emails.at(-1)}`;
};

const applyConfigToPage = () => {
  document.querySelectorAll("[data-brand-name]").forEach((node) => {
    node.textContent = siteConfig.brandName;
  });

  document.querySelectorAll("[data-support-phone-text]").forEach((node) => {
    node.textContent = siteConfig.supportPhone || "Add supportPhone in config";
  });

  document.querySelectorAll("[data-support-phone-link]").forEach((node) => {
    node.setAttribute("href", siteConfig.supportPhone ? `tel:${siteConfig.supportPhone}` : "#");
  });

  const whatsappLink = siteConfig.supportWhatsapp
    ? `https://wa.me/${digitsOnly(siteConfig.supportWhatsapp)}`
    : "#";

  document.querySelectorAll("[data-whatsapp-link]").forEach((node) => {
    node.setAttribute("href", whatsappLink);
    if (whatsappLink !== "#") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noreferrer");
    }
  });

  document.querySelectorAll("[data-notification-emails]").forEach((node) => {
    node.textContent = formatEmailList(siteConfig.notificationEmails);
  });

  document.querySelectorAll("[data-optional-phone]").forEach((node) => {
    node.hidden = !siteConfig.supportPhone;
  });

  document.querySelectorAll("[data-optional-whatsapp]").forEach((node) => {
    node.hidden = !siteConfig.supportWhatsapp;
  });
};

const setupActiveNav = () => {
  const currentPage = body.dataset.page;
  if (!currentPage) {
    return;
  }

  document.querySelectorAll("[data-nav-page]").forEach((link) => {
    if (link.dataset.navPage === currentPage) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
  });
};

const setupMobileMenu = () => {
  if (!menuToggle) {
    return;
  }

  menuToggle.addEventListener("click", () => {
    const isOpen = body.classList.toggle("menu-open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  document.querySelectorAll(".nav a").forEach((link) => {
    link.addEventListener("click", () => {
      body.classList.remove("menu-open");
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });
};

const setupTopbarState = () => {
  if (!topbar) {
    return;
  }

  const syncTopbar = () => {
    topbar.classList.toggle("is-condensed", window.scrollY > 18);
  };

  syncTopbar();
  window.addEventListener("scroll", syncTopbar, { passive: true });
};

const setupRevealAnimations = () => {
  if (!("IntersectionObserver" in window)) {
    revealNodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }

  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );

  revealNodes.forEach((node) => revealObserver.observe(node));
};

const getRequestId = (prefix) => {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12);
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
};

const getWebhookUrl = (formType) =>
  formType === "seller" ? siteConfig.sellerWebhookUrl : siteConfig.orderWebhookUrl;

const serializePayload = (form, formType) => {
  const formData = new FormData(form);
  const requestId = getRequestId(formType === "seller" ? "SELL" : "BUY");

  return {
    requestId,
    formType,
    submittedAt: new Date().toISOString(),
    brandName: siteConfig.brandName,
    notificationEmails: siteConfig.notificationEmails,
    supportPhone: siteConfig.supportPhone,
    supportWhatsapp: siteConfig.supportWhatsapp,
    data: {
      fullName: formData.get("fullName")?.toString().trim() || "",
      company: formData.get("company")?.toString().trim() || "",
      email: formData.get("email")?.toString().trim() || "",
      phone: formData.get("phone")?.toString().trim() || "",
      grade: formData.get("grade")?.toString().trim() || "",
      quantity: formData.get("quantity")?.toString().trim() || "",
      packaging: formData.get("packaging")?.toString().trim() || "",
      destination: formData.get("destination")?.toString().trim() || "",
      notes: formData.get("notes")?.toString().trim() || "",
    },
  };
};

const buildMailtoLink = (payload) => {
  if (!siteConfig.notificationEmails.length) {
    return "";
  }

  const { data, requestId, formType } = payload;
  const subject = encodeURIComponent(
    `${siteConfig.brandName} | ${formType === "seller" ? "Stock offer" : "Buying requirement"} | ${requestId}`,
  );

  const lines = [
    `Request ID: ${requestId}`,
    `Form type: ${formType}`,
    `Submitted at: ${payload.submittedAt}`,
    "",
    `Name: ${data.fullName}`,
    `Company: ${data.company || "-"}`,
    `Email: ${data.email || "-"}`,
    `Phone: ${data.phone}`,
    `Grade / stock: ${data.grade}`,
    `Quantity: ${data.quantity}`,
    `Packaging / service need: ${data.packaging}`,
    `Destination / location: ${data.destination}`,
    "",
    "Notes:",
    data.notes || "-",
  ];

  const bodyText = encodeURIComponent(lines.join("\n"));
  return `mailto:${siteConfig.notificationEmails.join(",")}?subject=${subject}&body=${bodyText}`;
};

const setStatus = (form, message, isError = false) => {
  const statusNode = form.querySelector("[data-form-status]");
  if (!statusNode) {
    return;
  }

  statusNode.textContent = message;
  statusNode.classList.toggle("is-error", isError);
};

const postPayload = async (payload, webhookUrl) => {
  if (!webhookUrl) {
    return { sentViaWebhook: false };
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook failed with status ${response.status}`);
  }

  return response.json().catch(() => ({ sentViaWebhook: true }));
};

const handleSubmit = async (event) => {
  event.preventDefault();

  const form = event.currentTarget;
  const formType = form.dataset.formType || "buyer";
  const submitButton = form.querySelector('button[type="submit"]');
  const originalLabel = submitButton?.textContent || "Submit";
  const payload = serializePayload(form, formType);
  const webhookUrl = getWebhookUrl(formType);
  const mailtoLink = buildMailtoLink(payload);

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";
  }

  setStatus(form, "");

  try {
    const result = await postPayload(payload, webhookUrl);

    form.reset();
    setStatus(
      form,
      result?.leadId
        ? `Request ${payload.requestId} submitted. Lead ${result.leadId} was recorded.`
        : `Request ${payload.requestId} submitted. Our team can now review it.`,
    );
  } catch (error) {
    if (mailtoLink) {
      window.location.href = mailtoLink;
      setStatus(
        form,
        `Live submission failed, so an email draft was opened for ${payload.requestId}.`,
      );
    } else {
      setStatus(
        form,
        `Submission failed for ${payload.requestId}. Add a working webhook or notification email.`,
        true,
      );
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  }
};

applyConfigToPage();
setupActiveNav();
setupMobileMenu();
setupTopbarState();
setupRevealAnimations();

forms.forEach((form) => {
  form.addEventListener("submit", handleSubmit);
});
