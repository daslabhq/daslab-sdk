// Generate static HTML for AutomationBench:
//   /automationbench/                          — landing (7 category cards)
//   /automationbench/<category>/               — category page (~100 task cards)
//   /automationbench/<category>/<slug>/        — task detail page
//
// Run: bun run scripts/build-task-pages.ts
// Output gitignored under viewer/automationbench/. Regenerated each deploy.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT       = resolve(import.meta.dirname, "..");
const VIEWER_DIR = join(ROOT, "viewer");
const AB_DIR     = join(VIEWER_DIR, "ab-tasks");
const OUT_DIR    = join(VIEWER_DIR, "automationbench");
const SITE_URL   = "https://scene.daslab.run";

type ManifestEntry = {
  slug: string;
  category: string;
  task_id: string;
  n_tools: number;
  n_assertions: number;
  user_prompt: string;
  tool_families: string[];
};

type CategorySummary = { count: number; avg_tools: number; avg_assertions: number };

type TaskFile = {
  example_id?: number;
  task?: string;
  prompt?: { role: string; content: string }[];
  info?: {
    zapier_tools?: string[];
    initial_state?: Record<string, any>;
    assertions?: { type: string; [k: string]: any }[];
  };
};

const VENDOR_COLOR: Record<string, string> = {
  gmail: "bg-red-50 text-red-700",
  google: "bg-emerald-50 text-emerald-700",
  salesforce: "bg-sky-50 text-sky-700",
  slack: "bg-violet-50 text-violet-700",
  jira: "bg-blue-50 text-blue-700",
  asana: "bg-pink-50 text-pink-700",
  airtable: "bg-amber-50 text-amber-700",
  intercom: "bg-indigo-50 text-indigo-700",
  zoom: "bg-cyan-50 text-cyan-700",
  calendly: "bg-teal-50 text-teal-700",
  docusign: "bg-yellow-50 text-yellow-700",
  hubspot: "bg-orange-50 text-orange-700",
  notion: "bg-stone-50 text-stone-700",
  twilio: "bg-rose-50 text-rose-700",
  chatgpt: "bg-emerald-50 text-emerald-700",
};

const CATEGORY_BLURB: Record<string, string> = {
  simple: "single-vendor, ≤3 tool calls — the easy slice",
  finance: "budget prep, invoice flows, expense approvals",
  hr: "onboarding, directory updates, performance",
  marketing: "campaign analytics, content workflows",
  operations: "incident response, scheduling, ops dashboards",
  sales: "deal cycles, prospecting, multi-system orchestration",
  support: "ticket triage, customer comms, knowledge base",
};

// Stable display order: simple first, then alpha
const CATEGORY_ORDER = ["simple", "finance", "hr", "marketing", "operations", "sales", "support"];

