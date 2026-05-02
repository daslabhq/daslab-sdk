/**
 * Generate JSONL OTel trace fixtures for the static scrubber.
 *
 * Each fixture is a synthetic agent run that uses scene.set() to snapshot
 * its world-state at each step. The shapes mirror AutomationBench's
 * domain tasks (sales / support / marketing / hr / simple) so the demo
 * lands the "AutomationBench with eyes" pitch.
 *
 * Run:
 *   bun viewer/generate.ts
 *
 * Output:
 *   viewer/example-traces/<name>.jsonl  (one OTel span per line)
 */

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { trace, context, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scene } from "../src/scene.js";

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
trace.setGlobalTracerProvider(provider);
const tracer = trace.getTracer("scene-otel-fixtures");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function step(name: string, fn: () => void): void {
  const span = tracer.startSpan(name);
  context.with(trace.setSpan(context.active(), span), () => {
    fn();
  });
  span.end();
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

function hrToNs(hr: [number, number]): number {
  return hr[0] * 1e9 + hr[1];
}

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "example-traces");
mkdirSync(FIXTURES_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// 1. SALES — Meridian-style multi-hop lookup
//    (mirrors AutomationBench sales.multi_hop_lookup)
// ---------------------------------------------------------------------------

step("sales.multi_hop_lookup", () => {
  scene.set("opportunity", {
    id: "opp_meridian",
    name: "Meridian Corp Platform Deal",
    stage: "Closed Won (pending)",
    amount_eur: 245_000,
  }, { description: "deal we just closed" });

  scene.set("account_tier", "unknown", { description: "must resolve from sheet" });

  scene.set("fx_rates", [
    { Currency: "EUR", USDRate: 1.10, Updated: "2026-01-10" },
    { Currency: "GBP", USDRate: 1.27, Updated: "2026-01-10" },
  ]);

  scene.set("amount_usd", 269_500, { description: "245k EUR × 1.10" });

  scene.set("account_tier", "Enterprise", { description: "resolved from Account Hierarchy sheet" });

  scene.set("escalations_open", [
    { case_id: "c-981", priority: "High", subject: "API rate limits" },
  ]);

  scene.set("routing_targets", [
    "executive-team@example.com",
    "support-escalation@example.com",
  ]);

  scene.set("emails_sent", [
    { to: "executive-team@example.com", subject: "Meridian Corp won — $269.5K" },
    { to: "support-escalation@example.com", subject: "Heads up — Meridian win, open Hi-pri case c-981" },
  ]);

  scene.set("opportunity", {
    id: "opp_meridian",
    name: "Meridian Corp Platform Deal",
    stage: "Closed Won",
    amount_eur: 245_000,
  });
});
dumpJsonl(join(FIXTURES_DIR, "sales-routing.jsonl"));

// ---------------------------------------------------------------------------
// 2. SUPPORT — SLA escalation sweep
//    (mirrors AutomationBench support.sla_*)
// ---------------------------------------------------------------------------

step("support.sla_sweep", () => {
  scene.set("tickets", [
    { id: "t-1", subject: "Login broken",   priority: "High", age_hours: 22 },
    { id: "t-2", subject: "Slow dashboard", priority: "Med",  age_hours: 8  },
    { id: "t-3", subject: "Refund request", priority: "Low",  age_hours: 70 },
    { id: "t-4", subject: "Auth 500s",      priority: "High", age_hours: 4  },
  ]);

  scene.set("sla_policy", {
    High: 24,
    Med:  72,
    Low:  168,
  }, { description: "max hours before breach" });

  scene.set("breaching", [
    { id: "t-1", reason: "High priority, 22h old, breach in 2h" },
  ]);

  scene.set("near_breach_count", 1);

  scene.set("escalation_email", {
    to: "oncall-support@example.com",
    subject: "1 ticket near SLA breach",
    body: "t-1 (Login broken) breaches in 2h. Please prioritize.",
  });

  scene.set("emails_sent", 1);
});
dumpJsonl(join(FIXTURES_DIR, "support-sla.jsonl"));

// ---------------------------------------------------------------------------
// 3. MARKETING — campaign performance review
//    (mirrors AutomationBench marketing.campaign_*)
// ---------------------------------------------------------------------------

step("marketing.campaign_review", () => {
  scene.set("campaigns", [
    { id: "c-spring", name: "Spring Promo", spend_usd: 12_400, conversions: 89 },
    { id: "c-newuser", name: "New-User",    spend_usd: 9_800,  conversions: 142 },
    { id: "c-retain",  name: "Retention",   spend_usd: 6_300,  conversions: 31 },
  ]);

  scene.set("cpa_by_campaign", [
    { id: "c-spring",  cpa_usd: 139.33 },
    { id: "c-newuser", cpa_usd:  69.01 },
    { id: "c-retain",  cpa_usd: 203.23 },
  ]);

  scene.set("threshold_usd", 150, { description: "CPA threshold for pause" });

  scene.set("flagged_campaigns", [
    { id: "c-retain", cpa_usd: 203.23, action: "pause" },
  ]);

  scene.set("paused_count", 1);

  scene.set("summary_post", {
    channel: "#marketing-ops",
    text: "Paused c-retain (CPA $203 vs $150 threshold). c-newuser top performer at $69 CPA.",
  });
});
dumpJsonl(join(FIXTURES_DIR, "marketing-campaign.jsonl"));

// ---------------------------------------------------------------------------
// 4. HR — new-hire onboarding
//    (mirrors AutomationBench hr.onboarding_*)
// ---------------------------------------------------------------------------

step("hr.onboarding", () => {
  scene.set("new_hires", [
    { id: "u-101", name: "Alice Chen",  start_date: "2026-05-04", role: "Engineer", needs_laptop: true,  needs_training: ["security", "code-review"] },
    { id: "u-102", name: "Bobby Patel", start_date: "2026-05-04", role: "PM",       needs_laptop: false, needs_training: ["security", "product-101"] },
    { id: "u-103", name: "Cora Diaz",   start_date: "2026-05-11", role: "Designer", needs_laptop: true,  needs_training: ["security", "design-system"] },
  ]);

  scene.set("training_modules", [
    { id: "security", title: "Security Foundations", duration_min: 45 },
    { id: "code-review", title: "Code Review Practice", duration_min: 60 },
    { id: "product-101", title: "Product 101", duration_min: 90 },
    { id: "design-system", title: "Design System", duration_min: 75 },
  ]);

  scene.set("welcome_emails_drafted", 3);

  scene.set("laptop_requests", [
    { user: "u-101", model: "MBP 16 M4" },
    { user: "u-103", model: "MBP 16 M4" },
  ]);

  scene.set("calendar_invites", [
    { user: "u-101", event: "Security · 2026-05-04 10:00" },
    { user: "u-101", event: "Code Review · 2026-05-04 13:00" },
    { user: "u-102", event: "Security · 2026-05-04 10:00" },
    { user: "u-102", event: "Product 101 · 2026-05-04 14:00" },
    { user: "u-103", event: "Security · 2026-05-11 10:00" },
    { user: "u-103", event: "Design System · 2026-05-11 13:30" },
  ]);

  scene.set("status", "ready", { description: "all 3 hires queued" });
});
dumpJsonl(join(FIXTURES_DIR, "hr-onboarding.jsonl"));

// ---------------------------------------------------------------------------
// 5. SIMPLE — gmail triage (the canonical "small agent" demo)
// ---------------------------------------------------------------------------

step("simple.gmail_triage", () => {
  scene.set("inbox", [
    { id: "m-1", from: "alice@vendor.com",  subject: "Invoice #4421 — overdue",      unread: true },
    { id: "m-2", from: "newsletter@nyt",   subject: "Morning briefing",              unread: true },
    { id: "m-3", from: "bob@team",          subject: "Re: standup",                  unread: true },
    { id: "m-4", from: "alerts@stripe",     subject: "Payout completed: $1,200",    unread: true },
    { id: "m-5", from: "ceo@company.com",   subject: "Quick question",               unread: true },
  ], { description: "5 unread emails" });

  scene.set("unread_count", 5);

  scene.set("classifier_rules", [
    { from_contains: "invoice",  label: "billing" },
    { from_contains: "alerts@",  label: "ops" },
    { from_contains: "ceo@",     label: "vip" },
    { from_contains: "newsletter", label: "newsletter" },
  ]);

  scene.set("classified", [
    { id: "m-1", label: "billing" },
    { id: "m-2", label: "newsletter" },
    { id: "m-3", label: null },
    { id: "m-4", label: "ops" },
    { id: "m-5", label: "vip" },
  ]);

  scene.set("flagged", [
    { id: "m-1", label: "billing", reason: "Overdue invoice — needs reply" },
    { id: "m-5", label: "vip",     reason: "From CEO" },
  ]);

  scene.set("draft", {
    to: "alice@vendor.com",
    subject: "Re: Invoice #4421",
    body: "Hi Alice — confirming we'll process this today. Apologies for the delay.",
  });

  scene.set("inbox", [
    { id: "m-1", from: "alice@vendor.com",  subject: "Invoice #4421 — overdue",      unread: false },
    { id: "m-2", from: "newsletter@nyt",   subject: "Morning briefing",              unread: false },
    { id: "m-3", from: "bob@team",          subject: "Re: standup",                  unread: true  },
    { id: "m-4", from: "alerts@stripe",     subject: "Payout completed: $1,200",    unread: false },
    { id: "m-5", from: "ceo@company.com",   subject: "Quick question",               unread: false },
  ]);

  scene.set("unread_count", 1);

  scene.set("status", "triage_complete");
});
dumpJsonl(join(FIXTURES_DIR, "gmail-triage.jsonl"));

console.log("✓ generated 5 fixtures →", FIXTURES_DIR);
