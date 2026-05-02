/**
 * Build JSONL fixtures from picked AutomationBench tasks.
 *
 * Reads task JSON dumps under viewer/example-traces/automationbench/tasks/,
 * runs hand-scripted "ideal solution" narratives that emit scene.set events,
 * and writes JSONL traces the static scrubber renders.
 *
 * The point: AutomationBench's task definitions are already JSON-shaped
 * (initial_state, prompt, tools, assertions) — no Python at runtime needed.
 * We just snapshot the world state at narrative checkpoints.
 *
 * Re-run after `scripts/sync-automationbench.py` updates the task dumps:
 *
 *     bun scripts/build-ab-fixtures.ts
 */

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { trace, context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scene } from "../src/scene.js";

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
trace.setGlobalTracerProvider(provider);
const tracer = trace.getTracer("scene-otel-automationbench");

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TASKS = join(ROOT, "viewer/example-traces/automationbench/tasks");
const FIXTURES_OUT = join(ROOT, "viewer/example-traces");

interface ABTask {
  task: string;
  example_id: number;
  prompt: Array<{ role: string; content: string }>;
  info: {
    zapier_tools: string[];
    initial_state: Record<string, unknown>;
    assertions?: Array<Record<string, unknown>>;
  };
}

function loadTask(slug: string): ABTask {
  return JSON.parse(readFileSync(join(TASKS, `${slug}.json`), "utf8"));
}

function dumpJsonl(file: string): void {
  const spans = exporter.getFinishedSpans();
  const lines = spans.map(serializeSpan).join("\n");
  writeFileSync(file, lines + "\n");
  exporter.reset();
  scene._resetForTests();
}

function serializeSpan(s: ReadableSpan): string {
  return JSON.stringify({
    trace_id:       s.spanContext().traceId,
    span_id:        s.spanContext().spanId,
    parent_span_id: s.parentSpanContext?.spanId ?? null,
    name:           s.name,
    start_time_ns:  hrToNs(s.startTime),
    end_time_ns:    hrToNs(s.endTime),
    kind:           s.kind,
    status:         s.status,
    attributes:     s.attributes,
    events:         s.events.map(e => ({
      name:        e.name,
      time_ns:     hrToNs(e.time),
      attributes:  e.attributes ?? {},
    })),
  });
}

function hrToNs(hr: [number, number]): number { return hr[0] * 1e9 + hr[1]; }

mkdirSync(FIXTURES_OUT, { recursive: true });

function buildFixture(slug: string, outName: string, script: (task: ABTask) => void): void {
  const task = loadTask(slug);
  const span = tracer.startSpan(task.task);
  context.with(trace.setSpan(context.active(), span), () => {
    scene.set("request", task.prompt[1]?.content ?? "", { description: "user request" });
    // Snapshot every app present in initial_state so the scrubber starts
    // with a complete view of the world.
    for (const [app, state] of Object.entries(task.info.initial_state)) {
      if (app === "meta") continue;
      scene.set(app, state, { description: "initial state" });
    }
    script(task);
  });
  span.end();
  const out = join(FIXTURES_OUT, outName);
  dumpJsonl(out);
  console.log(`✓ ${task.task} → ${outName}`);
}

// ---------------------------------------------------------------------------
// Scripted solutions
// ---------------------------------------------------------------------------

// Task 1: simple.email_sf_contact_phone_update — "Jordan Lee phone update"
buildFixture("simple_email_sf_contact_phone_update", "automationbench-jordan-lee-phone.jsonl", (task) => {
  const inbox = (task.info.initial_state.gmail as any)?.messages ?? [];
  const sf    = task.info.initial_state.salesforce as any;

  // Step 1: search Gmail for the email mentioning Jordan Lee.
  const found = inbox.find((m: any) => /Jordan Lee/i.test((m.body_plain ?? "") + " " + (m.from_ ?? "")))
              ?? inbox.find((m: any) => /jordan/i.test(m.from_ ?? "")) ?? inbox[0];
  scene.set("found_email", {
    id: found?.id, from: found?.from_, subject: found?.subject,
  }, { description: "gmail_find_email" });

  // Step 2: read the body to extract the new phone number.
  scene.set("email_body", found?.body_plain ?? "", { description: "gmail_get_email_by_id" });
  const phoneMatch = (found?.body_plain ?? "").match(/(\+?\d[\d\s\-().]{7,}\d)/);
  const newPhone = phoneMatch ? phoneMatch[1] : "+1-555-0101";
  scene.set("extracted_phone", newPhone, { description: "parsed from body" });

  // Step 3: find Jordan Lee's Salesforce contact.
  const contact = sf?.contacts?.find((c: any) => /Jordan/i.test(c.first_name ?? c.FirstName ?? ""))
               ?? sf?.contacts?.[0];
  scene.set("found_contact", contact, { description: "salesforce_find_records" });

  // Step 4: update the contact's phone.
  if (contact) {
    const updated = { ...contact, phone: newPhone, _updated_field: "phone" };
    scene.set("found_contact", updated, { description: "salesforce_contact_update" });
  }

  scene.set("status", "complete", { description: "phone updated" });
});

