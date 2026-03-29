const projects = [
  {
    name: "Settle AI",
    type: "AI + compliance",
    summary:
      "Building a compliance intelligence layer for immigration workflows, where accuracy, context, and user trust matter more than novelty.",
    problem:
      "High-stakes workflows break quickly when AI is treated like a generic chat surface.",
    built:
      "Product framing, retrieval-aware workflows, system design, and the operating model around how the product should behave under ambiguity.",
    impact: "Sets the founder narrative: serious AI for regulated work, not just AI theater.",
    repoUrl: "https://github.com/dipto1996/settle-demo",
    liveUrl: "https://settle-demo.vercel.app",
    tags: ["AI workflows", "RAG", "Compliance", "System design"],
  },
  {
    name: "American Express",
    type: "Analytics at scale",
    summary:
      "A scaled decision environment where retention modeling, experimentation, and commercial analytics have to move real business decisions.",
    problem:
      "Analytics only matter when they change decisions, not just dashboards and slide decks.",
    built:
      "Retention models, experimentation work, and commercial analytics shaped for a high-stakes financial context.",
    impact: "Built rigor around decision systems at scale before moving into founder execution.",
    repoUrl: "",
    liveUrl: "",
    tags: ["Retention models", "Experimentation", "Commercial analytics", "Decision systems"],
  },
  {
    name: "Writing, Research, and Strategy",
    type: "Thinking in public",
    summary:
      "Turning technical and product reasoning into artifacts that recruiters, founders, and investors can actually trust.",
    problem:
      "Cross-functional profiles are hard to read unless the thinking is made explicit.",
    built:
      "The structure for case studies, technical notes, and essays that show how the operating logic works.",
    impact: "Creates the authority layer that turns a portfolio into a narrative asset.",
    repoUrl: "https://github.com/dipto1996",
    liveUrl: "",
    tags: ["Writing", "Research", "Strategy", "Founder narrative"],
  },
];

const experience = [
  {
    period: "Current chapter",
    role: "Founder / Operator",
    organization: "Settle AI",
    bullets: [
      "Building AI and compliance workflows that prioritize trust, usability, and operational clarity.",
      "Working across product framing, technical direction, system design, and execution.",
      "Using Settle as the clearest proof of founder-led operator capability.",
    ],
  },
  {
    period: "Previous chapter",
    role: "Data Scientist",
    organization: "American Express",
    bullets: [
      "Worked on retention models, experimentation, and commercial analytics in a scaled decision environment.",
      "Developed judgment around how data science translates into business operating leverage.",
      "Built credibility in financial systems before moving deeper into product and startup work.",
    ],
  },
  {
    period: "Education",
    role: "Cornell Tech",
    organization: "Graduate work",
    bullets: [
      "Sharpened the bridge between technical execution, startup thinking, and product judgment.",
      "Added a venture and operator layer to an already strong quantitative background.",
    ],
  },
  {
    period: "Education",
    role: "IIT Guwahati",
    organization: "Engineering foundation",
    bullets: [
      "Built the technical base that later expanded into analytics, product, and founder execution.",
      "Established the quantitative discipline behind the later American Express and Settle chapters.",
    ],
  },
];

const ideas = [
  {
    label: "Essay seed",
    title: "What makes domain RAG actually useful",
    description:
      "A grounded view on when retrieval improves decision quality, when it adds noise, and what it takes to make it trustworthy in a compliance-heavy workflow.",
  },
  {
    label: "Case study seed",
    title: "Building Settle as a compliance intelligence layer",
    description:
      "A full breakdown of the problem, system design, product choices, and why the right framing for Settle is more than a chatbot wrapper.",
  },
  {
    label: "Operator note",
    title: "Experimentation lessons from American Express",
    description:
      "What scaled analytics work teaches about decision systems, organizational trust, and how to turn models into actual action.",
  },
];

const projectGrid = document.querySelector("[data-project-grid]");
const experienceList = document.querySelector("[data-experience-list]");
const ideasGrid = document.querySelector("[data-ideas-grid]");
const yearNode = document.querySelector("[data-year]");
const heroCanvas = document.querySelector("[data-hero-canvas]");
const heroStage = document.querySelector("[data-hero-stage]");

