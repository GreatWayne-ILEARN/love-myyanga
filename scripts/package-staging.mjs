#!/usr/bin/env node
/**
 * Package MyYangaX staging zip for AWS handoff.
 * Usage: node scripts/package-staging.mjs [--skip-build] [--skip-pdf]
 */
import { execSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const downloads = join(homedir(), "Downloads");
const out = join(downloads, "MyYangaX.zip");

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const skipPdf = args.has("--skip-pdf");

const REQUIRED_DOCS = [
  "MYANGAX_STAGING_README.md",
  ".env.example",
  "docs/VIRTUAL-WEAR-LOVABLE-UI.md",
  "docs/AWS_RESTAGE.md",
  "docs/VERSION.md",
  "docs/HOSTILE_AUDIT_REPORT.md",
];

for (const doc of REQUIRED_DOCS) {
  if (!existsSync(join(root, doc))) {
    console.error(`Missing required doc: ${doc}`);
    process.exit(1);
  }
}

if (!skipPdf) {
  console.log("Rendering staging readme PDF…");
  execSync(
    'node scripts/render-doc-pdf.mjs MYANGAX_STAGING_README.md docs/MYANGAX_STAGING_README.pdf "MyYangaX — Staging Handoff"',
    { cwd: root, stdio: "inherit" },
  );
}

if (!skipBuild) {
  console.log("Building dist…");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

if (!existsSync(join(root, "dist", "index.html"))) {
  console.error("dist/ missing — run build first");
  process.exit(1);
}

const zipExcludes = [
  '"node_modules/*"',
  '"node_modules/**"',
  '".git/*"',
  '".git/**"',
  '"*.zip"',
  '"docs/MYYANGA_BUSINESS_PLAN.md"',
  '"docs/FEATURES_AND_IMPLEMENTATION.md"',
].join(" -x ");

console.log(`Creating MyYangaX staging zip → ${out}`);
execSync(`rm -f "${out}" && zip -r "${out}" . -x ${zipExcludes}`, {
  cwd: root,
  stdio: "inherit",
});

const stats = execSync(`ls -lh "${out}" && unzip -l "${out}" | tail -5`, {
  encoding: "utf8",
});
console.log(`\nMyYangaX package: ${out}\n${stats}`);
