# daslab-sdk · scene scrubber

A static HTML page that visualizes scene timelines from any OTel JSONL trace
containing `scene.set` events. Zero install, zero build step.

## Use

```bash
# Serve the directory (any static server works)
cd viewer
python3 -m http.server 5173

# Open http://localhost:5173 → pick an example or upload your own JSONL
```

Or open `index.html` in a browser directly — the file picker, drag-drop, and
paste-textarea all work without a server. (The example dropdown needs a
local server because of `fetch()` restrictions on `file://`.)

## Examples

Five fixtures under `example-traces/`, each mirroring an AutomationBench
domain shape:

| File | What it shows |
|---|---|
| `sales-routing.jsonl` | Multi-hop deal routing (currency conversion + tier resolution + escalation lookup) |
| `support-sla.jsonl` | SLA breach sweep across a ticket queue |
| `marketing-campaign.jsonl` | Campaign performance review with CPA-threshold pause |
| `hr-onboarding.jsonl` | New-hire onboarding (welcome emails + laptop requests + training calendar) |
| `gmail-triage.jsonl` | Inbox triage with classification + draft reply |

Regenerate them at any time:

```bash
cd ..
bun viewer/generate.ts
```

## Trace format

Each line of the JSONL is an OTel span with `events[]` that may include
`scene.set` events. The viewer extracts those and reconstructs the timeline.

Required attributes per `scene.set` event:

```json
{
  "name": "scene.set",
  "time_ns": 1777642339134456789,
  "attributes": {
    "scene.key":         "inbox",
    "scene.value":       "[{...}, {...}]",
    "scene.value.type":  "table",
    "scene.commit_hash": "ab12cd34ef567890"
  }
}
```

This is what the [`daslab-sdk`](https://github.com/daslabhq/daslab-sdk)
emits automatically when you call `scene.set(key, value)` from inside an
OTel-traced span.