if (projectGrid) {
  projectGrid.innerHTML = projects
    .map(
      (project) => `
        <article class="project-card">
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
  ideasGrid.innerHTML = ideas
    .map(
      (idea) => `
        <article class="idea-card">
          <p class="idea-label">${idea.label}</p>
          <h3>${idea.title}</h3>
          <p>${idea.description}</p>
        </article>
      `,
    )
    .join("");
}

if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function setupHeroSignalField() {
  if (!heroCanvas || !heroStage || prefersReducedMotion.matches) {
    return;
  }

  const context = heroCanvas.getContext("2d");

  if (!context) {
    return;
  }

  const depthNodes = heroStage.querySelectorAll("[data-depth]");
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

  const particles = Array.from({ length: 38 }, (_, index) => ({
    orbit: index % 3,
    angle: Math.random() * Math.PI * 2,
    speed: 0.002 + Math.random() * 0.0018 + (index % 3) * 0.0009,
    radius: 0.18 + (index % 3) * 0.11 + Math.random() * 0.04,
    size: 1.6 + Math.random() * 2.6,
    drift: Math.random() * Math.PI * 2,
    hue: index % 2 === 0 ? 28 : 215,
  }));

  const pulseNodes = [
    { x: 0.22, y: 0.34, phase: 0.3 },
    { x: 0.74, y: 0.22, phase: 1.1 },
    { x: 0.8, y: 0.68, phase: 2.1 },
    { x: 0.32, y: 0.78, phase: 2.8 },
  ];

  const resizeCanvas = () => {
    width = heroStage.clientWidth;
    height = heroStage.clientHeight;
    heroCanvas.width = Math.floor(width * deviceRatio);
    heroCanvas.height = Math.floor(height * deviceRatio);
    context.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
  };

  const updatePointer = () => {
    pointer.currentX += (pointer.targetX - pointer.currentX) * 0.08;
    pointer.currentY += (pointer.targetY - pointer.currentY) * 0.08;

    depthNodes.forEach((node) => {
      const depth = Number(node.dataset.depth) || 0;
      const moveX = (pointer.currentX - 0.5) * 48 * depth;
      const moveY = (pointer.currentY - 0.5) * 48 * depth;
      node.style.transform = `translate3d(${moveX}px, ${moveY}px, 0)`;
    });
  };

  const render = (time) => {
    updatePointer();
    context.clearRect(0, 0, width, height);

    const centerX = width * (0.5 + (pointer.currentX - 0.5) * 0.12);
    const centerY = height * (0.5 + (pointer.currentY - 0.5) * 0.1);
    const maxRadius = Math.min(width, height) * 0.46;

    const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
    glow.addColorStop(0, "rgba(255, 185, 115, 0.24)");
    glow.addColorStop(0.45, "rgba(90, 145, 255, 0.12)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    [0.22, 0.34, 0.46].forEach((ratio, index) => {
      const radius = maxRadius * ratio * 2.15;

      context.save();
      context.translate(centerX, centerY);
      context.rotate(time * 0.00008 * (index + 1));
      context.strokeStyle = `rgba(255, 255, 255, ${0.06 + index * 0.02})`;
      context.lineWidth = 1;
      context.setLineDash([12 + index * 8, 16 + index * 12]);
      context.lineDashOffset = -time * 0.02 * (index + 1);
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    });

    const positions = particles.map((particle) => {
      const orbitRadius = maxRadius * (particle.radius + 0.02 * Math.sin(time * 0.0011 + particle.drift));
      const ellipseX = orbitRadius * (particle.orbit === 1 ? 1.24 : 1.02);
      const ellipseY = orbitRadius * (particle.orbit === 2 ? 0.72 : 0.92);
      const angle = particle.angle + time * particle.speed;

      return {
        x: centerX + Math.cos(angle) * ellipseX,
        y: centerY + Math.sin(angle) * ellipseY,
        size: particle.size,
        hue: particle.hue,
      };
    });

    for (let index = 0; index < positions.length; index += 1) {
      const point = positions[index];

      for (let offset = index + 1; offset < positions.length; offset += 1) {
        const candidate = positions[offset];
        const deltaX = point.x - candidate.x;
        const deltaY = point.y - candidate.y;
        const distance = Math.hypot(deltaX, deltaY);

        if (distance < 108) {
          context.strokeStyle = `rgba(255, 210, 170, ${0.15 - distance / 900})`;
          context.lineWidth = 0.9;
          context.beginPath();
          context.moveTo(point.x, point.y);
          context.lineTo(candidate.x, candidate.y);
          context.stroke();
        }
      }
    }

    pulseNodes.forEach((pulse) => {
      const baseX = width * pulse.x;
      const baseY = height * pulse.y;
      const progress = (Math.sin(time * 0.0012 + pulse.phase) + 1) / 2;
      const radius = 10 + progress * 32;

      context.strokeStyle = `rgba(255, 191, 136, ${0.32 - progress * 0.18})`;
      context.lineWidth = 1.2;
      context.beginPath();
      context.arc(baseX, baseY, radius, 0, Math.PI * 2);
      context.stroke();

      context.fillStyle = "rgba(255, 221, 196, 0.88)";
      context.beginPath();
      context.arc(baseX, baseY, 2.8, 0, Math.PI * 2);
      context.fill();
    });

    for (let beamIndex = 0; beamIndex < 5; beamIndex += 1) {
      const beamAngle = time * 0.00042 + beamIndex * ((Math.PI * 2) / 5);
      const beamLength = maxRadius * (1.35 + 0.1 * Math.sin(time * 0.0009 + beamIndex));
      const endX = centerX + Math.cos(beamAngle) * beamLength;
      const endY = centerY + Math.sin(beamAngle) * beamLength * 0.82;
      const beamGradient = context.createLinearGradient(centerX, centerY, endX, endY);

      beamGradient.addColorStop(0, "rgba(255, 255, 255, 0.02)");
      beamGradient.addColorStop(
        0.52,
        beamIndex % 2 === 0 ? "rgba(255, 195, 138, 0.22)" : "rgba(138, 173, 255, 0.2)",
      );
      beamGradient.addColorStop(1, "rgba(255, 255, 255, 0)");

      context.strokeStyle = beamGradient;
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(endX, endY);
      context.stroke();
    }

    positions.forEach((point, index) => {
      const glowRadius = point.size * 5;
      const pointGlow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, glowRadius);
      pointGlow.addColorStop(
        0,
        index % 2 === 0 ? "rgba(255, 206, 160, 0.95)" : "rgba(166, 194, 255, 0.95)",
      );
      pointGlow.addColorStop(1, "rgba(255, 255, 255, 0)");

      context.fillStyle = pointGlow;
      context.beginPath();
      context.arc(point.x, point.y, glowRadius, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = index % 2 === 0 ? "rgba(255, 222, 194, 1)" : "rgba(214, 228, 255, 1)";
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

  heroStage.addEventListener("pointermove", (event) => {
    const bounds = heroStage.getBoundingClientRect();
    pointer.targetX = (event.clientX - bounds.left) / bounds.width;
    pointer.targetY = (event.clientY - bounds.top) / bounds.height;
  });

  heroStage.addEventListener("pointerleave", () => {
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