function vendorColor(name: string): string {
  const v = name.split("_")[0];
  return VENDOR_COLOR[v] ?? "bg-slate-100 text-slate-700";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const escapeAttr = escapeHtml;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function complexity(entry: { n_tools: number; n_assertions: number }): { label: string; color: string } {
  const c = entry.n_tools + entry.n_assertions;
  if (c < 5) return { label: "easy", color: "text-emerald-600" };
  if (c < 15) return { label: "medium", color: "text-amber-600" };
  if (c < 30) return { label: "hard", color: "text-orange-600" };
  return { label: "very hard", color: "text-rose-600" };
}

// ============================================================================
// Layout primitives
// ============================================================================

function renderLayout(opts: {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  rootRel: string; // relative path back to viewer/ root, ending in "/" (e.g. "../../../")
  breadcrumb: string;
  body: string;
  footerScript?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  <meta name="description" content="${escapeAttr(opts.description)}" />
  <link rel="canonical" href="${opts.canonical}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeAttr(opts.ogTitle)}" />
  <meta property="og:description" content="${escapeAttr(opts.ogDescription)}" />
  <meta property="og:url" content="${opts.canonical}" />
  <meta property="og:site_name" content="scene-otel" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeAttr(opts.ogTitle)}" />
  <meta name="twitter:description" content="${escapeAttr(opts.ogDescription)}" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif; }
    .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  </style>
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen">

<header class="border-b bg-white">
  <div class="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
    <div class="min-w-0">
      <a href="${opts.rootRel}" class="text-xs text-slate-500 hover:text-slate-900 mono">scene-otel · scene scrubber</a>
      <div class="flex items-center gap-2 text-xs text-slate-400 mt-0.5 flex-wrap">${opts.breadcrumb}</div>
    </div>
    <a href="https://github.com/daslabhq/scene-otel" class="text-sm text-slate-600 hover:text-slate-900 underline whitespace-nowrap">GitHub →</a>
  </div>
</header>

<main class="max-w-6xl mx-auto p-6 space-y-4">
${opts.body}
</main>

<footer class="max-w-6xl mx-auto px-6 py-10 text-xs text-slate-400">
  scene-otel · MIT · <a href="https://github.com/daslabhq/scene-otel" class="underline">github.com/daslabhq/scene-otel</a>
</footer>
${opts.footerScript ?? ""}
</body>
</html>
`;
}

// ============================================================================
// Task row (used on category landing + browser on /)
// ============================================================================

function renderTaskRowAnchor(entry: ManifestEntry, hrefSlugSegment: string): string {
  const families = entry.tool_families
    .slice(0, 5)
    .map((v) => `<span class="text-[10px] px-1.5 py-0.5 rounded ${vendorColor(v)}">${escapeHtml(v)}</span>`)
    .join(" ");
  const more =
    entry.tool_families.length > 5 ? `<span class="text-[10px] text-slate-400">+${entry.tool_families.length - 5}</span>` : "";
  const cmplx = complexity(entry);
  return `
    <a href="${escapeAttr(hrefSlugSegment)}/" class="block px-4 py-2.5 hover:bg-slate-50 transition border-b border-slate-100 last:border-b-0">
      <div class="flex items-baseline justify-between gap-3">
        <div class="font-mono text-xs font-semibold truncate">${escapeHtml(entry.task_id)}</div>
        <div class="text-[10px] mono ${cmplx.color} whitespace-nowrap flex-shrink-0">
          ${entry.n_tools} tools · ${entry.n_assertions} assertions · ${cmplx.label}
        </div>
      </div>
      <div class="text-xs text-slate-600 mt-1 line-clamp-1">${escapeHtml(entry.user_prompt)}</div>
      <div class="mt-1.5 flex flex-wrap gap-1">${families}${more}</div>
    </a>`;
}

// ============================================================================
// AB landing page
// ============================================================================

function renderAbLanding(manifest: ManifestEntry[], summary: Record<string, CategorySummary>): string {
  const total = manifest.length;
  const totalCats = CATEGORY_ORDER.filter((c) => summary[c]).length;
  const cards = CATEGORY_ORDER.filter((c) => summary[c])
    .map((cat) => {
      const s = summary[cat];
      const blurb = CATEGORY_BLURB[cat] ?? "";
      return `
        <a href="${escapeAttr(cat)}/" class="block bg-white rounded-lg border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-sm transition">
          <div class="flex items-baseline justify-between mb-2">
            <div class="font-semibold capitalize">${escapeHtml(cat)}</div>
            <div class="text-xs text-slate-500 mono">${s.count} tasks</div>
          </div>
          <div class="text-xs text-slate-500 italic mb-3">${escapeHtml(blurb)}</div>
          <div class="text-[11px] text-slate-500 mono">avg ${s.avg_tools.toFixed(1)} tools · avg ${s.avg_assertions.toFixed(1)} assertions</div>
        </a>`;
    })
    .join("");

  const body = `
    <section class="bg-white rounded-lg border border-slate-200 p-6">
      <div class="text-[10px] uppercase tracking-wider text-slate-500">benchmark</div>
      <h1 class="text-2xl md:text-3xl font-semibold mt-1">AutomationBench</h1>
      <p class="text-sm text-slate-600 mt-3 leading-relaxed max-w-2xl">
        Zapier's <a href="https://github.com/zapier/AutomationBench" class="underline hover:text-slate-900">${total} benchmark tasks</a> for testing AI agents on multi-step business workflows. Each task ships with declared tools, success-criteria assertions, and a seeded initial world state — see exactly what the agent must do, not just whether it succeeded.
      </p>
      <div class="text-xs text-slate-400 mt-3 mono">${total} tasks · ${totalCats} categories</div>
    </section>

    <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      ${cards}
    </section>`;

  const breadcrumb = `<span class="mono">automationbench</span>`;

  return renderLayout({
    title: "AutomationBench · scene-otel",
    description: `Browse Zapier's ${total} AutomationBench tasks for AI agents — finance, sales, support, HR, marketing, operations, simple. Each task has declared tools, success assertions, and seeded world state.`,
    canonical: `${SITE_URL}/automationbench/`,
    ogTitle: "AutomationBench — Zapier's agent workflow benchmark",
    ogDescription: `${total} multi-step agent tasks across 7 business categories. Click any to see exactly what the agent must do.`,
    rootRel: "../",
    breadcrumb,
    body,
  });
}

