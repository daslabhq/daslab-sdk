"""
Python port of scene-otel's scene.set / scene.intent.

Same wire contract as the TypeScript SDK so the JSONL output is loadable
by the same static scrubber and any other OTel sink that ingests span
events. Standalone — only depends on opentelemetry-api.

Public surface:
    scene.set(key, value, **opts)        kind="actual"
    scene.intent(key, value, **opts)     kind="intent"
    scene.commit()                        atomic batch
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Optional

from opentelemetry import trace

MAX_VALUE_BYTES = 32_000

_IMAGE_URL_RE = re.compile(r"\.(png|jpe?g|gif|svg|webp)(\?|$)", re.IGNORECASE)


def infer_type(value: Any) -> str:
    if value is None:                          return "text"
    if isinstance(value, bool):                return "text"
    if isinstance(value, (int, float)):        return "metric"
    if isinstance(value, str):                 return "text"
    if isinstance(value, list):
        if not value:                          return "list"
        if isinstance(value[0], dict):         return "table"
        return "list"
    if isinstance(value, dict):
        url = value.get("url")
        if isinstance(url, str) and _IMAGE_URL_RE.search(url):
            return "image"
        if value.get("type") == "image":
            return "image"
        mime = value.get("mimeType")
        if isinstance(mime, str) and mime.startswith("image/"):
            return "image"
    return "json"


def _safe_json(value: Any) -> str:
    try:
        return json.dumps(value, default=str, separators=(",", ":"))
    except (TypeError, ValueError):
        return json.dumps({"__unserializable": True})


def _commit_hash(items: list[dict]) -> str:
    parts = []
    for item in sorted(items, key=lambda x: x["key"]):
        parts.append(
            '{"key":' + json.dumps(item["key"]) + ',"value":' + _safe_json(item["value"]) + "}"
        )
    canonical = "[" + ",".join(parts) + "]"
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


_pending: list[dict] = []


def set(
    key: str,
    value: Any,
    *,
    as_:        Optional[str] = None,
    description: Optional[str] = None,
    kind:       str = "actual",
) -> None:
    item = {
        "key":         key,
        "value":       value,
        "type":        as_ or infer_type(value),
        "description": description,
        "kind":        kind,
    }
    _pending.append(item)
    _emit([item])


def intent(
    key: str,
    value: Any,
    *,
    as_:        Optional[str] = None,
    description: Optional[str] = None,
) -> None:
    set(key, value, as_=as_, description=description, kind="intent")


def commit() -> None:
    global _pending
    if not _pending: return
    _emit(_pending)
    _pending = []


def reset_pending() -> None:
    global _pending
    _pending = []


def _emit(items: list[dict]) -> None:
    span = trace.get_current_span()
    if not span or not span.is_recording():
        return
    commit_hash = _commit_hash(items)
    for item in items:
        value_json = _safe_json(item["value"])
        attrs = {
            "scene.key":         item["key"],
            "scene.commit_hash": commit_hash,
            "scene.kind":        item["kind"],
            "scene.value.type":  item["type"],
            "scene.value.size":  len(value_json),
            "scene.value":       value_json[:MAX_VALUE_BYTES] + "…" if len(value_json) > MAX_VALUE_BYTES else value_json,
        }
        if item.get("description"):
            attrs["scene.description"] = item["description"]
        span.add_event("scene.set", attributes=attrs)
