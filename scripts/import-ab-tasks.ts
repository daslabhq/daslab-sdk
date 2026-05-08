#!/usr/bin/env bun
/**
 * Import AutomationBench tasks into scene-otel's viewer for browsing.
 *
 * Reads task JSONs from the local scenebench adapter, copies them into
 * viewer/ab-tasks/<category>/<slug>.json, and writes a manifest with
 * summary metadata (category, n_tools, n_assertions, prompt preview).
 *
 * The viewer loads the manifest synchronously and lazy-fetches individual
 * task JSONs on demand when the user picks one. ~8MB bundled total —
 * well within static-hosting budget; lazy load keeps initial pageload tiny.
 *
 * Run:
 *   bun scripts/import-ab-tasks.ts
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE     = dirname(fileURLToPath(import.meta.url));
const REPO     = join(HERE, "..");
const SOURCE   = join(REPO, "..", "scenebench", "adapters", "automationbench", "tasks");
const TARGET   = join(REPO, "viewer", "ab-tasks");

interface ManifestEntry {
  slug:          string;
  category:      string;
  task_id:       string;
  n_tools:       number;
  n_assertions:  number;
  user_prompt:   string;        // truncated for the picker preview
  tool_families: string[];      // unique vendor prefixes (gmail, salesforce, ...)
}

function categoryFor(slug: string): string {
  // First underscore-separated token = domain (simple, sales, support, ...)
  return slug.split("_")[0] ?? "other";
}

function vendorOf(toolName: string): string {
  // Heuristic: vendor is everything up to the first `_`
  return toolName.split("_")[0] ?? toolName;
}

function buildManifestEntry(slug: string, raw: any): ManifestEntry {
  const userMsg = raw.prompt?.find?.((m: any) => m.role === "user")?.content ?? "";
  const tools: string[] = raw.info?.zapier_tools ?? [];
  const families = [...new Set(tools.map(vendorOf))].sort();
  const preview = userMsg.length > 240 ? userMsg.slice(0, 237) + "…" : userMsg;
  return {
    slug,
    category:      categoryFor(slug),
    task_id:       raw.task ?? slug,
    n_tools:       tools.length,
    n_assertions:  (raw.info?.assertions ?? []).length,
    user_prompt:   preview,
    tool_families: families,
  };
}

function main(): void {
  if (!existsSync(SOURCE)) {
    console.error(`AB tasks not found at ${SOURCE}. Make sure the scenebench package is checked out.`);
    process.exit(1);
  }

  // Reset target directory.
  rmSync(TARGET, { recursive: true, force: true });
  mkdirSync(TARGET, { recursive: true });

  const manifest: ManifestEntry[] = [];
  const files = readdirSync(SOURCE).filter(f => f.endsWith(".json") && f !== "tasks-manifest.json");

  for (const f of files) {
    const slug = f.replace(/\.json$/, "");
    const raw = JSON.parse(readFileSync(join(SOURCE, f), "utf-8"));
    const entry = buildManifestEntry(slug, raw);

    const catDir = join(TARGET, entry.category);
    mkdirSync(catDir, { recursive: true });
    writeFileSync(join(catDir, `${slug}.json`), JSON.stringify(raw));

    manifest.push(entry);
  }

  // Sort: by category, then by complexity (n_tools + n_assertions) ascending.
  manifest.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    const ca = a.n_tools + a.n_assertions, cb = b.n_tools + b.n_assertions;
    return ca - cb;
  });

  writeFileSync(join(TARGET, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Per-category summary for the header chip
  const summary: Record<string, { count: number; avg_tools: number; avg_assertions: number }> = {};
  for (const e of manifest) {
    const s = summary[e.category] ?? { count: 0, avg_tools: 0, avg_assertions: 0 };
    s.count++;
    s.avg_tools += e.n_tools;
    s.avg_assertions += e.n_assertions;
    summary[e.category] = s;
  }
  for (const k of Object.keys(summary)) {
    summary[k]!.avg_tools = +(summary[k]!.avg_tools / summary[k]!.count).toFixed(1);
    summary[k]!.avg_assertions = +(summary[k]!.avg_assertions / summary[k]!.count).toFixed(1);
  }
  writeFileSync(join(TARGET, "summary.json"), JSON.stringify(summary, null, 2));

  console.log(`✓ imported ${manifest.length} AB tasks`);
  console.log(`  manifest: ${join(TARGET, "manifest.json")}`);
  console.log(`  per-category:`);
  for (const [cat, s] of Object.entries(summary)) {
    console.log(`    ${cat.padEnd(12)} ${s.count.toString().padStart(4)} tasks, avg ${s.avg_tools} tools, avg ${s.avg_assertions} assertions`);
  }
}

main();
