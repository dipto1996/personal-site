const projects = [
  {
    name: "Settle Demo",
    type: "AI product",
    description:
      "An immigration chatbot web app that combines product design, domain-heavy workflows, and an applied AI interface.",
    repoUrl: "https://github.com/dipto1996/settle-demo",
    liveUrl: "https://settle-demo.vercel.app",
    updated: "Updated November 2025",
    tags: ["JavaScript", "Immigration", "Chat UI", "Product demo"],
  },
  {
    name: "Settle GCP",
    type: "Deployment",
    description:
      "A Cloud Run-oriented version of the Settle product work, showing interest in getting complex demos deployed reliably.",
    repoUrl: "https://github.com/dipto1996/settle-gcp",
    liveUrl: "",
    updated: "Updated March 2026",
    tags: ["JavaScript", "Cloud Run", "Infrastructure", "Operations"],
  },
  {
    name: "Stakeholder Demo",
    type: "Storytelling",
    description:
      "A demo-focused web surface aimed at helping product ideas land clearly with non-technical audiences.",
    repoUrl: "https://github.com/dipto1996/stakeholder-demo",
    liveUrl: "https://stakeholder-demo.vercel.app",
    updated: "Updated November 2025",
    tags: ["JavaScript", "Demo build", "Frontend", "Stakeholders"],
  },
  {
    name: "Agency Website",
    type: "Web build",
    description:
      "A full-stack marketing website project that rounds out the more product-heavy work with branded frontend delivery.",
    repoUrl: "https://github.com/dipto1996/agency_website",
    liveUrl: "",
    updated: "Updated April 2025",
    tags: ["Full-stack", "Marketing site", "Web design"],
  },
];

const projectGrid = document.querySelector("[data-project-grid]");

if (projectGrid) {
  projectGrid.innerHTML = projects
    .map(
      (project) => `
        <article class="project-card">
          <div class="project-meta">
            <span class="project-type">${project.type}</span>
            <span class="project-date">${project.updated}</span>
          </div>
          <div class="project-copy">
            <h3>${project.name}</h3>
            <p>${project.description}</p>
          </div>
          <div class="tag-row">
            ${project.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
          </div>
          <div class="project-links">
            <a class="inline-link" href="${project.repoUrl}" target="_blank" rel="noreferrer">Repository</a>
            ${
              project.liveUrl
                ? `<a class="inline-link" href="${project.liveUrl}" target="_blank" rel="noreferrer">Live site</a>`
                : ""
            }
          </div>
        </article>
      `,
    )
    .join("");
}

const yearNode = document.querySelector("[data-year]");
if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
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
  { threshold: 0.18 },
);

document.querySelectorAll(".reveal").forEach((node) => {
  revealObserver.observe(node);
});
