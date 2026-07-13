export const projects = [
  {
    name: "TradeGraph",
    type: "Product suite",
    summary:
      "A decision workspace for supplier diligence, tender qualification, and export route planning built around one shared evidence graph.",
    problem:
      "Operators do not need another fragmented dashboard. They need a usable path from company trust to bid/no-bid and market-entry decisions.",
    built:
      "Three connected products, shared provenance-aware scoring, route handoffs, ops tooling, and a buyer-facing product surface.",
    impact:
      "Makes product judgment, data modeling, and workflow design inspectable in the browser instead of leaving them as abstract claims.",
    repoUrl: "https://github.com/dipto1996/personal-site",
    liveUrl: "./tradegraph/index.html",
    tags: ["Product proof", "Workflow design", "Data + UX", "Decision systems"],
  },
  {
    name: "Settle AI",
    type: "AI + compliance",
    summary:
      "A compliance intelligence layer for immigration workflows where trust, explainability, and operational behavior matter more than novelty.",
    problem:
      "High-stakes AI breaks when the product is treated like a generic chat wrapper instead of a controlled decision workflow.",
    built:
      "Product framing, retrieval-aware workflow logic, system design, and operator-facing product behavior for regulated work.",
    impact:
      "Demonstrates how AI products should be shaped when correctness and user trust are part of the product itself.",
    repoUrl: "https://github.com/dipto1996/settle-demo",
    liveUrl: "https://settle-demo.vercel.app",
    tags: ["AI workflows", "RAG", "Compliance", "System design"],
  },
  {
    name: "American Express",
    type: "Analytics at scale",
    summary:
      "Scaled experimentation, retention modeling, and commercial analytics in a real financial decision environment.",
    problem:
      "Analytics only matter when they influence business decisions instead of remaining trapped in decks and dashboards.",
    built:
      "Retention models, experimentation work, and decision support inside a high-stakes commercial system.",
    impact:
      "Built rigor around turning models into operating leverage before moving deeper into founder-led product work.",
    repoUrl: "",
    liveUrl: "",
    tags: ["Retention models", "Experimentation", "Commercial analytics", "Decision systems"],
  },
];

export const experience = [
  {
    period: "Current chapter",
    role: "Founder / product operator",
    organization: "TradeGraph + Settle AI",
    bullets: [
      "Building product surfaces where AI, data, provenance, and operator workflow have to work together.",
      "Working across product strategy, system design, data modeling, UX, and commercialization.",
      "Using shipped product proof, not portfolio theater, as the primary credibility surface.",
    ],
  },
  {
    period: "Previous chapter",
    role: "Data scientist",
    organization: "American Express",
    bullets: [
      "Worked on retention models, experimentation, and commercial analytics in a scaled decision environment.",
      "Learned how models become useful only when they are tied to workflow, incentives, and business judgment.",
      "Built operating rigor before moving deeper into founder-led execution.",
    ],
  },
  {
    period: "Education",
    role: "Cornell Tech",
    organization: "Graduate work",
    bullets: [
      "Sharpened the bridge between technical depth, product thinking, and startup/operator judgment.",
      "Added a venture and execution lens to an already quantitative background.",
    ],
  },
  {
    period: "Education",
    role: "IIT Guwahati",
    organization: "Engineering foundation",
    bullets: [
      "Built the technical and quantitative base behind later analytics and product work.",
      "Established the rigor that shows up again in decision systems and product builds.",
    ],
  },
];

