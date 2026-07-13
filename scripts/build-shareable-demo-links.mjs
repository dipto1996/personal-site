const input = process.argv[2];

if (!input) {
  console.error("Usage: node scripts/build-shareable-demo-links.mjs '<vercel-shareable-link>'");
  process.exit(1);
}

let baseUrl;

try {
  baseUrl = new URL(input);
} catch {
  console.error("Expected a full Vercel Sharable Link URL.");
  process.exit(1);
}

if (!baseUrl.search) {
  console.error("The provided URL does not contain sharable-link query parameters.");
  process.exit(1);
}

const shareQuery = baseUrl.search;
const origin = `${baseUrl.protocol}//${baseUrl.host}`;

const routes = [
  {
    label: "Suite home",
    path: "/tradegraph/index.html",
  },
  {
    label: "VerifySME supplier proof flow",
    path: "/tradegraph/app/verifysme/supplier-detail.html?supplierId=shoreline-apparel-exim",
  },
  {
    label: "TenderRadar live bid flow",
    path: "/tradegraph/app/tenderradar/opportunity-detail.html?profileId=solargrid&tenderId=live-tr-solargrid-cppp-1",
  },
  {
    label: "ExportPulse route flow",
    path: "/tradegraph/app/exportpulse/route-detail.html?profileId=gcc-packaging&routeId=live-ep-live-export-gcc-packaging-uae-finance-1",
  },
  {
    label: "Pricing close",
    path: "/tradegraph/pricing.html",
  },
];

for (const route of routes) {
  const next = new URL(route.path, origin);
  const routeSearch = next.search ? `${next.search}&${shareQuery.slice(1)}` : shareQuery;
  next.search = routeSearch;
  process.stdout.write(`${route.label}: ${next.toString()}\n`);
}