// Task 2: operations.airtable_gmail_visitor_followup — visitor NDA logging
buildFixture("operations_airtable_gmail_visitor_followup", "automationbench-visitor-nda.jsonl", (task) => {
  const inbox = (task.info.initial_state.gmail as any)?.messages ?? [];

  // Step 1: locate the front-desk NDA email.
  const ndaEmail = inbox.find((m: any) => /frontdesk@/i.test(m.from_ ?? "")) ?? inbox[0];
  scene.set("nda_email", {
    id: ndaEmail?.id, from: ndaEmail?.from_, subject: ndaEmail?.subject,
  }, { description: "gmail_find_email" });

  // Step 2: read body to get visitor name + host.
  scene.set("nda_details", ndaEmail?.body_plain ?? "", { description: "gmail_get_email_by_id" });

  // Step 3: log the NDA in Airtable as a comment on the visitor record.
  scene.set("airtable_comment", {
    base:    "base_ops",
    table:   "Visitors",
    text:    "NDA completed — confirmed by frontdesk on " + (ndaEmail?.date ?? "today"),
  }, { description: "airtable_add_comment" });

  // Step 4: notify the host via email.
  scene.set("notification_sent", {
    to:      "host-ops@example.com",
    subject: "Visitor NDA on file",
    body:    "Heads up — the visitor's NDA is now logged in Airtable.",
  }, { description: "gmail_send_email" });

  scene.set("status", "complete", { description: "NDA logged + host notified" });
});

// Task 3: marketing.linkedin_speaker_outreach — qualify + reach out to keynote speakers
buildFixture("marketing_linkedin_speaker_outreach", "automationbench-speaker-outreach.jsonl", (task) => {
  const inbox    = (task.info.initial_state.gmail as any)?.messages ?? [];
  const linkedin = task.info.initial_state.linkedin as any;

  // Step 1: list emails to find the requirements + candidate list.
  scene.set("inbox_count", inbox.length, { description: "gmail_list_emails" });

  // Step 2: open the requirements email.
  const reqEmail = inbox.find((m: any) => /speaker|keynote|requirements/i.test(m.subject ?? ""))
                ?? inbox[0];
  scene.set("requirements_email", {
    from: reqEmail?.from_, subject: reqEmail?.subject, body: reqEmail?.body_plain,
  }, { description: "gmail_find_email" });

  // Step 3: look up each candidate on LinkedIn.
  const profiles = linkedin?.profiles ?? [];
  scene.set("candidates", profiles.map((p: any) => ({
    name:        p.name ?? p.full_name,
    headline:    p.headline,
    followers:   p.follower_count,
    qualifies:   (p.follower_count ?? 0) >= 5_000,
  })), { description: "linkedin_find_profile" });

  // Step 4: send outreach to qualified candidates.
  const qualified = profiles.filter((p: any) => (p.follower_count ?? 0) >= 5_000);
  scene.set("messages_sent", qualified.map((p: any) => ({
    recipient: p.name ?? p.full_name,
    subject:   "Keynote invite — Nimbus Live",
    sent_at:   new Date().toISOString(),
  })), { description: "linkedin_send_message" });

  scene.set("status", `${qualified.length} of ${profiles.length} contacted`, { description: "outreach complete" });
});

console.log(`\n→ fixtures written to ${FIXTURES_OUT}`);
