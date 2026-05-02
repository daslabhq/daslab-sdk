/**
 * Tier-1 scene API — additive, ~5 lines per agent.
 *
 *   import { scene } from 'scene-otel';
 *
 *   scene.set('inbox',  emails);   // → OTel span event with the snapshot
 *   scene.set('budget', budget);
 *   scene.set('flagged', count);
 *
 * Each call emits an event on the active OTel span with attributes
 * following the agent-otel/scene convention:
 *   - scene.key             — the user-supplied key
 *   - scene.commit_hash     — sha256 over (key + canonical-json(value) + ts)
 *   - scene.value           — JSON-encoded value (truncated)
 *   - scene.value.type      — inferred widget type (table/metric/text/...)
 *   - scene.value.size      — JSON byte size (for budget tracking)
 *
 * scry reads these events and reconstructs the scene timeline. No
 * scene-tree dependency, no postgres dependency, no Daslab account
 * required. Works against any OTel SpanProcessor.
 *
 * Daslab platform users get the upgrade for free: when an active
 * span has the daslab.platform attribute, the runtime ALSO commits
 * the snapshot to scene-tree so the multi-platform reactive scene
 * sync picks it up. That's opt-in, not required.
 *
 * Auto-widget inference (used by scry to pick a renderer):
 *   array of objects with consistent keys  → 'table'
 *   primitive number                       → 'metric'
 *   primitive string                       → 'text'
 *   object with { url } where url is image → 'image'
 *   anything else                          → 'json' (raw JSON viewer)
 */

import { trace, type Span } from "@opentelemetry/api";
import { createHash } from "node:crypto";

const MAX_VALUE_BYTES = 32_000;   // soft cap on per-event JSON size

// Inferred widget types — names match defineView entries
export type InferredType =
  | "table"
  | "metric"
  | "text"
  | "image"
  | "list"
  | "json";

export interface SceneSetOptions {
  /** Override the inferred widget type. */
  as?: InferredType;
  /** Optional human-readable description for UIs / LLM specs. */
  description?: string;
}

interface PendingSet {
  key:   string;
  value: unknown;
  type:  InferredType;
  ts:    number;
  description?: string;
}

let pending: PendingSet[] = [];

/**
 * Snapshot a value into the active scene. Emits an OTel span event
 * tagged with the snapshot. Multiple sets between commits are coalesced
 * into a single batch event when commit() is called; otherwise each
 * set fires its own event.
 */
function set(key: string, value: unknown, opts: SceneSetOptions = {}): void {
  const type = opts.as ?? inferType(value);
  const item: PendingSet = {
    key,
    value,
    type,
    ts: Date.now(),
    description: opts.description,
  };
  pending.push(item);
  emitEvent([item]);
}

/**
 * Atomically commit a batch of sets — useful when several keys change
 * together and you want them grouped under a single commit_hash.
 *
 *   scene.set('a', 1);  // event 1
 *   scene.set('b', 2);  // event 2
 *   scene.commit();     // event 3 (batch with hash over a+b)
 *
 * If you only ever use scene.set() (no commit), each call is its own
 * event with its own commit_hash. Use commit() when atomicity matters.
 */
function commit(): void {
  if (pending.length === 0) return;
  emitEvent(pending);
  pending = [];
}

/**
 * Read the current pending (uncommitted) set list. Useful for tests.
 */
function pendingSets(): readonly PendingSet[] {
  return pending;
}

/** Reset pending state — for tests. */
function _resetForTests(): void {
  pending = [];
}

function emitEvent(items: PendingSet[]): void {
  const span = trace.getActiveSpan();
  if (!span || !span.isRecording()) return;     // graceful no-op when tracing disabled

  // Build a single canonical JSON string over the batch — used for the hash
  // so identical content always produces the same commit_hash, regardless
  // of insertion order. Uses safeJson per item so cyclic values don't blow up.
  const sorted = [...items].sort((a, b) => a.key.localeCompare(b.key));
  const canonical = "[" + sorted.map(i => `{"key":${JSON.stringify(i.key)},"value":${safeJson(i.value)}}`).join(",") + "]";
  const commitHash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);

  for (const item of items) {
    const valueJson = safeJson(item.value);
    span.addEvent("scene.set", {
      "scene.key":            item.key,
      "scene.commit_hash":    commitHash,
      "scene.value.type":     item.type,
      "scene.value.size":     valueJson.length,
      "scene.value":          valueJson.length > MAX_VALUE_BYTES
                                ? valueJson.slice(0, MAX_VALUE_BYTES) + "…"
                                : valueJson,
      ...(item.description ? { "scene.description": item.description } : {}),
    });
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    // circular refs or BigInt — fall back to a marker
    return JSON.stringify({ __unserializable: true });
  }
}

/**
 * Heuristic widget-type inference from a value's shape. Used by scry
 * to pick a default renderer when scene.set is called without `as`.
 */
function inferType(value: unknown): InferredType {
  if (value == null) return "text";
  if (typeof value === "number") return "metric";
  if (typeof value === "string") return "text";
  if (typeof value === "boolean") return "text";

  if (Array.isArray(value)) {
    if (value.length === 0) return "list";
    const first = value[0];
    // Array of consistent objects → table
    if (typeof first === "object" && first != null && !Array.isArray(first)) {
      return "table";
    }
    return "list";
  }

  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    // Looks like an image
    if (typeof v.url === "string" && /\.(png|jpe?g|gif|svg|webp)(\?|$)/i.test(v.url)) {
      return "image";
    }
    if (v.type === "image" || v.mimeType?.toString().startsWith("image/")) {
      return "image";
    }
  }

  return "json";
}

// ---------------------------------------------------------------------------
// Public surface — single `scene` object
// ---------------------------------------------------------------------------

export const scene = {
  set,
  commit,
  pending: pendingSets,
  _resetForTests,
};

// Also export individual functions for users who prefer them
export { set, commit, inferType };
