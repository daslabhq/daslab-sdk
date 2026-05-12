#!/usr/bin/env bun
/**
 * Bundle autocheck + the AutomationBench translator into a single browser
 * ESM file the scene-otel viewer can load directly.
 *
 * Why bundling: the viewer is a static HTML page deployed to GitHub Pages;
 * it can't `import` from a sibling package. We compile autocheck to one
 * file and ship it alongside index.html.
 *
 * Run before pushing if either autocheck/ or the bundle entry changes:
 *   bun scripts/build-mark-bundle.ts
 *
 * Output: viewer/mark.bundle.js (~15-25 KB, one file, ESM, browser-ready).
 *
 * NOTE: the output filename is kept as `mark.bundle.js` for backward
 * compatibility with deployed viewer/index.html until the viewer is updated
 * to reference autocheck.bundle.js.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const ENTRY_DIR = join(REPO, "scripts", "bundle-entry");
const ENTRY = join(ENTRY_DIR, "mark.ts");
const OUT = join(REPO, "viewer", "mark.bundle.js");

mkdirSync(ENTRY_DIR, { recursive: true });

writeFileSync(ENTRY, `// Auto-generated entry for the viewer's autocheck bundle.
// Re-exports the public API the viewer needs.
export { runCheck } from "autocheck";
export { resolve, lookup } from "autocheck";
export { translate, SUPPORTED_TYPES } from "autocheck/translate/automationbench";
export type { CheckExpr, CheckResult } from "autocheck";
`);

const result = await Bun.build({
  entrypoints: [ENTRY],
  target:      "browser",
  format:      "esm",
  minify:      false,    // keep readable for now; flip on once stable
  sourcemap:   "none",
});

if (!result.success) {
  console.error("bundle failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const out = await result.outputs[0]!.text();
writeFileSync(OUT, out);

const kb = (out.length / 1024).toFixed(1);
console.log(`✓ wrote ${OUT}  (${kb} KB)`);
