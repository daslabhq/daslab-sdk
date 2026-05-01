# Daslab SDK Vision

## The Problem

AI agents today interact with the world through imperative tool calling. The LLM picks a tool, calls it, reads the raw result, picks the next tool, repeats. Each round-trip costs tokens, adds latency, and floods the context window with data the agent doesn't need. A simple task like "show me unpaid invoices alongside my budget" takes 12 LLM turns, 45k tokens, and the agent spends most of its intelligence deciding *which API to call next* rather than *what to do with the data*.

Meanwhile, the humans reviewing the agent's work get dumped on too — raw JSON in chat bubbles, unstructured text summaries, or half-broken webviews. There's no native, structured, beautiful way for an agent to show its work.

## The Insight

What if the agent didn't call tools one by one — but instead **defined what it wants to see**?

A React developer doesn't manually fetch data, parse JSON, and imperatively update the DOM. They declare a component: "here's the data I need, here's how to render it." The framework handles the rest.

The same model works for AI agents. Instead of:

```
LLM → call gmail_search → read 50 emails → call sheets_read → read 200 rows 
    → reason over 12k tokens → call write_widget → call write_widget → ...
```

The agent writes:

```javascript
const emails = await gmail.useInbox(ctx, { query: "invoice unpaid" });
const budget = await sheets.useSheet(ctx, "budget-2026");

const unpaid = emails
  .filter(e => e.labels.includes("unpaid"))
  .map(e => ({ vendor: e.from.split("<")[0].trim(), amount: extractAmount(e.subject) }));

const overBudget = unpaid.filter(inv => 
  budget.find(r => r.category === inv.vendor)?.limit < inv.amount
);

return [
  Table({ data: unpaid, title: "Unpaid Invoices" }),
  Metric({ value: overBudget.length, label: "Over Budget" }),
  List({ items: overBudget, title: i => i.vendor, subtitle: i => "$" + i.amount }),
];
```

One tool call. The runtime fetches Gmail and Sheets in parallel, applies the transforms, and produces structured widgets that render natively on iOS, React, or as a PDF. The agent gets back a compact summary — not raw API dumps. **96% fewer tokens. 83% fewer LLM round trips.**

## The Architecture

### Three Layers

**1. Hooks** — Reactive data fetching from connected accounts

```javascript
gmail.useInbox(ctx, { query, limit })     // → Email[]
sheets.useSheet(ctx, spreadsheetId)        // → Row[]
github.useIssues(ctx, repo, { label })     // → Issue[]
postgres.useQuery(ctx, sql)                // → Row[]
```

Hooks resolve credentials automatically from the scene's connected accounts. No API keys in code. No manual OAuth. The scene links assets (a GitHub repo, a Gmail account), the hooks use those credentials.

**2. Views** — Typed widget constructors that produce structured data

```javascript
Table({ data, columns, title })
List({ items, title: fn, subtitle: fn })
Metric({ value, label, trend, sparkline })
Chart({ series: [{ label, points }], type })
MapView({ pins: [{ lat, lng, title }] })
Calendar({ events, view: "week" })
Document({ content, title })
KeyValue({ pairs: [{ key, value }] })
```

Each view produces `WidgetData` JSON — the universal format that renders on every surface:
- **iOS** — Native SwiftUI widgets (already built, 14 widget types)
- **React** — Web components (7 built, 4 remaining)
- **Satori** — Static PNG/SVG images for thumbnails, OG cards, reports
- **PDF** — Multi-page vector reports with selectable text
- **Agent** — Compact structured summary for LLM reasoning

Same data, five renderers. Write once, render everywhere.

**3. Scene Definitions** — Composable, iterative, code-first

A scene definition is a function that combines hooks and views. It can be:
- A **default** per asset type (GitHub repo → PR list)
- A **custom view** the user picks from a menu
- An **agent-generated** mapping for a specific task
- A **compiled template** that autocompile extracted from patterns

The agent iterates on scenes like a developer iterates on React components:
```
Turn 1: Define scene → "fetch invoices, show as table"
        → Runtime evaluates, iOS renders live, agent gets summary
Turn 2: Refine → "also pull budget, join on vendor, flag over-budget"  
        → Scene re-evaluates, iOS updates live, agent sees new summary
Turn 3: Add interaction → "add approve button per invoice"
        → User taps Approve → triggers job → agent handles it → scene updates
```

The agent doesn't accumulate context. It **redefines its viewport** each iteration.

## Assets and Views — Clean Separation

