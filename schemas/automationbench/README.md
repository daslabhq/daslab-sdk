# `daslab-sdk/schemas/automationbench`

49 JSON Schemas covering every SaaS app in
[Zapier's AutomationBench](https://github.com/zapier/AutomationBench) WorldState
— Gmail, Salesforce, Slack, Google Sheets, HubSpot, Airtable, Notion, Jira,
Asana, Trello, BambooHR, QuickBooks, Stripe, … the whole catalogue.

These were generated once from AutomationBench's Pydantic models via
`model_json_schema()` and checked in here so anyone using `daslab-sdk` can
pin scenes to a typed contract without a Python dependency:

```ts
import gmailSchema from "daslab-sdk/schemas/automationbench/gmail.json"
  with { type: "json" };

scene.set("inbox", emails, { schema: gmailSchema });   // typed scene
```

## Layout

| File | Contents |
|---|---|
| `<app>.json` | JSON Schema for one app's WorldState (49 files) |
| `_world.json` | Composite — full WorldState union schema |
| `_index.json` | Manifest mapping app key → file + Pydantic class name |

## Re-generating

When AutomationBench updates their schemas:

```bash
# from daslab-sdk/
../../references/AutomationBench/.venv/bin/python scripts/sync-automationbench.py
```

The same script also re-dumps every task definition into
`viewer/example-traces/automationbench/tasks/`.

## License

The schemas inherit AutomationBench's MIT license — see their repo for the
canonical Pydantic source.
