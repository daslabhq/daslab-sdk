# daslab-sdk

> Three lines and your agent's traces tell you what your agent **knew**, not just what it **did**.

The scene SDK for AI agents. Snapshot your agent's view of the world at any step, get a content-addressed timeline, replay & diff between runs, get a Verifiers / RL-ready labeled environment for free.

Works with any OTel pipeline you already have — Phoenix, Braintrust, LangSmith, Honeycomb, Datadog, Jaeger, anything. Daslab account optional.

---

## Install

```bash
npm install daslab-sdk @opentelemetry/api
```

## Use

```ts
import { scene } from "daslab-sdk";

// Anywhere inside an OTel-traced span
scene.set("inbox",   emails);          // → table
scene.set("flagged", flagged.length);  // → metric
scene.set("draft",   draft);           // → text/json (auto-inferred)
```

That's it. Each call emits an OTel span event with the snapshot, a content-addressed `commit_hash`, and an inferred widget type. Whatever sink you have (Phoenix / Braintrust / Honeycomb / OTLP collector / a JSONL file) sees it. No infra change.

## Why

Today your agent traces look like:

```
LLM call → tool call → LLM call → tool call → done
```

Useful for billing. Useless for debugging.

With `scene.set` they look like:

```
step 1 → inbox: 47 emails       budget: $12k
step 2 → flagged: 12 emails     budget: $12k
step 3 → flagged: 3 urgent      budget: $12k
step 4 → draft: "Re: invoice…"  budget: $11.4k
step 5 → sent ✓                 budget: $11.4k
```

You can scrub through the agent's mind. Diff between runs. Reproduce a failure. Score step-by-step. Train RL on a real labeled trajectory.

## What you get

- 📡 **Richer traces in any OTel tool you already use.** Phoenix / Braintrust / Honeycomb / Datadog / Jaeger / OTLP — they all render the events inline.
- 🔁 **Deterministic replay.** Every snapshot is content-hashed. Run twice with the same inputs → same hashes → confidence the run is reproducible.
- 🪞 **Diff between runs.** Same agent, two prompts. Diff the scenes at corresponding steps. The eval primitive every team builds badly themselves.
- 🐛 **Sharable bug reports.** "Here's the JSONL trace — at t=4.2s the agent thought 47 things were unpaid; only 3 were." Reproducible without sending your infra.
- 🤖 **A memory your coding agent can read.** Claude Code / Cursor / your in-house agent reads scene events to debug *itself*.
- 🧪 **Verifiers / RL ready.** Each `scene.set` is a labeled step output. RL training gets a labeled trajectory for free.

## API

```ts
import { scene } from "daslab-sdk";

// Snapshot one key
scene.set("inbox", emails);

// Override the inferred renderer hint
scene.set("notes", "raw text", { as: "text" });

// Document the key (helps coding agents + UIs)
scene.set("budget", 12_000, { description: "EUR remaining for this run" });

// Atomically commit several keys under one hash
scene.set("a", 1);
scene.set("b", 2);
scene.commit();    // a + b grouped under the same commit_hash
```

### Span event format (the wire contract)

Each `scene.set` adds an event named `scene.set` to the current OTel span:

| Attribute | Meaning |
|---|---|
| `scene.key` | The user-supplied key |
| `scene.commit_hash` | sha256 over canonical batch JSON, 16-char hex |
| `scene.value` | JSON-encoded value (truncated at 32KB) |
| `scene.value.type` | Inferred widget hint: `table` / `metric` / `text` / `image` / `list` / `json` |
| `scene.value.size` | JSON byte size (for budget tracking) |
| `scene.description` | Optional, if provided |

Anyone can ingest these — the contract is just OTel.

### Auto widget-type inference

Used by default (override with `{ as }`):

| Value shape | Inferred type |
|---|---|
| `[{...}, {...}]` (array of objects with consistent keys) | `table` |
| `42` (number) | `metric` |
| `"hello"` (string) | `text` |
| `[1, 2, 3]` (array of primitives) | `list` |
| `{ url: "x.png" }` or `{ mimeType: "image/..." }` | `image` |
| anything else | `json` |

## Works with anything OTel

`daslab-sdk` only depends on `@opentelemetry/api` (peer). It calls `trace.getActiveSpan()` and adds events. If you don't have OTel set up, it's a graceful no-op. If you do, your sink already sees the events.

Tested against:

- ✅ Phoenix (Arize)
- ✅ Braintrust
- ✅ LangSmith (via OTLP)
- ✅ Honeycomb
- ✅ Datadog
- ✅ Jaeger / Tempo (via OTLP)
- ✅ JSONL files (`@opentelemetry/exporter-trace-otlp-http` + a local file)
- ✅ Daslab Server (the multi-platform reactive viewer — see below)

