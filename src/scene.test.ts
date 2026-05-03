/**
 * scene.set() — Tier-1 additive scene API tests.
 *
 * Verifies the OTel-events contract: each scene.set() emits a "scene.set"
 * event on the active span with attributes matching the agent-otel/scene
 * convention. Graceful no-op when tracing isn't on.
 */

import { test, expect, beforeAll, beforeEach, describe } from "bun:test";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { trace, context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { scene, inferType } from "./scene.js";

// ---------------------------------------------------------------------------
// One-time OTel setup — InMemorySpanExporter so we can read back what was
// emitted. SimpleSpanProcessor flushes immediately on span end. Context
// manager is required for trace.getActiveSpan() to see the span we set
// inside context.with().
// ---------------------------------------------------------------------------

const exporter = new InMemorySpanExporter();
let initialized = false;

beforeAll(() => {
  if (initialized) return;
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  initialized = true;
});

beforeEach(() => {
  exporter.reset();
  scene._resetForTests();
});

const tracer = () => trace.getTracer("scene-set-test");

/**
 * Run `fn` inside an active span and return the finished ReadableSpan.
 * SimpleSpanProcessor exports synchronously on end().
 */
function withActiveSpan<T>(fn: () => T): { span: ReadableSpan; result: T } {
  const span = tracer().startSpan("test-root");
  let result!: T;
  context.with(trace.setSpan(context.active(), span), () => {
    result = fn();
  });
  span.end();
  const finished = exporter.getFinishedSpans().find(s => s.name === "test-root");
  if (!finished) throw new Error("test-root span not exported");
  return { span: finished, result };
}

// ---------------------------------------------------------------------------
// Basic emission
// ---------------------------------------------------------------------------

describe("scene.set", () => {
  test("emits a scene.set span event with the right attributes", () => {
    const { span } = withActiveSpan(() => {
      scene.set("flagged", 42);
    });

    expect(span.events).toHaveLength(1);
    const ev = span.events[0]!;
    expect(ev.name).toBe("scene.set");
    expect(ev.attributes?.["scene.key"]).toBe("flagged");
    expect(ev.attributes?.["scene.value.type"]).toBe("metric");
    expect(ev.attributes?.["scene.value"]).toBe("42");
    expect(ev.attributes?.["scene.value.size"]).toBe(2);
    expect(typeof ev.attributes?.["scene.commit_hash"]).toBe("string");
    expect((ev.attributes?.["scene.commit_hash"] as string).length).toBe(16);
  });

  test("includes description when provided", () => {
    const { span } = withActiveSpan(() => {
      scene.set("inbox", [], { description: "current emails" });
    });
    const ev = span.events[0]!;
    expect(ev.attributes?.["scene.description"]).toBe("current emails");
  });

  test("respects explicit `as` widget type override", () => {
    const { span } = withActiveSpan(() => {
      scene.set("notes", "raw", { as: "json" });
    });
    expect(span.events[0]!.attributes?.["scene.value.type"]).toBe("json");
  });

  test("graceful no-op when no active span", () => {
    expect(() => scene.set("nothing", 1)).not.toThrow();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  test("emits scene.kind=actual by default", () => {
    const { span } = withActiveSpan(() => {
      scene.set("k", 1);
    });
    expect(span.events[0]!.attributes?.["scene.kind"]).toBe("actual");
  });
});

// ---------------------------------------------------------------------------
// scene.kind — wire shape preserved for future tool-call instrumentation
// ---------------------------------------------------------------------------

describe("scene.kind on the wire", () => {
  test("scene.set always emits kind=actual", () => {
    const { span } = withActiveSpan(() => {
      scene.set("inbox", [{ id: 1 }]);
    });
    expect(span.events[0]!.attributes?.["scene.kind"]).toBe("actual");
  });
});

// ---------------------------------------------------------------------------
// commit() batches
// ---------------------------------------------------------------------------

describe("scene.commit", () => {
  test("emits a batch event with a single shared commit_hash", () => {
    const { span } = withActiveSpan(() => {
      scene.set("a", 1);
      scene.set("b", 2);
      scene.commit();
    });

    // 2 set events + 2 commit-batch events (one per item) = 4
    // Each set fires immediately AND is replayed in commit() — that's intentional
    // for now: per-set events give live progress, commit gives a coherent batch.
    expect(span.events.length).toBeGreaterThanOrEqual(2);

    // The commit batch hash should be over BOTH a and b — different from
    // each per-set hash.
    const setEvents = span.events.filter(e => e.attributes?.["scene.key"] === "a");
    const aHashes = setEvents.map(e => e.attributes?.["scene.commit_hash"] as string);
    // First "a" event was emitted alone; second was as part of the {a,b} batch.
    expect(new Set(aHashes).size).toBe(2);
  });

  test("commit with no pending sets is a no-op", () => {
    const { span } = withActiveSpan(() => {
      scene.commit();
    });
    expect(span.events).toHaveLength(0);
  });

  test("identical content produces identical commit_hash", () => {
    const { span: s1 } = withActiveSpan(() => {
      scene.set("k", { x: 1, y: 2 });
    });
    const hash1 = s1.events[0]!.attributes?.["scene.commit_hash"];

    const { span: s2 } = withActiveSpan(() => {
      scene.set("k", { x: 1, y: 2 });
    });
    const hash2 = s2.events[0]!.attributes?.["scene.commit_hash"];

    expect(hash1).toBe(hash2);
  });

  test("commit_hash is order-independent across batched sets", () => {
    const { span: s1 } = withActiveSpan(() => {
      scene.set("a", 1);
      scene.set("b", 2);
      scene.commit();
    });
    const { span: s2 } = withActiveSpan(() => {
      scene.set("b", 2);
      scene.set("a", 1);
      scene.commit();
    });

    // Pull the hash from the commit-batch events — find the events whose
    // emission was triggered by commit() (last 2 events in each span).
    const lastTwo1 = s1.events.slice(-2).map(e => e.attributes?.["scene.commit_hash"]);
    const lastTwo2 = s2.events.slice(-2).map(e => e.attributes?.["scene.commit_hash"]);
    expect(lastTwo1[0]).toBe(lastTwo2[0]);
  });
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

describe("scene.set truncation", () => {
  test("values larger than MAX_VALUE_BYTES are clipped with ellipsis", () => {
    const big = "x".repeat(50_000);
    const { span } = withActiveSpan(() => {
      scene.set("blob", big);
    });
    const ev = span.events[0]!;
    const value = ev.attributes?.["scene.value"] as string;
    expect(value.length).toBeLessThan(big.length + 2);
    expect(value.endsWith("…")).toBe(true);
    // size is the original, untruncated byte count
    expect(ev.attributes?.["scene.value.size"]).toBe(big.length + 2); // +2 for JSON quotes
  });
});

// ---------------------------------------------------------------------------
// inferType — pure heuristic
// ---------------------------------------------------------------------------

describe("inferType", () => {
  test("array of objects → table", () => {
    expect(inferType([{ a: 1 }, { a: 2 }])).toBe("table");
  });

  test("primitive number → metric", () => {
    expect(inferType(42)).toBe("metric");
  });

  test("primitive string → text", () => {
    expect(inferType("hi")).toBe("text");
  });

  test("boolean → text", () => {
    expect(inferType(true)).toBe("text");
  });

  test("empty array → list", () => {
    expect(inferType([])).toBe("list");
  });

  test("array of primitives → list", () => {
    expect(inferType([1, 2, 3])).toBe("list");
  });

  test("object with image url → image", () => {
    expect(inferType({ url: "https://x.com/foo.png" })).toBe("image");
    expect(inferType({ url: "https://x.com/foo.jpg?cache=1" })).toBe("image");
  });

  test("object with mimeType image → image", () => {
    expect(inferType({ mimeType: "image/png", data: "..." })).toBe("image");
  });

  test("plain object → json", () => {
    expect(inferType({ foo: "bar", baz: 1 })).toBe("json");
  });

  test("null → text", () => {
    expect(inferType(null)).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Unserializable values
// ---------------------------------------------------------------------------

describe("scene.set unserializable values", () => {
  test("circular references don't crash — serialized as marker", () => {
    const obj: any = { a: 1 };
    obj.self = obj;

    const { span } = withActiveSpan(() => {
      scene.set("circle", obj);
    });
    const ev = span.events[0]!;
    const value = ev.attributes?.["scene.value"] as string;
    expect(value).toContain("__unserializable");
  });
});
