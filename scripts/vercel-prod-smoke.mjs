import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const checks = [
  {
    name: "health",
    path: "/api/health",
    expect: ['"ok":true', '"appUrl":"https://diptopal-roy-site.vercel.app"'],
  },
  {
    name: "runtime config",
    path: "/api/config",
    expect: ['"deploymentMode":"vercel"', '"persistenceMode":"postgres"'],
  },
  {
    name: "session bootstrap",
    path: "/api/session",
    expect: ['"signedIn":false', '"demoAvailable":true'],
  },
  {
    name: "VerifySME page shell",
    path: "/tradegraph/app/verifysme/suppliers.html?supplierId=shoreline-apparel-exim&sector=Apparel",
    expect: ['<title>TradeGraph - VerifySME Suppliers</title>', 'data-page-key="app/verifysme/suppliers"'],
  },
  {
    name: "TenderRadar page shell",
    path: "/tradegraph/app/tenderradar/opportunities.html?profileId=solargrid",
    expect: ['<title>TradeGraph - TenderRadar Opportunities</title>', 'data-page-key="app/tenderradar/opportunities"'],
  },
  {
    name: "ExportPulse page shell",
    path: "/tradegraph/app/exportpulse/markets.html?profileId=gcc-packaging",
    expect: ['<title>TradeGraph - ExportPulse Markets</title>', 'data-page-key="app/exportpulse/markets"'],
  },
];

async function fetchProtected(path) {
  const { stdout, stderr } = await execFileAsync("npx", ["-y", "vercel@latest", "curl", path], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });

  if (stderr) {
    process.stderr.write(stderr);
  }

  const redirecting = stdout.includes("Redirecting...");
  if (!redirecting) {
    return { stdout };
  }

  const redirected = await execFileAsync("npx", ["-y", "vercel@latest", "curl", path, "--", "--location"], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });

  if (redirected.stderr) {
    process.stderr.write(redirected.stderr);
  }

  return { stdout: redirected.stdout };
}

for (const check of checks) {
  process.stdout.write(`\n[prod-smoke] ${check.name}: ${check.path}\n`);
  const { stdout } = await fetchProtected(check.path);

  for (const expected of check.expect) {
    if (!stdout.includes(expected)) {
      process.stderr.write(`[prod-smoke] Missing expected text for ${check.name}: ${expected}\n`);
      process.exit(1);
    }
  }

  process.stdout.write(`[prod-smoke] ok: ${check.name}\n`);
}

process.stdout.write("\n[prod-smoke] All protected production checks passed.\n");