**Assets** are data sources with credentials and governance:
- A GitHub repository, a Gmail account, a Postgres database
- Linked explicitly to scenes for access control
- The user manages these — connect, disconnect, share

**Views** are SDK functions that render asset data:
- A "Pull Requests" view, a "Revenue Chart" view, a "Comparison Table" view
- Can reference one asset or combine multiple
- The agent (or user) creates and customizes these

Today these are conflated — one asset = one widget = one hardcoded rendering. The SDK separates them:

| Before | After |
|--------|-------|
| Asset owns its widget rendering | Asset provides data, view defines rendering |
| One asset = one widget | One asset → many views, or many assets → one view |
| `widget.enrich()` hardcoded per provider | SDK view function, swappable/customizable |
| Agent calls N tools to build N widgets | Agent writes one scene definition |

### Two-Directional UX

**Asset-first** (existing flow, enhanced):
1. User links a GitHub repo (two taps)
2. Default SDK view renders automatically (PR list)
3. Force-tap → switch views: Issues, Commits, Activity Chart, Custom...

**View-first** (new):
1. User taps "Add view" → picks "Comparison Table"
2. Scene shows compatible assets (needs 2+ numeric sources)
3. User picks Stripe + Sheets
4. Agent generates the mapping code on the fly
5. Widget renders instantly

Both paths produce the same thing: an asset-view binding with SDK code as the glue.

## The Compilation Loop

Every scene definition the agent writes is a **trace**. Autocompile observes these traces across all users:

```
SDK traces agent scene definitions
        ↓
autocompile notices patterns:
  "87% of users who connect Stripe + Sheets 
   create a revenue-vs-target comparison"
        ↓
Compiles into a first-class view template
        ↓
Next user who connects Stripe + Sheets 
gets the template suggested automatically
        ↓
Template runs in the gym (benchmark suite)
to verify it works across edge cases
        ↓
Becomes a production-grade view template
with empirical accuracy metrics
```

The platform gets smarter with every user. View templates accumulate as **defensible IP** — built from real usage data, benchmarked against real outcomes. This is the flywheel.

## The Full Arc

```
bun add daslab                          ← developer installs SDK
        ↓
instrument() traces their agent app     ← OTel for Bun (HTTP, DB, S3, LLM)
        ↓
Traces flow to daslab.dev               ← observability, performance insights
        ↓
"Hmm, this endpoint is slow"           ← developer discovers evals
        ↓
Daslab agents can fix it                ← discovers agent platform
        ↓
Defines scenes with SDK                 ← reactive hooks + views
        ↓
Scenes render on iOS, React, PDF        ← multi-surface rendering
        ↓
autocompile compiles patterns           ← traces → optimized templates
        ↓
Gyms benchmark compiled templates       ← RL loop, continuous improvement
        ↓
Templates become the org's IP           ← defensible, built from their data
```

Each step earns the next. Nobody gets bait-and-switched. The SDK is the entry point, the agent platform is the destination, and the compilation loop is the moat.

## The Agent Workbench: Scenes as Cognitive Infrastructure

The deepest insight isn't about rendering — it's about **how agents think**.

Today's agents are blind. They call a tool, read a text dump, reason over it, call another tool. Their "working memory" is the context window — a giant append-only log of every API response they've ever seen. By turn 10, they're reasoning over 30k tokens of mostly-irrelevant data, burning money to re-read old results.

With the SDK, the agent builds itself a **workbench** — a structured, scoped, reactive view of exactly what it needs at each decision point:

```
Step 1: Agent needs to reconcile invoices
  → Defines a scene:
    - Invoices (filtered to unpaid, just vendor + amount + date)
    - Budget (just matching categories)
    - A join showing the gap
  → Reads compact summary: "7 unpaid, 3 over budget"
  → Zero wasted tokens on 50 email bodies and 200 sheet rows

Step 2: Agent needs to draft responses
  → Redefines scene:
    - Only the 3 over-budget vendors
    - Their email history (last 2 messages each)
    - Template fields: { to, subject, body } with obvious values pre-filled
  → Sees: "3 drafts needed, 2 pre-filled, 1 needs custom text"
  → Only reasons about the one that matters

Step 3: Agent needs to send and log
  → Redefines scene:
    - Send status per vendor
    - Reconciliation log (just the row to append)
    - Validation: "all required fields filled ✓"
  → Sends all 3, updates sheet, done in one turn
```

The scene definition IS the agent's reasoning externalized:
- **What data do I need?** → hooks
- **What subset matters?** → `.filter()`, `.map()`
- **What's the current state?** → metrics, status widgets
- **What actions are available?** → pre-filled forms, validation checks
- **What's already done?** → progress widgets

