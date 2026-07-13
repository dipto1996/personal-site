import { mountCompanyGraph } from "./apps/companygraph/index.js";
import { mountExportPulse } from "./apps/exportpulse/index.js";
import { mountJobSearch } from "./apps/jobsearch/index.js";
import { mountTenderRadar } from "./apps/tenderradar/index.js";
import { mountControlCenter } from "./apps/tradegraph/ui/control-center.js";
import { mountVerifySME } from "./apps/verifysme/index.js";
import {
  dashboards,
  experience,
  projects,
  solutions,
  useCases,
  writingEntries,
} from "./lib/site-content.js";
import { mountAuthControls } from "./lib/workspace-client.js";

const projectGrid = document.querySelector("[data-project-grid]");
const experienceList = document.querySelector("[data-experience-list]");
const ideasGrid = document.querySelector("[data-ideas-grid]");
const writingLibrary = document.querySelector("[data-writing-library]");
const dashboardGrid = document.querySelector("[data-dashboard-grid]");
const solutionGrid = document.querySelector("[data-solution-grid]");
const useCaseGrid = document.querySelector("[data-usecase-grid]");
const yearNode = document.querySelector("[data-year]");
const heroCanvas = document.querySelector("[data-hero-canvas]");
const heroSection = document.querySelector(".hero");
const companyGraphRoot = document.querySelector("[data-company-graph-app]");
const tenderRadarRoot = document.querySelector("[data-tenderradar-app]");
const verifySMERoot = document.querySelector("[data-verifysme-app]");
const exportPulseRoot = document.querySelector("[data-exportpulse-app]");
const jobSearchRoot = document.querySelector("[data-job-search-app]");
const controlCenterRoots = [...document.querySelectorAll("[data-control-center-app]")];
const topbar = document.querySelector(".topbar");
const currentPage = document.body.dataset.page;
const leadForms = [...document.querySelectorAll("[data-lead-form]")];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

if (currentPage) {
  document.querySelectorAll("[data-page-target]").forEach((link) => {
    if (link.dataset.pageTarget === currentPage) {
      link.classList.add("is-current");
      link.setAttribute("aria-current", "page");
    }
  });
}

if (projectGrid) {
  projectGrid.innerHTML = projects
    .map(
      (project, index) => `
        <article class="project-card ${index === 0 ? "project-card--feature" : ""}">
          <div class="project-heading">
            <div class="project-meta">
              <span class="project-type">${project.type}</span>
            </div>
            <h3>${project.name}</h3>
            <p class="project-summary">${project.summary}</p>
          </div>
          <div class="project-body">
            <ul class="project-detail">
              <li><strong>Problem:</strong> ${project.problem}</li>
              <li><strong>Built:</strong> ${project.built}</li>
              <li><strong>Why it matters:</strong> ${project.impact}</li>
            </ul>
            <div class="tag-row">
              ${project.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
            </div>
            <div class="project-links">
              ${
                project.repoUrl
                  ? `<a class="inline-link" href="${project.repoUrl}" target="_blank" rel="noreferrer">Reference</a>`
                  : ""
              }
              ${
                project.liveUrl
                  ? `<a class="inline-link" href="${project.liveUrl}" target="_blank" rel="noreferrer">Live product</a>`
                  : ""
              }
            </div>
          </div>
        </article>
      `,
    )
    .join("");
}

if (experienceList) {
  experienceList.innerHTML = experience
    .map(
      (item) => `
        <article class="experience-item">
          <div class="experience-meta">
            <span class="experience-period">${item.period}</span>
            <h3>${item.role}</h3>
            <p class="experience-org">${item.organization}</p>
          </div>
          <div class="experience-copy">
            <ul class="experience-bullets">
              ${item.bullets.map((bullet) => `<li>${bullet}</li>`).join("")}
            </ul>
          </div>
        </article>
      `,
    )
    .join("");
}

if (ideasGrid) {
  ideasGrid.innerHTML = writingEntries
    .map(
      (entry) => `
        <article class="idea-card">
          <p class="idea-label">${entry.label}</p>
          <h3>${entry.title}</h3>
          <p>${entry.description}</p>
          <div class="idea-meta">
            <span>${entry.readTime}</span>
            <a class="inline-link" href="#${entry.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}">Read note</a>
          </div>
        </article>
      `,
    )
    .join("");
}

if (writingLibrary) {
  writingLibrary.innerHTML = writingEntries
    .map(
      (entry) => `
        <article class="writing-entry" id="${entry.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}">
          <div class="writing-entry-head">
            <div>
              <p class="idea-label">${entry.label}</p>
              <h2>${entry.title}</h2>
            </div>
            <span class="writing-read-time">${entry.readTime}</span>
          </div>
          <p class="writing-thesis">${entry.thesis}</p>
          <div class="writing-sections">
            ${entry.sections
              .map(
                (section) => `
                  <section class="writing-section-block">
                    <h3>${section.heading}</h3>
                    ${section.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("")}
                  </section>
                `,
              )
              .join("")}
          </div>
          <div class="writing-entry-actions">
            <a class="button button-secondary" href="${entry.callToAction.href}">${entry.callToAction.label}</a>
          </div>
        </article>
      `,
    )
    .join("");
}