// ============================================================================
// Category landing page
// ============================================================================

function renderCategoryLanding(category: string, summary: CategorySummary, tasksInCat: ManifestEntry[]): string {
  const blurb = CATEGORY_BLURB[category] ?? "";
  const sorted = [...tasksInCat].sort((a, b) => a.slug.localeCompare(b.slug));
  const rows = sorted.map((e) => renderTaskRowAnchor(e, e.slug)).join("");

  const body = `
    <section class="bg-white rounded-lg border border-slate-200 p-6">
      <div class="text-[10px] uppercase tracking-wider text-slate-500">automationbench category</div>
      <h1 class="text-2xl font-semibold mt-1 capitalize">${escapeHtml(category)}</h1>
      <p class="text-sm text-slate-600 mt-2 italic">${escapeHtml(blurb)}</p>
      <div class="text-xs text-slate-400 mt-3 mono">${summary.count} tasks · avg ${summary.avg_tools.toFixed(1)} tools · avg ${summary.avg_assertions.toFixed(1)} assertions</div>
    </section>

    <section class="bg-white rounded-lg border border-slate-200 overflow-hidden">
      ${rows}
    </section>`;

  const breadcrumb = `
    <a href="../" class="hover:text-slate-700 underline">automationbench</a>
    <span>›</span>
    <span class="mono capitalize">${escapeHtml(category)}</span>`;

  return renderLayout({
    title: `${category} · AutomationBench · scene-otel`,
    description: `${summary.count} ${category} tasks from Zapier's AutomationBench: ${blurb}.`,
    canonical: `${SITE_URL}/automationbench/${category}/`,
    ogTitle: `AutomationBench · ${category}`,
    ogDescription: `${summary.count} ${category} agent tasks — ${blurb}.`,
    rootRel: "../../",
    breadcrumb,
    body,
  });
}

// ============================================================================
// Task detail page
// ============================================================================

function renderToolsCard(tools: string[]): string {
  const grouped: Record<string, string[]> = {};
  for (const t of tools) {
    const v = t.split("_")[0];
    (grouped[v] ??= []).push(t);
  }
  const vendors = Object.keys(grouped).length;
  const inner = Object.entries(grouped)
    .map(
      ([v, ts]) => `
        <div class="flex items-start gap-2">
          <span class="text-[10px] px-1.5 py-0.5 rounded ${vendorColor(v)} mt-0.5 flex-shrink-0">${escapeHtml(v)}</span>
          <div class="text-xs mono text-slate-700 leading-relaxed">${ts.map((t) => escapeHtml(t.slice(v.length + 1))).join(", ")}</div>
        </div>`,
    )
    .join("");
  return `
    <section class="bg-white rounded-lg border border-slate-200 p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm font-semibold">declared tools</div>
        <div class="text-xs text-slate-500">${tools.length} tools across ${vendors} vendor${vendors === 1 ? "" : "s"}</div>
      </div>
      <div class="space-y-1.5">${inner || `<div class="text-xs text-slate-400 italic">no tools declared</div>`}</div>
    </section>`;
}

