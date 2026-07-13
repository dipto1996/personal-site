import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "public");
const ROOT_FILES = [
  "about.html",
  "contact.html",
  "dashboards.html",
  "experience.html",
  "favicon.svg",
  "index.html",
  "job-search.html",
  "robots.txt",
  "script.js",
  "sitemap.xml",
  "solutions.html",
  "styles.css",
  "work.html",
  "writing.html",
];
const PUBLIC_DIRECTORIES = ["apps", "lib", "makhana", "tradegraph"];
const PUBLIC_EXTENSIONS = new Set([
  ".css", ".gif", ".html", ".ico", ".jpeg", ".jpg", ".js",
  ".png", ".svg", ".txt", ".webp", ".xml",
]);

async function copyPublicTree(source, destination) {
  const info = await stat(source);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source)) {
      if (entry.startsWith(".")) continue;
      await copyPublicTree(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }
  if (PUBLIC_EXTENSIONS.has(path.extname(source).toLowerCase())) {
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
  }
}

await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });

for (const file of ROOT_FILES) {
  await cp(path.join(ROOT, file), path.join(OUTPUT, file));
}
for (const directory of PUBLIC_DIRECTORIES) {
  await copyPublicTree(path.join(ROOT, directory), path.join(OUTPUT, directory));
}

console.log(`Built static site in ${OUTPUT}`);