export const writingEntries = [
  {
    label: "Published note",
    title: "TradeGraph Is Not Three Demos. It Is One Decision System.",
    readTime: "6 min read",
    thesis:
      "TradeGraph becomes credible only when supplier trust, tender qualification, and export planning share one evidence graph instead of three disconnected surfaces.",
    description:
      "A teardown of the suite structure, why the products are connected, and how buyer-facing proof should work when the same company record powers multiple commercial decisions.",
    callToAction: {
      label: "Open TradeGraph",
      href: "./tradegraph/index.html",
    },
    sections: [
      {
        heading: "The product problem",
        paragraphs: [
          "Most product demos show a list, a score, and a few pretty charts. That is not a product system. The real question is whether the score changes a decision and whether the next step becomes clearer for the operator using it.",
          "TradeGraph is strongest when it behaves like one decision layer across supplier trust, procurement qualification, and export route planning. The shared asset is not a page. It is the evidence graph.",
        ],
      },
      {
        heading: "Why the suite structure matters",
        paragraphs: [
          "VerifySME answers whether a supplier is real and usable. TenderRadar answers whether a bid is worth chasing. ExportPulse answers which route is actually viable next. Those are different products, but they should not be built on different identities or different trust assumptions.",
          "Once the same company record carries provenance, freshness, and workflow status across all three surfaces, the suite stops feeling like stitched-together prototypes and starts feeling like a real operating system for commercial decisions.",
        ],
      },
      {
        heading: "What proof looks like",
        paragraphs: [
          "The public site should not ask the visitor to imagine the product quality. It should show the exact decision, the evidence behind it, the honest automation boundary, and the next operational move.",
          "That is why the strongest TradeGraph pages lead with decision, proof, and next step rather than feature lists.",
        ],
      },
    ],
  },
  {
    label: "Published note",
    title: "Explainable Scores Need Provenance, Not Just Model Confidence",
    readTime: "5 min read",
    thesis:
      "A score becomes trustworthy only when the operator can see why it moved, what source it depends on, and which parts are still assisted or missing.",
    description:
      "An explanation of how provenance, freshness, and factor contributions should sit inside product views when scores influence supplier, tender, and route decisions.",
    callToAction: {
      label: "Read TradeGraph docs",
      href: "./tradegraph/docs.html",
    },
    sections: [
      {
        heading: "The failure mode",
        paragraphs: [
          "A confidence badge is not enough. If a sourcing lead or bid manager sees a score with no trace back to evidence, they either ignore it or over-trust it. Both outcomes are bad product behavior.",
          "Explainability has to be structural. The score should reveal the factor contribution, the source freshness, and the provenance mode in the same surface where the decision is made.",
        ],
      },
      {
        heading: "What the user actually needs",
        paragraphs: [
          "Users do not need a lecture on model internals. They need to know what pushed the score up, what pulled it down, what is live today, and what still requires operator assistance.",
          "That is why additive insight payloads matter. They let charts, entity views, and next actions evolve without breaking the product shell.",
        ],
      },
      {
        heading: "Why provenance changes UX",
        paragraphs: [
          "When provenance and freshness are inline, the product earns the right to make recommendations. When they are buried, the charts become decorative and trust collapses under real scrutiny.",
        ],
      },
    ],
  },
  {
    label: "Published note",
    title: "Operator AI Works Best When The Next Action Is Obvious",
    readTime: "4 min read",
    thesis:
      "The strongest product experience is not the smartest answer. It is the cleanest next move an operator can take with confidence.",
    description:
      "A short case study on why AI and analytics products become usable only when they reduce ambiguity in the workflow instead of adding another interpretation layer.",
    callToAction: {
      label: "Open the live workspace",
      href: "./tradegraph/app/overview.html",
    },
    sections: [
      {
        heading: "The operator constraint",
        paragraphs: [
          "In real workflows, users are rarely asking for general intelligence. They are trying to decide whether to shortlist a supplier, kill a weak bid, or fix a documentation gap before a route launch.",
          "If the product adds interpretation without clarifying the next move, it adds overhead rather than leverage.",
        ],
      },
      {
        heading: "What usable looks like",
        paragraphs: [
          "A usable workflow keeps state, evidence, and action together. The user should see the current stage, the blocker, the supporting trace, and the next valid path on one surface.",
          "That design principle shows up across TradeGraph, and it is the same product instinct that matters in regulated AI systems as well.",
        ],
      },
      {
        heading: "The broader lesson",
        paragraphs: [
          "Models matter. Data pipelines matter. But in product terms, the durable advantage is how clearly the system converts those ingredients into operator action.",
        ],
      },
    ],
  },
];

export const dashboards = [
  {
    label: "Live module signal",
    title: "Fit-ranked procurement stream",
    description:
      "TenderRadar ranks opportunities by likely bid fit so SMEs spend time on plausible bids instead of portal noise.",
  },
  {
    label: "Live module signal",
    title: "Qualification gap visibility",
    description:
      "Turnover thresholds, credentials, and urgency are surfaced quickly so bid / no-bid decisions are faster and clearer.",
  },
  {
    label: "Live module signal",
    title: "Buyer and sector mix",
    description:
      "The dashboard keeps one eye on the single tender and one eye on the market pattern building around the profile.",
  },
];

export const solutions = [
  {
    label: "Live now",
    title: "VerifySME",
    description:
      "Buyer-side supplier verification and comparison using public trust signals, evidence depth, and readiness scoring.",
    buyer: "Sourcing lead",
    question: "Can I trust and shortlist this supplier?",
    href: "./tradegraph/app/verifysme/queue.html",
  },
  {
    label: "Live now",
    title: "TenderRadar",
    description:
      "Tender discovery and qualification on top of the same company graph so relevant bids surface without manual portal hopping.",
    buyer: "Bid manager",
    question: "Should we bid, qualify, or walk away?",
    href: "./tradegraph/app/tenderradar/pipeline.html",
  },
  {
    label: "Live now",
    title: "ExportPulse",
    description:
      "Export opportunity and readiness intelligence built on the same supplier identity, compliance, and capability layer.",
    buyer: "Export manager",
    question: "Which market can we actually enter next?",
    href: "./tradegraph/app/exportpulse/route-pipeline.html",
  },
];

export const useCases = [
  {
    title: "Procurement and bid teams",
    summary:
      "Use VerifySME to qualify suppliers, TenderRadar to rank relevant bids, and ExportPulse when the same suppliers need cross-border growth paths.",
    outcome: "Faster bid / no-bid decisions with less portal noise and less vendor ambiguity.",
  },
  {
    title: "Enterprise sourcing and quality teams",
    summary:
      "Screen Indian suppliers with public trust and capability signals before deeper diligence or RFQ outreach.",
    outcome: "Shorter longlists, better supplier trust, and fewer dead-end sourcing conversations.",
  },
  {
    title: "Banks, NBFCs, and trade-enablement teams",
    summary:
      "Assess whether an SME is credible, commercially active, procurement-capable, and export-ready using one connected evidence graph.",
    outcome: "Better origination, underwriting context, and SME-growth support workflows.",
  },
  {
    title: "Export advisors and industry programs",
    summary:
      "Turn exporter readiness into route-by-route action plans instead of generic export-awareness material.",
    outcome: "More usable market-entry guidance and clearer program intervention points.",
  },
];
