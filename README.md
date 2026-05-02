# daslab-sdk

> Snapshot what your agent knew, at every step.

`scene.set(key, value)` emits an OTel span event with a content-addressed snapshot of the value. Whatever sink you have configured — Phoenix, Braintrust, Honeycomb, Datadog, Jaeger, JSONL, Daslab — sees it.

![scrubber demo](./docs/readme-demo.gif)

*Above: the bundled scrubber stepping through one of [AutomationBench](https://github.com/zapier/AutomationBench)'s tasks (`simple.email_sf_contact_phone_update` — find Jordan Lee's email, extract her new phone number, update the Salesforce contact). The agent's view of the world emerges step by step.*

**Try it live →** <https://daslabhq.github.io/daslab-sdk/>

## Install

```bash
npm install daslab-sdk @opentelemetry/api
```

## Use

```ts
import { scene } from "daslab-sdk";

scene.set("inbox",   emails);          // → table
scene.set("flagged", flagged.length);  // → metric
scene.set("draft",   draft);           // → text/json (auto-inferred)
```

Each call adds an event named `scene.set` to the active OTel span. The widget hint is inferred from the value's shape; override with `{ as }`.

## What you can do with the events

- **Read them in any OTel viewer.** Span events render inline in Phoenix, Braintrust, Honeycomb, Datadog, Jaeger, etc. Trace becomes legible: not just "LLM call → tool call → done" but "after step 3, inbox=47, flagged=3, draft drafted."
- **Replay deterministically.** Every snapshot is content-hashed. Two runs with the same inputs produce the same hashes — useful for confirming reproducibility.
- **Diff between runs.** `sceneDiff(before, after)` (see below) returns added / removed / changed / unchanged keys with deep equality.
- **Share traces.** A JSONL dump is enough to reproduce a failure off-system.
- **Use them as labeled trajectories.** Each `scene.set` is a content-addressed step output, which is the shape Verifiers / RL training expects.

## API

```ts
scene.set("inbox", emails);

// Override inferred type
scene.set("notes", "raw text", { as: "text" });

// Document the key (helps coding-agent readers + UIs)
scene.set("budget", 12_000, { description: "EUR remaining" });

// Atomically commit several keys under one hash
scene.set("a", 1);
scene.set("b", 2);
scene.commit();
```

### Wire format

Each `scene.set` adds an event named `scene.set` to the current OTel span:

| Attribute | Meaning |
|---|---|
| `scene.key` | The user-supplied key |
| `scene.commit_hash` | sha256 over canonical batch JSON, 16-char hex |
| `scene.value` | JSON-encoded value (truncated at 32 KB) |
| `scene.value.type` | Widget hint: `table` / `metric` / `text` / `image` / `list` / `json` |
| `scene.value.size` | JSON byte size |
| `scene.description` | Optional |

The contract is plain OTel — no daslab-specific consumer needed.

### Inferred types

| Value shape | Type |
|---|---|
| `[{...}, {...}]` (array of objects with consistent keys) | `table` |
| `42` (number) | `metric` |
| `"hello"` (string) | `text` |
| `[1, 2, 3]` (array of primitives) | `list` |
| `{ url: "x.png" }` or `{ mimeType: "image/..." }` | `image` |
| anything else | `json` |

## Diff

```ts
import { sceneDiff, buildSnapshot } from "daslab-sdk";

const before = buildSnapshot(events, "ab12cd34ef567890");  // commit_hash
const after  = buildSnapshot(events, "ff99ee88aa776655");
const d = sceneDiff(before, after);
//  {
//    added:    { draft: {...} },
//    removed:  {},
//    changed:  [ { key: "flagged", before: 0, after: 2 } ],
//    unchanged: ["inbox", "budget"]
//  }
```

Useful for: comparing two prompts on the same input, detecting belief drift mid-run, surfacing what a single tool call mutated.

## Static scrubber

A single HTML file under [`viewer/`](./viewer) parses JSONL OTel traces and renders the scene timeline as scrubbable cards (table / metric / text / image / json). No build step.

Live: <https://daslabhq.github.io/daslab-sdk/> · or run locally:

```bash
cd viewer
python3 -m http.server 5173
# http://localhost:5173
```

Eight fixtures are bundled — five synthetic agent runs and three picked from AutomationBench (see below).

## AutomationBench schemas + fixtures

[Zapier's AutomationBench](https://github.com/zapier/AutomationBench) defines typed Pydantic models for 49 SaaS apps (Gmail, Salesforce, Slack, Google Sheets, HubSpot, Airtable, Notion, Jira, Asana, Trello, BambooHR, QuickBooks, …). They're exported as JSON Schema under [`schemas/automationbench/`](./schemas/automationbench) so you can pin scenes to a typed contract without a Python dependency:

```ts
import gmail from "daslab-sdk/schemas/automationbench/gmail.json"
  with { type: "json" };

scene.set("inbox", emails, { schema: gmail });
```

All 806 of their task definitions are also dumped under `viewer/example-traces/automationbench/tasks/` for browsing. Three hand-scripted fixtures live under `viewer/example-traces/automationbench-*.jsonl` — pick them in the scrubber dropdown.

Re-sync when AutomationBench updates:

```bash
../../references/AutomationBench/.venv/bin/python scripts/sync-automationbench.py
bun scripts/build-ab-fixtures.ts
```

## Daslab platform

This SDK is the substrate behind [daslab.dev](https://daslab.dev) — a platform for running, observing, and iterating on agents end-to-end with persistent multi-platform scene viewing (iOS / desktop / web), cross-run queries, and RL training on the resulting trajectories. The SDK works fully standalone; the platform is what we're building on top of it.

## Roadmap

v0.0.3 (current)

- ✅ `scene.set / commit / pending`, auto widget-type inference, content hashing, graceful no-op
- ✅ `sceneDiff` + `buildSnapshot`
- ✅ Static HTML scrubber + 8 fixtures, hosted on Pages
- ✅ AutomationBench: 49 JSON Schemas, 806 task defs, 3 hand-scripted fixtures

Coming next

- Real-model AutomationBench runs — instrument their Verifiers env so `scene.set` fires per actual tool call
- `defineScene({ key, schema })` — typed scene declarations with JSON Schema validation

## License

MIT. See [LICENSE](./LICENSE).

## Related

- [`agent-otel`](https://github.com/mirkokiefer/agent-otel) — the OTel router for agent telemetry. Fanout to any sink.
- [`scry`](https://github.com/mirkokiefer/agent-otel#scry--sdk-and-cli-for-agents-to-query-their-own-traces) — SDK + CLI for agents to query their own traces. Bundled with `agent-otel`.
- [`autocompile`](https://github.com/mirkokiefer/autocompile) — observes repeated agent runs and compiles the invariant parts into code, leaving the LLM only the decisions that need judgment.
