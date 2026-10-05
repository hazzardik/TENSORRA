#!/usr/bin/env python3
"""Prepare opt-in TENSORRA feedback for preference tuning (DPO).

Only rows with a human correction are useful as direct preference pairs:
- chosen = human correction;
- rejected = the original assistant answer.

The script applies the same basic redaction/normalization policy as prepare_sft.py
and keeps a deterministic held-out split for evaluation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from prepare_sft import clean_text

SYSTEM = (
    "You are TENSORRA, a precise reasoning assistant. Answer directly, distinguish "
    "facts from uncertainty, challenge weak assumptions, use tools when needed, "
    "and never expose private chain-of-thought."
)


def stable_key(prompt: str, chosen: str, rejected: str) -> str:
    material = (
        prompt.strip().lower()
        + "\n---chosen---\n"
        + chosen.strip().lower()
        + "\n---rejected---\n"
        + rejected.strip().lower()
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def convert(row: dict) -> dict | None:
    if row.get("model_name") == "tensorra-policy-gate":
        return None

    prompt = clean_text(row.get("user_prompt"))
    chosen = clean_text(row.get("correction"))
    rejected = clean_text(row.get("assistant_answer"))

    if len(prompt) < 3 or len(chosen) < 8 or len(rejected) < 8:
        return None

    if chosen.strip().lower() == rejected.strip().lower():
        return None

    return {
        "prompt": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "chosen": [{"role": "assistant", "content": chosen}],
        "rejected": [{"role": "assistant", "content": rejected}],
        "metadata": {
            "source": "tensorra_opt_in_feedback",
            "model_name": row.get("model_name"),
            "mode": row.get("mode"),
            "rating": row.get("rating"),
            "sanitized": True,
            "preference_source": "human_correction",
        },
    }


def write_jsonl(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as target:
        for item in items:
            target.write(json.dumps(item, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="Admin-exported opt-in JSONL")
    parser.add_argument("output", type=Path, help="DPO training JSONL")
    parser.add_argument("--eval-output", type=Path, default=None)
    parser.add_argument("--eval-ratio", type=float, default=0.08)
    args = parser.parse_args()

    if not 0 <= args.eval_ratio <= 0.5:
        raise SystemExit("--eval-ratio must be between 0 and 0.5")

    train_items: list[dict] = []
    eval_items: list[dict] = []
    seen: set[str] = set()
    rejected_rows = 0
    duplicates = 0
    total = 0

    with args.input.open("r", encoding="utf-8") as source:
        for raw in source:
            raw = raw.strip()
            if not raw:
                continue

            total += 1
            try:
                row = json.loads(raw)
            except json.JSONDecodeError:
                rejected_rows += 1
                continue

            item = convert(row)
            if item is None:
                rejected_rows += 1
                continue

            prompt = item["prompt"][1]["content"]
            chosen = item["chosen"][0]["content"]
            rejected = item["rejected"][0]["content"]
            key = stable_key(prompt, chosen, rejected)

            if key in seen:
                duplicates += 1
                continue
            seen.add(key)

            if args.eval_output is not None:
                bucket = int(key[:8], 16) / 0xFFFFFFFF
                if bucket < args.eval_ratio:
                    eval_items.append(item)
                    continue

            train_items.append(item)

    write_jsonl(args.output, train_items)
    if args.eval_output is not None:
        write_jsonl(args.eval_output, eval_items)

    print(
        "Prepared preferences "
        f"train={len(train_items)} "
        f"eval={len(eval_items)} "
        f"rejected={rejected_rows} "
        f"duplicates={duplicates} "
        f"from total={total}"
    )


if __name__ == "__main__":
    main()
