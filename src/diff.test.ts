/**
 * sceneDiff + buildSnapshot tests.
 */

import { test, expect, describe } from "bun:test";
import { sceneDiff, buildSnapshot, type SceneEvent } from "./diff.js";

const ev = (
  key: string,
  value: unknown,
  ts: number,
  hash = "h" + ts,
): SceneEvent => ({ key, value, timestamp: ts, commitHash: hash });

// ---------------------------------------------------------------------------
// buildSnapshot
// ---------------------------------------------------------------------------

describe("buildSnapshot", () => {
  test("applies events in timestamp order", () => {
    const snap = buildSnapshot([
      ev("a", 1, 100),
      ev("b", 2, 200),
      ev("a", 99, 300),
    ]);
    expect(snap.get("a")).toBe(99);
    expect(snap.get("b")).toBe(2);
  });

  test("returns final state when no commitHash given", () => {
    const snap = buildSnapshot([ev("k", "v1", 1), ev("k", "v2", 2)]);
    expect(snap.get("k")).toBe("v2");
  });

  test("stops at the given commitHash", () => {
    const snap = buildSnapshot([
      ev("a", 1, 100, "h1"),
      ev("b", 2, 200, "h2"),
      ev("a", 99, 300, "h3"),
    ], "h2");
    expect(snap.get("a")).toBe(1);
    expect(snap.get("b")).toBe(2);
    expect(snap.has("c")).toBe(false);
  });

  test("treats same-hash events as one atomic batch", () => {
    const snap = buildSnapshot([
      ev("a", 1, 100, "h1"),
      ev("b", 2, 100, "h1"),
      ev("c", 3, 200, "h2"),
    ], "h1");
    expect(snap.get("a")).toBe(1);
    expect(snap.get("b")).toBe(2);
    expect(snap.has("c")).toBe(false);
  });

  test("handles out-of-order input", () => {
    const snap = buildSnapshot([
      ev("a", 99, 300),
      ev("a", 1, 100),
      ev("a", 2, 200),
    ]);
    expect(snap.get("a")).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// sceneDiff
// ---------------------------------------------------------------------------

describe("sceneDiff", () => {
  test("detects added keys", () => {
    const before = new Map<string, unknown>([["a", 1]]);
    const after  = new Map<string, unknown>([["a", 1], ["b", 2]]);
    const d = sceneDiff(before, after);
    expect(d.added).toEqual({ b: 2 });
    expect(d.removed).toEqual({});
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toEqual(["a"]);
  });

  test("detects removed keys", () => {
    const before = new Map<string, unknown>([["a", 1], ["b", 2]]);
    const after  = new Map<string, unknown>([["a", 1]]);
    const d = sceneDiff(before, after);
    expect(d.removed).toEqual({ b: 2 });
    expect(d.added).toEqual({});
    expect(d.unchanged).toEqual(["a"]);
  });

  test("detects changed values via deep equality", () => {
    const before = new Map<string, unknown>([["k", { x: 1, y: [1, 2] }]]);
    const after  = new Map<string, unknown>([["k", { x: 1, y: [1, 3] }]]);
    const d = sceneDiff(before, after);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]!.key).toBe("k");
    expect(d.changed[0]!.before).toEqual({ x: 1, y: [1, 2] });
    expect(d.changed[0]!.after).toEqual({ x: 1, y: [1, 3] });
  });

  test("treats objects with same keys in different order as equal", () => {
    const before = new Map<string, unknown>([["k", { a: 1, b: 2 }]]);
    const after  = new Map<string, unknown>([["k", { b: 2, a: 1 }]]);
    const d = sceneDiff(before, after);
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toEqual(["k"]);
  });

  test("primitives are equal by value", () => {
    const before = new Map<string, unknown>([["n", 42], ["s", "hi"], ["b", true]]);
    const after  = new Map<string, unknown>([["n", 42], ["s", "hi"], ["b", true]]);
    const d = sceneDiff(before, after);
    expect(d.unchanged).toEqual(["n", "s", "b"]);
  });

  test("composite — add + remove + change in one diff", () => {
    const before = new Map<string, unknown>([
      ["keep", "same"],
      ["mod",  { v: 1 }],
      ["gone", "bye"],
    ]);
    const after = new Map<string, unknown>([
      ["keep", "same"],
      ["mod",  { v: 2 }],
      ["new",  "hello"],
    ]);
    const d = sceneDiff(before, after);
    expect(d.unchanged).toEqual(["keep"]);
    expect(d.changed.map(c => c.key)).toEqual(["mod"]);
    expect(d.added).toEqual({ new: "hello" });
    expect(d.removed).toEqual({ gone: "bye" });
  });
});

// ---------------------------------------------------------------------------
// Integration — build two snapshots from one event stream and diff them.
// ---------------------------------------------------------------------------

describe("buildSnapshot + sceneDiff together", () => {
  test("diff between step 1 and step 3 of an agent run", () => {
    const events: SceneEvent[] = [
      ev("inbox",   ["a@x", "b@x", "c@x"],         100, "h1"),
      ev("flagged", 0,                              100, "h1"),
      ev("flagged", 2,                              200, "h2"),
      ev("draft",   "Re: invoice",                  300, "h3"),
    ];
    const step1 = buildSnapshot(events, "h1");
    const step3 = buildSnapshot(events, "h3");
    const d = sceneDiff(step1, step3);

    expect(d.added).toEqual({ draft: "Re: invoice" });
    expect(d.changed.map(c => c.key)).toEqual(["flagged"]);
    expect(d.changed[0]!.before).toBe(0);
    expect(d.changed[0]!.after).toBe(2);
    expect(d.unchanged).toEqual(["inbox"]);
  });
});