None of this lives in the context window. It lives in the scene. The agent's working memory stays tiny. Tokens go to **decisions**, not remembering.

### Self-Validation

Instead of: call tool → get error → parse error → retry → get different error → retry again...

The agent defines a view that shows validation state upfront:

```javascript
const form = { name: order.customer, amount: order.total, category: null };
const valid = Object.entries(form).map(([k, v]) => ({ field: k, status: v ? "✓" : "✗ missing" }));
return [
  KeyValue({ pairs: valid.map(v => ({ key: v.field, value: v.status })), title: "Validation" }),
];
```

Agent sees "category: ✗ missing" in the summary. Fills it. One turn instead of three round-trip errors.

### The Scene IS the Interface

This changes what a "job" looks like. Today: a chat thread where the agent talks and sometimes shows widgets. Tomorrow: a **scene that evolves**.

Each job run repaints the scene. The scene advances like a multi-step app — but it's not predefined. The agent decides what to show next based on what happened. The reactive hooks re-fetch on each evaluation, so the view always reflects reality.

The chat becomes optional. Some jobs are pure scene interactions — the agent exposes actions as buttons, the user taps, the agent redefines the scene with new state. No chat needed. Other jobs mix both — the scene shows structured data, the chat handles freeform discussion.

The agent decides per job what UI it needs:
- Data review? → Pure scene, no chat
- Complex decision? → Scene for context + chat for discussion
- Simple question? → Chat only, no scene

The agent can even change its mind mid-job. Start with chat ("What do you need?"), switch to scene mode once it understands the task ("Here's what I found"), drop back to chat if clarification is needed.

The chat itself can be a widget in the scene — just another component the agent chooses to include or not. The scene is the container. Everything else is a widget inside it.

### Why This Is Cheaper

Rewriting a scene definition: ~200-400 tokens of code.

The equivalent via tool calling:
- 3 LLM turns × 2k tokens context each = 6k input tokens
- 3 tool calls × 500 token results = 1.5k
- 3 assistant messages × 200 tokens = 600 tokens
- Total: ~8k tokens

Scene rewrite is **20x cheaper** than the tool-calling equivalent. And it's faster (one round trip vs three). And the result is better (structured widgets vs chat text).

## What Exists Today

- **SDK runtime** — `evaluateScene()` evaluates scene code strings with hooks + views in scope
- **4 provider hooks** — Gmail, Sheets, GitHub, Postgres (wrapping existing clients + credential resolution)
- **11 view constructors** — Table, List, Metric, Chart, KeyValue, Map, Calendar, Document, Status, Image, Plan
- **Satori rendering** — SDK widgets → PNG/SVG (proven, tests passing)
- **PDF generation** — SDK widgets → HTML → Playwright → vector PDF with selectable text
- **Agent tool** — `daslab_define_scene` registered in the daslab provider, agents can use it now
- **OTel instrumentation** — HTTP spans + DB query spans (built earlier in this session)
- **Live data proof** — Generated a real PDF report from live GitHub API data through the full reactive pipeline

## What's Not Obvious — Potential Gaps

**Code execution trust**: The agent writes JavaScript that runs server-side. For the MVP we trust it (same model as the existing `daslab_run_function` tool). For production, the scene code runs in E2B sandboxes or Fly.io isolates — infrastructure that already exists.

**Stale data**: Hooks fetch on evaluation. For live dashboards, scenes need periodic re-evaluation (cron or `scene_commit` triggers — both exist in the scheduler). The reactive model is "re-run the function" not "maintain open connections."

**Complex transforms**: The agent writes JavaScript. It's great at `.filter()`, `.map()`, `.reduce()`. But complex data processing (ML inference, heavy computation) should be tools, not inline code. The SDK should make it easy to call tools from within a scene definition.

**View template marketplace**: When autocompile produces view templates, how do users discover and share them? This is a product design question, not a technical one. The infrastructure (templates as stored SDK functions) supports it.

## Why This Matters

Every company building AI agents faces the same problem: the agent can call tools, but it can't *see*. It has no structured, composable, renderable way to present its work. Developers hack together chat UIs, markdown dumps, or fragile webviews.

Daslab gives agents eyes. The SDK is how agents define what they see. The views are how they show their work. The scenes are where humans and agents collaborate on the same live data. And the compilation loop makes it all get better automatically.

The moat isn't the code — it's the accumulated view templates, the benchmark data, the gym results, all built from real operational usage. That's IP that compounds over time and can't be replicated by reading source code.