if (dashboardGrid) {
  dashboardGrid.innerHTML = dashboards
    .map(
      (dashboard) => `
        <article class="subtle-card">
          <p class="subtle-label">${dashboard.label}</p>
          <h3>${dashboard.title}</h3>
          <p>${dashboard.description}</p>
        </article>
      `,
    )
    .join("");
}

if (solutionGrid) {
  solutionGrid.innerHTML = solutions
    .map(
      (solution) => `
        <article class="tradegraph-module-card product-module-card">
          <p class="subtle-label">${solution.label}</p>
          <h3>${solution.title}</h3>
          <p>${solution.description}</p>
          <div class="product-module-meta">
            <div>
              <span>Best for</span>
              <strong>${solution.buyer}</strong>
            </div>
            <div>
              <span>Answers</span>
              <strong>${solution.question}</strong>
            </div>
          </div>
          <a class="product-module-link" href="${solution.href}">Open module</a>
        </article>
      `,
    )
    .join("");
}

if (useCaseGrid) {
  useCaseGrid.innerHTML = useCases
    .map(
      (item) => `
        <article class="subtle-card">
          <p class="subtle-label">Use case</p>
          <h3>${item.title}</h3>
          <p>${item.summary}</p>
          <p class="subtle-outcome">${item.outcome}</p>
        </article>
      `,
    )
    .join("");
}

if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

