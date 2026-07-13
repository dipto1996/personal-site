import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CANDIDATES = [
  path.join(process.cwd(), ".env.local"),
  path.join(process.cwd(), ".env"),
];

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

for (const filePath of CANDIDATES) {
  if (!existsSync(filePath)) {
    continue;
  }

  const source = readFileSync(filePath, "utf8");

  source.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = stripQuotes(trimmed.slice(equalsIndex + 1).trim());

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}
