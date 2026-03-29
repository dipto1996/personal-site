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

if (projectGrid) {
  projectGrid.innerHTML = projects
    .map(
      (project, index) => `
        <article class="project-card${index === 0 ? " project-card-featured" : ""}">
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

const yearNode = document.querySelector("[data-year]");
if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}