function prefillLeadForm(form) {
  const params = new URLSearchParams(window.location.search);
  const reasonInput = form.querySelector('[name="reason"]');
  const productInput = form.querySelector('[name="product"]');
  const messageInput = form.querySelector('[name="message"]');
  const sourcePageInput = form.querySelector('[name="sourcePage"]');

  if (reasonInput && params.get("intent")) {
    reasonInput.value = params.get("intent");
  }

  if (productInput && params.get("product")) {
    productInput.value = params.get("product");
  }

  if (messageInput && !messageInput.value) {
    const source = params.get("source");
    const intent = params.get("intent");
    const product = params.get("product");
    const prompt = [
      intent ? `Intent: ${intent.replaceAll("-", " ")}` : "",
      product ? `Product: ${product}` : "",
      source ? `Source page: ${source}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (prompt) {
      messageInput.value = `${prompt}\n\nContext:\n`;
    }
  }

  if (sourcePageInput) {
    sourcePageInput.value = params.get("source") || window.location.pathname;
  }
}

function buildLeadFallbackMailto(formData) {
  const subject = encodeURIComponent(
    `Personal site lead: ${formData.get("reason") || "general"}${formData.get("product") ? ` / ${formData.get("product")}` : ""}`,
  );
  const body = encodeURIComponent(
    [
      `Name: ${formData.get("name") || ""}`,
      `Email: ${formData.get("email") || ""}`,
      `Company: ${formData.get("company") || ""}`,
      `Reason: ${formData.get("reason") || ""}`,
      `Product: ${formData.get("product") || ""}`,
      `Timeline: ${formData.get("timeline") || ""}`,
      `Source page: ${formData.get("sourcePage") || window.location.pathname}`,
      "",
      String(formData.get("message") || ""),
    ].join("\n"),
  );

  return `mailto:roydiptopal1996@gmail.com?subject=${subject}&body=${body}`;
}

leadForms.forEach((form) => {
  prefillLeadForm(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const statusNode = form.querySelector("[data-lead-status]");
    const submitButton = form.querySelector('[type="submit"]');
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const fallbackMailto = buildLeadFallbackMailto(formData);

    if (statusNode) {
      statusNode.textContent = "Submitting lead…";
      statusNode.dataset.state = "loading";
    }

    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = true;
    }

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Lead submission failed.");
      }

      if (statusNode) {
        statusNode.textContent =
          result.delivery?.mode === "email"
            ? "Lead saved and notification email sent."
            : `Lead saved. Email delivery is not configured here, so use the direct fallback if needed: ${fallbackMailto}`;
        statusNode.dataset.state = "success";
      }

      form.reset();
      prefillLeadForm(form);
    } catch (error) {
      if (statusNode) {
        statusNode.textContent = `${error.message} Use direct email if needed: ${fallbackMailto}`;
        statusNode.dataset.state = "error";
      }
    } finally {
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
      }
    }
  });
});

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function setupHeroSignalField() {
  if (!heroCanvas || !heroSection || prefersReducedMotion.matches) {
    return;
  }

  const context = heroCanvas.getContext("2d");

  if (!context) {
    return;
  }

  const pointer = {
    currentX: 0.5,
    currentY: 0.5,
    targetX: 0.5,
    targetY: 0.5,
  };

  const deviceRatio = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  let animationFrame = null;

  const nodes = Array.from({ length: 18 }, (_, index) => ({
    baseX: 0.12 + Math.random() * 0.76,
    baseY: 0.16 + Math.random() * 0.64,
    driftX: (Math.random() - 0.5) * 0.05,
    driftY: (Math.random() - 0.5) * 0.05,
    phase: Math.random() * Math.PI * 2,
    speed: 0.00045 + Math.random() * 0.00035,
    size: 2 + Math.random() * 2.4,
    warm: index % 2 === 0,
  }));

  const tracks = [
    { base: 0.18, amp: 0.055, freq: 1.28, speed: 0.00019, warm: true },
    { base: 0.36, amp: 0.072, freq: 1.02, speed: 0.00014, warm: false },
    { base: 0.58, amp: 0.065, freq: 1.16, speed: 0.00016, warm: true },
    { base: 0.8, amp: 0.06, freq: 0.9, speed: 0.00013, warm: false },
  ];

  const resizeCanvas = () => {
    width = heroSection.clientWidth;
    height = heroSection.clientHeight;
    heroCanvas.width = Math.floor(width * deviceRatio);
    heroCanvas.height = Math.floor(height * deviceRatio);
    context.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
  };

  const updatePointer = () => {
    pointer.currentX += (pointer.targetX - pointer.currentX) * 0.08;
    pointer.currentY += (pointer.targetY - pointer.currentY) * 0.08;
  };

  const trackY = (track, progress, time) => {
    const phaseA = progress * Math.PI * 2 * track.freq + time * track.speed;
    const phaseB = progress * Math.PI * 2 * (track.freq * 0.56) + time * track.speed * 0.68;
    const pointerOffset = (pointer.currentY - 0.5) * height * 0.08;

    return (
      height * track.base +
      Math.sin(phaseA) * height * track.amp +
      Math.cos(phaseB) * height * track.amp * 0.42 +
      pointerOffset
    );
  };

  const nodePosition = (node, time) => {
    const drift = Math.sin(time * node.speed + node.phase);
    const driftSecondary = Math.cos(time * node.speed * 0.82 + node.phase);

    return {
      x:
        width *
        (node.baseX + node.driftX * drift + (pointer.currentX - 0.5) * 0.04),
      y:
        height *
        (node.baseY + node.driftY * driftSecondary + (pointer.currentY - 0.5) * 0.05),
      size: node.size,
      warm: node.warm,
    };
  };

  const render = (timestamp) => {
    const time = timestamp;
    updatePointer();
    context.clearRect(0, 0, width, height);

    const glowCenterX = width * (0.58 + (pointer.currentX - 0.5) * 0.12);
    const glowCenterY = height * (0.48 + (pointer.currentY - 0.5) * 0.1);
    const glowRadius = Math.min(width, height) * 0.65;
    const ambientGlow = context.createRadialGradient(
      glowCenterX,
      glowCenterY,
      0,
      glowCenterX,
      glowCenterY,
      glowRadius,
    );

    ambientGlow.addColorStop(0, "rgba(101, 132, 229, 0.16)");
    ambientGlow.addColorStop(0.48, "rgba(209, 145, 89, 0.08)");
    ambientGlow.addColorStop(1, "rgba(0, 0, 0, 0)");

    context.fillStyle = ambientGlow;
    context.fillRect(0, 0, width, height);

    const sweepProgress = ((time * 0.00008) % 1 + 1) % 1;
    const sweepX = sweepProgress * width;
    const sweep = context.createLinearGradient(sweepX - 120, 0, sweepX + 120, 0);
    sweep.addColorStop(0, "rgba(255, 255, 255, 0)");
    sweep.addColorStop(0.5, "rgba(255, 255, 255, 0.045)");
    sweep.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = sweep;
    context.fillRect(0, 0, width, height);

    tracks.forEach((track, trackIndex) => {
      const gradient = context.createLinearGradient(0, 0, width, height * track.base);
      const warmColorA = "rgba(228, 162, 108, 0.16)";
      const warmColorB = "rgba(255, 207, 168, 0.26)";
      const coolColorA = "rgba(108, 138, 228, 0.14)";
      const coolColorB = "rgba(181, 204, 255, 0.18)";

      gradient.addColorStop(0, track.warm ? warmColorA : coolColorA);
      gradient.addColorStop(0.5, track.warm ? warmColorB : coolColorB);
      gradient.addColorStop(1, track.warm ? warmColorA : coolColorA);

      context.strokeStyle = gradient;
      context.lineWidth = 1.2 + trackIndex * 0.25;
      context.beginPath();

      for (let step = 0; step <= 72; step += 1) {
        const progress = step / 72;
        const x = progress * width;
        const y = trackY(track, progress, time);

        if (step === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.stroke();

      for (let pulseIndex = 0; pulseIndex < 4; pulseIndex += 1) {
        const progress = ((time * track.speed * 0.06 + pulseIndex / 4 + trackIndex * 0.11) % 1 + 1) % 1;
        const x = progress * width;
        const y = trackY(track, progress, time);
        const pulseGlow = context.createRadialGradient(x, y, 0, x, y, 20);

        pulseGlow.addColorStop(
          0,
          track.warm ? "rgba(255, 222, 190, 0.92)" : "rgba(214, 228, 255, 0.9)",
        );
        pulseGlow.addColorStop(1, "rgba(255, 255, 255, 0)");

        context.fillStyle = pulseGlow;
        context.beginPath();
        context.arc(x, y, 20, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = track.warm ? "rgba(255, 233, 210, 1)" : "rgba(227, 236, 255, 1)";
        context.beginPath();
        context.arc(x, y, 2.3, 0, Math.PI * 2);
        context.fill();
      }
    });

    const positions = nodes.map((node) => nodePosition(node, time));

    for (let index = 0; index < positions.length; index += 1) {
      const point = positions[index];

      for (let offset = index + 1; offset < positions.length; offset += 1) {
        const candidate = positions[offset];
        const deltaX = point.x - candidate.x;
        const deltaY = point.y - candidate.y;
        const distance = Math.hypot(deltaX, deltaY);

        if (distance < 132) {
          context.strokeStyle =
            point.warm || candidate.warm
              ? `rgba(228, 162, 108, ${0.14 - distance / 1400})`
              : `rgba(108, 138, 228, ${0.14 - distance / 1400})`;
          context.lineWidth = 0.85;
          context.beginPath();
          context.moveTo(point.x, point.y);
          context.lineTo(candidate.x, candidate.y);
          context.stroke();
        }
      }
    }

    const ringAnchors = [
      { x: width * 0.68, y: height * 0.29, warm: true, phase: 0 },
      { x: width * 0.74, y: height * 0.73, warm: false, phase: Math.PI * 0.8 },
    ];

    ringAnchors.forEach((anchor) => {
      const progress = (Math.sin(time * 0.0012 + anchor.phase) + 1) / 2;
      const radius = 18 + progress * 22;

      context.strokeStyle = anchor.warm
        ? `rgba(228, 162, 108, ${0.22 - progress * 0.12})`
        : `rgba(108, 138, 228, ${0.22 - progress * 0.12})`;
      context.lineWidth = 1.1;
      context.beginPath();
      context.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
      context.stroke();

      context.fillStyle = anchor.warm ? "rgba(255, 224, 196, 0.9)" : "rgba(222, 233, 255, 0.9)";
      context.beginPath();
      context.arc(anchor.x, anchor.y, 2.6, 0, Math.PI * 2);
      context.fill();
    });

    positions.forEach((point) => {
      const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, point.size * 6);
      glow.addColorStop(
        0,
        point.warm ? "rgba(255, 214, 182, 0.92)" : "rgba(210, 226, 255, 0.92)",
      );
      glow.addColorStop(1, "rgba(255, 255, 255, 0)");

      context.fillStyle = glow;
      context.beginPath();
      context.arc(point.x, point.y, point.size * 6, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = point.warm ? "rgba(255, 236, 219, 1)" : "rgba(231, 239, 255, 1)";
      context.beginPath();
      context.arc(point.x, point.y, point.size, 0, Math.PI * 2);
      context.fill();
    });

    animationFrame = window.requestAnimationFrame(render);
  };

  const startAnimation = () => {
    if (animationFrame === null) {
      animationFrame = window.requestAnimationFrame(render);
    }
  };

  const stopAnimation = () => {
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  };

  heroSection.addEventListener("pointermove", (event) => {
    const bounds = heroSection.getBoundingClientRect();
    pointer.targetX = (event.clientX - bounds.left) / bounds.width;
    pointer.targetY = (event.clientY - bounds.top) / bounds.height;
  });

  heroSection.addEventListener("pointerleave", () => {
    pointer.targetX = 0.5;
    pointer.targetY = 0.5;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAnimation();
    } else {
      startAnimation();
    }
  });

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  startAnimation();
}

setupHeroSignalField();
mountAuthControls(topbar);
mountCompanyGraph(companyGraphRoot);
mountVerifySME(verifySMERoot);
mountTenderRadar(tenderRadarRoot);
mountExportPulse(exportPulseRoot);
mountJobSearch(jobSearchRoot);
controlCenterRoots.forEach((root) => mountControlCenter(root));
