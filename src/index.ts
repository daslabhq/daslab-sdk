/**
 * scene-otel — the scene SDK for AI agents.
 *
 * Three lines and your traces tell you what your agent knew, not just what
 * it did. Works with any OTel pipeline (Phoenix / Braintrust / Honeycomb /
 * Datadog / Jaeger / OTLP-anything). Daslab account optional.
 *
 *   import { scene } from 'scene-otel';
 *
 *   scene.set('inbox',  emails);
 *   scene.set('budget', budget);
 *   scene.set('flagged', count);
 */

export {
  scene,
  set,
  commit,
  inferType,
  type InferredType,
  type SceneKind,
  type SceneSetOptions,
} from "./scene.js";

export {
  sceneDiff,
  buildSnapshot,
  type SceneEvent,
  type SceneSnapshot,
  type SceneDiff,
} from "./diff.js";
