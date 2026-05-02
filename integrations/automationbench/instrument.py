"""
Wrap AutomationBench's StatefulToolEnv so each tool call emits:
  - scene.intent(<app>, {tool, args})  before dispatch
  - scene.set(<app>, world.<app>)      after dispatch

The "<app>" is derived from the tool name (gmail_*, salesforce_*, …). Tools
that don't map to a single app fall back to a generic "action" key so the
intent shows up in the timeline as a tool-call beat.

Result: JSONL traces where every step has both the model's stated intent
(parsed from tool args) and the actual world delta — scrubbable in the
scene-otel viewer to surface belief-vs-reality drift.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import verifiers as vf
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider, ReadableSpan
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from automationbench.runner import AutomationBenchEnv
from automationbench.schema.world import WorldState

import scene as sc

# Multi-word app prefixes (matched longest-first).
_MULTI_WORD = (
    "google_sheets google_calendar google_drive google_ads "
    "facebook_pages facebook_lead_ads facebook_conversions "
    "linkedin_ads linkedin_conversions linkedin_leadgen_forms "
    "zoho_desk"
).split()


def _app_for_tool(tool_name: str, world_keys: list[str]) -> str | None:
    for prefix in _MULTI_WORD:
        if tool_name.startswith(prefix + "_") and prefix in world_keys:
            return prefix
    head = tool_name.split("_", 1)[0]
    return head if head in world_keys else None


def _snap(world: WorldState | None, key: str) -> Any:
    if world is None: return None
    sub = getattr(world, key, None)
    if sub is None:               return None
    if hasattr(sub, "model_dump"):
        try:                      return sub.model_dump(mode="json")
        except Exception:         pass
    try:                          return json.loads(json.dumps(sub, default=str))
    except Exception:             return str(sub)


# ---------------------------------------------------------------------------
# Instrumented env
# ---------------------------------------------------------------------------

class SceneInstrumentedEnv(AutomationBenchEnv):
    """Subclass that emits scene.intent + scene.set around every tool call.

    Each rollout (one task) runs inside its own OTel span named after the
    task slug, so dump_jsonl produces one span per task — exactly the shape
    the static scrubber expects.
    """

    async def rollout(self, *args, **kwargs):
        tracer = trace.get_tracer("scene-otel-automationbench")
        # Open with a placeholder name; setup_state will rename it once we
        # have the populated task info.
        with tracer.start_as_current_span("automationbench.rollout"):
            return await super().rollout(*args, **kwargs)

    async def setup_state(self, state, **kwargs):
        state = await super().setup_state(state, **kwargs)
        info  = state.get("info") or {}
        if isinstance(info, str):
            try: info = json.loads(info)
            except Exception: info = {}
        # Task slug lives at top-level of the dataset row, not inside info.
        task_name = state.get("task") or info.get("task")
        span = trace.get_current_span()
        if task_name and span and span.is_recording():
            span.update_name(str(task_name))
        # Surface the user request as the first scene event.
        prompt = state.get("prompt") or []
        for m in prompt:
            role    = m.get("role") if isinstance(m, dict) else getattr(m, "role", None)
            content = m.get("content") if isinstance(m, dict) else getattr(m, "content", None)
            if role == "user" and content:
                sc.set("request", content, description="user request")
                break
        # Snapshot the initial world state for every app the task seeds.
        world = state.get("world")
        if world is not None:
            initial = info.get("initial_state") or {}
            for app in initial.keys():
                if app == "meta": continue
                sc.set(app, _snap(world, app), description=f"initial {app} state")
        return state

    async def call_tool(self, tool_name, tool_args, tool_call_id, **kwargs):
        # Find current world from the most recent state on the env, set on
        # update_tool_args. We cache it per-instance via a state ref on call.
        world = self._current_world
        keys = list(world.model_dump(mode="json").keys()) if world else []
        app  = _app_for_tool(tool_name, keys)

        # 1. INTENT — model wants to call this tool with these args.
        sc.intent(
            app or "action",
            {"tool": tool_name, "args": tool_args},
            description=tool_name,
        )

        # 2. Run the tool.
        result = await super().call_tool(tool_name, tool_args, tool_call_id, **kwargs)

        # 3. ACTUAL — snapshot the affected app sub-state.
        if app and world is not None:
            sc.set(app, _snap(world, app), description=tool_name)
        else:
            # Read-only or unmapped tool: emit a small "tool.result" actual so
            # the timeline still has a beat.
            content = getattr(result, "content", str(result))
            preview = content[:1500] if isinstance(content, str) else content
            sc.set("action", {"tool": tool_name, "result_preview": preview}, description=tool_name)

        return result

    def update_tool_args(self, tool_name, tool_args, messages, state, **kwargs):
        # Cache the world ref so call_tool can read it without re-plumbing.
        self._current_world = state.get("world")
        return super().update_tool_args(tool_name, tool_args, messages, state, **kwargs)


# ---------------------------------------------------------------------------
# OTel setup + JSONL dump
# ---------------------------------------------------------------------------

_exporter = InMemorySpanExporter()


def setup_otel() -> trace.Tracer:
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(_exporter))
    trace.set_tracer_provider(provider)
    return trace.get_tracer("scene-otel-automationbench")


def reset_exporter() -> None:
    _exporter.clear()
    sc.reset_pending()


def dump_jsonl(path: str | Path) -> int:
    spans = _exporter.get_finished_spans()
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w") as f:
        for s in spans:
            f.write(_serialize_span(s) + "\n")
    return len(spans)


def _serialize_span(s: ReadableSpan) -> str:
    parent = s.parent
    return json.dumps({
        "trace_id":       format(s.context.trace_id, "032x"),
        "span_id":        format(s.context.span_id, "016x"),
        "parent_span_id": format(parent.span_id, "016x") if parent else None,
        "name":           s.name,
        "start_time_ns":  s.start_time,
        "end_time_ns":    s.end_time,
        "kind":           int(s.kind.value) if s.kind else 0,
        "status":         {"code": int(s.status.status_code.value) if s.status else 0},
        "attributes":     dict(s.attributes or {}),
        "events": [
            {"name": e.name, "time_ns": e.timestamp, "attributes": dict(e.attributes or {})}
            for e in s.events
        ],
    })