## Daslab Server (optional, the upsell)

The SDK alone is already useful — but the Daslab platform compounds it:

| | OSS SDK alone | Daslab Server |
|---|---|---|
| Trace events in any OTel tool | ✅ | ✅ |
| Deterministic replay & diff | ✅ | ✅ |
| **Persistent searchable run history** | ❌ | ✅ |
| **Live multi-platform scene viewer** (iOS / desktop / web) | ❌ | ✅ |
| **Cross-trace queries** ("all runs where step 3 failed") | ❌ | ✅ |
| **Rich media in scenes** (image / audio / video) | ❌ | ✅ |
| **Scene actions** (approve / redo / reroute) | ❌ | ✅ |
| **Sharing, comments, collab per step** | ❌ | ✅ |
| **Hosted MCP** (Claude Code reads YOUR runs) | ❌ | ✅ |
| **RL eval & training at scale** | ❌ | ✅ |

When the active OTel span carries a `daslab.platform` attribute, snapshots also commit to Daslab's content-addressed scene tree so the multi-platform viewer picks them up. That's opt-in — calling `scene.set` from anywhere works without it.

Learn more: <https://daslab.dev>

## Try it in the browser

A static scrubber lives in [`viewer/`](./viewer) — a single HTML file (no build step) that visualizes any OTel JSONL with `scene.set` events. Five example traces ship under `viewer/example-traces/`, each mirroring an [AutomationBench](https://github.com/zapier/AutomationBench) domain shape:

- Sales · multi-hop deal routing
- Support · SLA breach sweep
- Marketing · campaign performance review
- HR · new-hire onboarding
- Simple · gmail triage

```bash
cd viewer
python3 -m http.server 5173
# http://localhost:5173 → pick an example or upload your own JSONL
```

## Diff between scenes

```ts
import { sceneDiff, buildSnapshot } from "daslab-sdk";

// Walk a stream of scene events to the moment you care about
const before = buildSnapshot(events, "ab12cd34ef567890");  // commit_hash
const after  = buildSnapshot(events, "ff99ee88aa776655");

const d = sceneDiff(before, after);
// {
//   added:    { draft: {...} },
//   removed:  {},
//   changed:  [ { key: "flagged", before: 0, after: 2 } ],
//   unchanged: ["inbox", "budget"]
// }
```

This is the eval primitive for: comparing two prompts on the same input,
detecting agent-belief drift mid-run, surfacing exactly what a single tool
call mutated.

## AutomationBench × daslab-sdk

[Zapier's AutomationBench](https://github.com/zapier/AutomationBench) ships
49 typed Pydantic models covering Gmail, Salesforce, Slack, Google Sheets,
HubSpot, Airtable, Notion, Jira, … the whole SaaS landscape. We've exported
all of them to JSON Schema and checked them in:

```ts
import gmailSchema from "daslab-sdk/schemas/automationbench/gmail.json"
  with { type: "json" };
import { scene } from "daslab-sdk";

scene.set("inbox", emails, { schema: gmailSchema });   // typed scene
```

See [`schemas/automationbench/`](./schemas/automationbench) for the full
catalogue + a manifest. Three task fixtures (`automationbench-*.jsonl`)
live under `viewer/example-traces/` to demo turn-by-turn replay of
AutomationBench tasks — the visual layer their roadmap calls out as a
future enhancement.

## Roadmap

v0.0.3 (current)

- ✅ `scene.set / commit / pending`
- ✅ Auto widget-type inference
- ✅ Deterministic content hashing
- ✅ Graceful no-op without OTel
- ✅ `sceneDiff` + `buildSnapshot` — attribute-level diff between snapshots
- ✅ Static HTML scrubber under [`viewer/`](./viewer)
- ✅ AutomationBench integration — 49 JSON Schemas + 806 task definitions + 3 hand-scripted fixtures

Coming next

- Real-model AutomationBench runs — wrap their tool dispatch to emit `scene.set` per call, run a sweep of tasks, ship the JSONL
- `defineScene({ key, schema })` — typed scene declarations with JSON Schema validation
- Hosted scrubber on GitHub Pages

## License

MIT. See [LICENSE](./LICENSE).

## Related

- [`agent-otel`](https://www.npmjs.com/package/agent-otel) — the OTel router for agent telemetry. Fanout to any sink.
- [`scry`](https://www.npmjs.com/package/agent-otel) — CLI to inspect / replay / diff agent traces. Bundled with `agent-otel`.