function renderAssertionsCard(asserts: { type: string; [k: string]: any }[]): string {
  const negativeKinds = /not_|no_|excluded/;
  const rows = asserts
    .map((a, i) => {
      const isNeg = negativeKinds.test(a.type);
      const params = Object.entries(a)
        .filter(([k]) => k !== "type")
        .map(([k, v]) => {
          const vs = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
          const t = vs.length > 100 ? vs.slice(0, 97) + "…" : vs;
          return `<span class="text-slate-500">${escapeHtml(k)}=</span>${escapeHtml(t)}`;
        })
        .join(" <span class='text-slate-300'>·</span> ");
      const colorClass = isNeg ? "text-rose-700" : "text-slate-700";
      return `
        <div class="text-xs space-y-1 py-1.5 ${i > 0 ? "border-t border-slate-50" : ""}" data-assertion-idx="${i}">
          <div class="flex items-baseline gap-2">
            <span class="text-slate-300 mono w-6 flex-shrink-0">${i.toString().padStart(2)}</span>
            <span class="font-semibold ${colorClass}">${escapeHtml(a.type)}</span>
            <span class="ab-status-badge"></span>
          </div>
          <div class="ml-8 text-slate-600">${params}</div>
          <div class="ml-8 ab-mark-block"></div>
        </div>`;
    })
    .join("");
  return `
    <section class="bg-white rounded-lg border border-slate-200 p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm font-semibold">assertions <span class="text-xs text-slate-500 font-normal">(success criteria the agent must satisfy)</span></div>
        <div class="text-xs text-slate-500">${asserts.length} predicate${asserts.length === 1 ? "" : "s"}</div>
      </div>
      <div class="space-y-1.5 mono">${rows || `<div class="text-xs text-slate-400 italic">no assertions</div>`}</div>
    </section>`;
}

