/**
 * sceneDiff — attribute-level diff between two scene snapshots.
 *
 * A "scene snapshot" is the resolved state of all keys at a particular
 * commit_hash. You can build one from a stream of scene.set events using
 * `buildSnapshot()`, then compare two snapshots with `sceneDiff()`.
 *
 *   const before = buildSnapshot(events, "abc123…");
 *   const after  = buildSnapshot(events, "def456…");
 *   const diff   = sceneDiff(before, after);
 *   //  → {
 *   //      added:    { newKey: value, … },
 *   //      removed:  { goneKey: oldValue, … },
 *   //      changed:  [ { key, before, after }, … ],
 *   //      unchanged: ["budget", "config", …],
 *   //    }
 *
 * Used for: comparing two runs of the same agent ("did the new prompt
 * change what it saw at step 3?"), tracking what a single tool call
 * mutated, surfacing belief-vs-truth drift in eval setups.
 */

export interface SceneEvent {
  key:        string;
  value:      unknown;
  /** Content-addressed hash for the batch this event belongs to. */
  commitHash: string;
  timestamp:  number;
  type?:      string;
  description?: string;
}

/** Resolved state of all keys at a particular point in the timeline. */
export type SceneSnapshot = Map<string, unknown>;

export interface SceneDiff {
  /** Keys present in `after` but not `before`. */
  added:    Record<string, unknown>;
  /** Keys present in `before` but not `after`. */
  removed:  Record<string, unknown>;
  /** Keys present in both with different values (deep equality). */
  changed:  Array<{ key: string; before: unknown; after: unknown }>;
  /** Keys present in both with identical values. */
  unchanged: string[];
}

// ---------------------------------------------------------------------------
// buildSnapshot
// ---------------------------------------------------------------------------

/**
 * Walk events in order, returning the resolved scene state up to and
 * including the given `commitHash`. If `commitHash` is omitted, returns
 * the final state (all events applied).
 *
 * Events with the same commitHash are treated as one atomic batch — their
 * order within the batch doesn't matter (they'd all carry the same hash).
 */
export function buildSnapshot(
  events: readonly SceneEvent[],
  commitHash?: string,
): SceneSnapshot {
  const state: SceneSnapshot = new Map();
  // Sort defensively — caller may hand us out-of-order events.
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  let stop = false;
  for (const ev of sorted) {
    if (stop) break;
    state.set(ev.key, ev.value);
    if (commitHash && ev.commitHash === commitHash) {
      // Continue applying same-batch events, but stop once a different hash
      // appears.
      const idx = sorted.indexOf(ev);
      const next = sorted[idx + 1];
      if (!next || next.commitHash !== commitHash) stop = true;
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// sceneDiff
// ---------------------------------------------------------------------------

export function sceneDiff(before: SceneSnapshot, after: SceneSnapshot): SceneDiff {
  const added:     Record<string, unknown> = {};
  const removed:   Record<string, unknown> = {};
  const changed:   Array<{ key: string; before: unknown; after: unknown }> = [];
  const unchanged: string[] = [];

  for (const [key, val] of after) {
    if (!before.has(key)) {
      added[key] = val;
    } else if (!deepEqual(before.get(key), val)) {
      changed.push({ key, before: before.get(key), after: val });
    } else {
      unchanged.push(key);
    }
  }

  for (const [key, val] of before) {
    if (!after.has(key)) {
      removed[key] = val;
    }
  }

  return { added, removed, changed, unchanged };
}

// ---------------------------------------------------------------------------
// deep equality — JSON-stringify is fine because scene values are already
// constrained to JSON-serializable shapes by safeJson() in scene.ts.
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return canonicalize(a) === canonicalize(b);
  } catch {
    return false;
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k])).join(",") + "}";
}
