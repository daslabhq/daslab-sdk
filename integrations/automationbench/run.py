"""
Run a small set of AutomationBench tasks through claude-haiku-4-5,
instrumented with scene.intent + scene.set per tool call. Dump the
JSONL traces into the static scrubber's example-traces directory so
the live demo gets real-model fixtures alongside the hand-scripted
ones.

Usage (from this directory):

    PYTHONPATH=.:../../../../references/AutomationBench \\
      ../../../../references/AutomationBench/.venv/bin/python \\
      run.py [N]

where N is the number of tasks (default 3). Picks compact, simple-domain
tasks so the run is cheap (~$0.10 total, 30-90s wall time).

Output:
    ../../viewer/example-traces/automationbench-real-<task>.jsonl
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG  = HERE.parent.parent
AB   = PKG.parent.parent / "references" / "AutomationBench"
sys.path.insert(0, str(AB))
sys.path.insert(0, str(HERE))

# Load .env (which lives in server/) for the API keys.
ENV_FILE = PKG.parent.parent / "server" / ".env"
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line: continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from datasets import Dataset
from anthropic import AsyncAnthropic
from automationbench.clients import StreamingAnthropicClient
from automationbench.rubric import task_completed_correctly
import verifiers as vf

from instrument import SceneInstrumentedEnv, setup_otel, reset_exporter, dump_jsonl

OUT_DIR = PKG / "viewer" / "example-traces"

# Pick 3 compact tasks across domains. Stay simple so haiku has a real shot.
TASK_IMPORTS = [
    ("automationbench.domains.simple.tasks",
     "get_simple_email_sf_contact_phone_update",
     "automationbench-real-jordan-lee.jsonl"),
    ("automationbench.domains.simple.tasks",
     "get_simple_airtable_create_contact",
     "automationbench-real-airtable-create.jsonl"),
    ("automationbench.domains.operations.tasks",
     "get_ops_airtable_gmail_visitor_followup_task",
     "automationbench-real-visitor-nda.jsonl"),
]

MODEL = "claude-haiku-4-5-20251001"


def load_task(module: str, fn_name: str) -> dict:
    import importlib
    mod = importlib.import_module(module)
    fn  = getattr(mod, fn_name)
    return fn()


def task_to_dataset_row(task: dict) -> dict:
    return {
        "prompt":  task["prompt"],
        "answer":  task.get("answer", ""),
        "task":    task["task"],
        "info":    task["info"],
    }


async def run_one_task(task: dict, out_file: str) -> None:
    setup_otel()
    reset_exporter()

    ds = Dataset.from_list([task_to_dataset_row(task)])
    rubric = vf.Rubric(funcs=[task_completed_correctly])
    env = SceneInstrumentedEnv(
        dataset=ds,
        rubric=rubric,
        max_turns=12,           # cap per-task budget
        toolset="limited_zapier", # restrict to per-task zapier_tools — gives us real gmail_*/salesforce_* names
    )
    client = StreamingAnthropicClient(AsyncAnthropic())

    print(f"→ {task['task']}")
    results = await env.evaluate(
        client=client,
        model=MODEL,
        sampling_args={"max_tokens": 4096},
        num_examples=1,
        rollouts_per_example=1,
        max_concurrent=1,
        state_columns=["_usage", "_assertion_results", "_end_state"],
    )

    # Pull the reward + token usage for logging.
    out = (results.get("outputs") or [{}])[0]
    reward = out.get("reward", 0.0)
    usage  = out.get("_usage") or {}
    print(f"  reward={reward:.2f}  in={usage.get('input_tokens', 0)}  out={usage.get('output_tokens', 0)}")

    target = OUT_DIR / out_file
    n = dump_jsonl(target)
    print(f"  ✓ {n} span(s) → {target.relative_to(PKG)}")


async def main() -> None:
    n_max = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for module, fn_name, out_file in TASK_IMPORTS[:n_max]:
        task = load_task(module, fn_name)
        await run_one_task(task, out_file)


if __name__ == "__main__":
    asyncio.run(main())