function renderTable(rows: any[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const sample = rows.slice(0, 5);
  const keys = new Set<string>();
  for (const r of sample) {
    if (r && typeof r === "object") for (const k of Object.keys(r)) keys.add(k);
  }
  const keyArr = [...keys].slice(0, 6);
  const head = keyArr.map((k) => `<th class="text-left font-medium text-slate-500 px-1.5 py-1 truncate">${escapeHtml(k)}</th>`).join("");
  const body = sample
    .map((r) => {
      const cells = keyArr
        .map((k) => {
          const v = r?.[k];
          let s = v == null ? "—" : typeof v === "string" ? v : JSON.stringify(v);
          if (s.length > 60) s = s.slice(0, 57) + "…";
          return `<td class="px-1.5 py-1 align-top text-slate-700 truncate max-w-[12rem]">${escapeHtml(s)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const more = rows.length > sample.length ? `<div class="text-[10px] text-slate-400 mt-1">… ${rows.length - sample.length} more</div>` : "";
  return `<div class="overflow-x-auto"><table class="text-[11px] mono w-full"><thead class="bg-slate-50"><tr>${head}</tr></thead><tbody class="divide-y divide-slate-100">${body}</tbody></table>${more}</div>`;
}

function renderInitialStateCards(state: Record<string, any>): string {
  const cards: string[] = [];
  for (const [vendor, vState] of Object.entries(state)) {
    if (vendor === "meta" || vState == null || typeof vState !== "object") continue;
    for (const [collection, value] of Object.entries(vState as Record<string, any>)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      const key = `${vendor}.${collection}`;
      const colorChip = `<span class="text-[10px] px-1.5 py-0.5 rounded ${vendorColor(vendor)}">${escapeHtml(vendor)}</span>`;
      cards.push(`
        <div class="bg-white rounded-lg border border-slate-200 p-3">
          <div class="flex items-center justify-between mb-2 gap-2">
            <div class="font-mono text-sm font-semibold truncate">${escapeHtml(key)}</div>
            ${colorChip}
          </div>
          <div class="text-xs text-slate-500 italic mb-1">${value.length} ${value.length === 1 ? "item" : "items"}</div>
          ${renderTable(value)}
        </div>`);
    }
  }
  if (cards.length === 0) return `<div class="col-span-full text-xs text-slate-400 italic py-4 text-center">empty initial state</div>`;
  return cards.join("");
}

function renderTaskPage(entry: ManifestEntry, task: TaskFile, prev: ManifestEntry | null, next: ManifestEntry | null): string {
  const sys = task.prompt?.find((m) => m.role === "system")?.content ?? "(no system prompt)";
  const usr = task.prompt?.find((m) => m.role === "user")?.content ?? "(no user prompt)";
  const tools = task.info?.zapier_tools ?? [];
  const asserts = task.info?.assertions ?? [];
  const initialState = task.info?.initial_state ?? {};
  const cmplx = complexity(entry);
  const desc = truncate(usr.replace(/\s+/g, " ").trim(), 160);
  const families = entry.tool_families
    .slice(0, 8)
    .map((v) => `<span class="text-[10px] px-1.5 py-0.5 rounded ${vendorColor(v)}">${escapeHtml(v)}</span>`)
    .join(" ");
  const moreFamilies =
    entry.tool_families.length > 8 ? `<span class="text-[10px] text-slate-400">+${entry.tool_families.length - 8}</span>` : "";

  const prevLink = prev
    ? `<a href="../${escapeAttr(prev.slug)}/" class="text-xs text-slate-500 hover:text-slate-900 truncate max-w-xs">← ${escapeHtml(prev.task_id)}</a>`
    : `<span></span>`;
  const nextLink = next
    ? `<a href="../${escapeAttr(next.slug)}/" class="text-xs text-slate-500 hover:text-slate-900 text-right truncate max-w-xs">${escapeHtml(next.task_id)} →</a>`
    : `<span></span>`;

  const breadcrumb = `
    <a href="../../" class="hover:text-slate-700 underline">automationbench</a>
    <span>›</span>
    <a href="../" class="hover:text-slate-700 capitalize">${escapeHtml(entry.category)}</a>
    <span>›</span>
    <span class="mono truncate">${escapeHtml(entry.slug)}</span>`;

  const taskJson = JSON.stringify({ assertions: asserts, initial_state: initialState });

  const body = `
    <section class="bg-white rounded-lg border border-slate-200 p-6">
      <div class="text-[10px] uppercase tracking-wider text-slate-500">automationbench task</div>
      <h1 class="font-mono text-xl md:text-2xl font-semibold mt-1 break-all">${escapeHtml(entry.task_id)}</h1>
      <div class="text-xs text-slate-500 mt-1">
        ${tools.length} tools · ${asserts.length} assertions · <span class="${cmplx.color} font-medium">${cmplx.label}</span>${task.example_id != null ? ` · example_id ${escapeHtml(String(task.example_id))}` : ""}
      </div>
      ${CATEGORY_BLURB[entry.category] ? `<div class="text-xs text-slate-400 italic mt-0.5">${escapeHtml(entry.category)} — ${escapeHtml(CATEGORY_BLURB[entry.category])}</div>` : ""}
      <div class="mt-3 flex flex-wrap gap-1">${families}${moreFamilies}</div>
    </section>

    <section class="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
      <div>
        <div class="text-[10px] uppercase tracking-wider text-slate-500 mb-1">user prompt</div>
        <div class="text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">${escapeHtml(usr)}</div>
      </div>
      <details class="border-t border-slate-100 pt-3">
        <summary class="cursor-pointer text-[10px] uppercase tracking-wider text-slate-500 select-none hover:text-slate-700">system prompt</summary>
        <div class="text-sm text-slate-700 whitespace-pre-wrap mt-2">${escapeHtml(sys)}</div>
      </details>
    </section>

    ${renderToolsCard(tools)}

    ${renderAssertionsCard(asserts)}

    <section class="bg-white rounded-lg border border-slate-200 p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm font-semibold">initial world state <span class="text-xs text-slate-500 font-normal">(seeded data the agent starts with)</span></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">${renderInitialStateCards(initialState)}</div>
    </section>

    <nav class="flex items-center justify-between gap-3 pt-2">
      ${prevLink}
      <a href="../" class="text-xs text-slate-500 hover:text-slate-900 underline whitespace-nowrap">all ${escapeHtml(entry.category)} tasks</a>
      ${nextLink}
    </nav>

    <script id="task-data" type="application/json">${escapeHtml(taskJson)}</script>`;

  // Progressive enhancement script: translate each assertion via mark and
  // attach a satisfied/unmet badge. Page is at depth 3 → ../../../ to reach
  // the viewer root where mark.bundle.js lives.
  const footerScript = `
<script type="module">
  try {
    const { evaluate, translate } = await import("../../../mark.bundle.js");
    const data = JSON.parse(document.getElementById("task-data").textContent);
    const rows = document.querySelectorAll("[data-assertion-idx]");
    function escHtml(s) {
      return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }
    rows.forEach((row, idx) => {
      const a = data.assertions[idx];
      if (!a) return;
      const tr = translate(a);
      const markEl = row.querySelector(".ab-mark-block");
      const statusEl = row.querySelector(".ab-status-badge");
      if (!tr) {
        if (markEl) markEl.innerHTML = '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">⚠ not yet translated</span>';
        return;
      }
      const predJson = JSON.stringify(tr.predicate, null, 2);
      const approxBadge = tr.approximate
        ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700" title="May diverge from Zapier on edge cases">~99.6% equiv</span>'
        : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700" title="Bit-equivalent to Zapier\\'s grader">✓ exact</span>';
      if (markEl) {
        markEl.innerHTML = approxBadge + ' <details class="inline-block ml-1"><summary class="cursor-pointer text-[10px] text-indigo-600 underline select-none">show predicate</summary><pre class="mt-1 text-[10px] bg-indigo-50/50 border border-indigo-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">' + escHtml(predJson) + '</pre></details>';
      }
      try {
        const r = evaluate(data.initial_state, tr.predicate);
        if (statusEl) {
          statusEl.outerHTML = r.satisfied
            ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">✓ already satisfied</span>'
            : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-600" title="' + escHtml(r.evidence ?? "") + '">○ unmet · gap ' + r.gap + '</span>';
        }
      } catch {}
    });
  } catch (e) {
    // best-effort progressive enhancement
  }
</script>`;

  return renderLayout({
    title: `${entry.task_id} · AutomationBench task · scene-otel`,
    description: desc,
    canonical: `${SITE_URL}/automationbench/${entry.category}/${entry.slug}/`,
    ogTitle: `${entry.task_id} · AutomationBench task`,
    ogDescription: desc,
    rootRel: "../../../",
    breadcrumb,
    body,
    footerScript,
  });
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const manifest: ManifestEntry[] = JSON.parse(readFileSync(join(AB_DIR, "manifest.json"), "utf8"));
  const summary: Record<string, CategorySummary> = JSON.parse(readFileSync(join(AB_DIR, "summary.json"), "utf8"));

  const byCategory: Record<string, ManifestEntry[]> = {};
  for (const e of manifest) (byCategory[e.category] ??= []).push(e);
  for (const cat of Object.keys(byCategory)) byCategory[cat].sort((a, b) => a.slug.localeCompare(b.slug));

  // 1. AB landing
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "index.html"), renderAbLanding(manifest, summary));

  // 2. Per-category landings + 3. per-task pages
  let taskPages = 0;
  let categoryPages = 0;
  for (const cat of Object.keys(byCategory)) {
    const list = byCategory[cat];
    const catSummary = summary[cat];
    if (!catSummary) {
      console.warn(`skip category ${cat}: no summary`);
      continue;
    }
    const catDir = join(OUT_DIR, cat);
    mkdirSync(catDir, { recursive: true });
    writeFileSync(join(catDir, "index.html"), renderCategoryLanding(cat, catSummary, list));
    categoryPages++;

    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const taskPath = join(AB_DIR, entry.category, `${entry.slug}.json`);
      if (!existsSync(taskPath)) {
        console.warn(`skip ${entry.slug}: task file missing`);
        continue;
      }
      const task: TaskFile = JSON.parse(readFileSync(taskPath, "utf8"));
      const prev = i > 0 ? list[i - 1] : null;
      const next = i < list.length - 1 ? list[i + 1] : null;
      const html = renderTaskPage(entry, task, prev, next);
      const outPath = join(catDir, entry.slug, "index.html");
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, html);
      taskPages++;
    }
  }

  console.log(`wrote 1 landing + ${categoryPages} category pages + ${taskPages} task pages → viewer/automationbench/`);
}

main();
