#!/usr/bin/env python3
"""Prepare opt-in TENSORRA feedback exports for future SFT.

Input: JSONL rows with fields such as user_prompt, assistant_answer, correction,
rating, mode. Output: conversational JSONL suitable for a Hugging Face/TRL-style
messages dataset. This script does not train a model; it builds a reviewable dataset.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

SYSTEM = (
    "You are TENSORRA, a precise reasoning assistant. Answer directly, distinguish "
    "facts from uncertainty, challenge weak assumptions, and do not expose private chain-of-thought."
)


def clean_text(value: object, limit: int = 30000) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.replace("\x00", " ").split()).strip()[:limit]


def convert(row: dict) -> dict | None:
    prompt = clean_text(row.get("user_prompt"))
    answer = clean_text(row.get("correction")) or clean_text(row.get("assistant_answer"))
    rating = row.get("rating")
    if not prompt or not answer:
        return None
    # Negative examples are only usable when the human supplied a correction.
    if rating == -1 and not clean_text(row.get("correction")):
        return None
    return {
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": answer},
        ],
        "metadata": {
            "source": "tensorra_opt_in_feedback",
            "mode": row.get("mode"),
            "rating": rating,
            "model_name": row.get("model_name"),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="Admin-exported JSONL")
    parser.add_argument("output", type=Path, help="Prepared training JSONL")
    args = parser.parse_args()

    total = kept = 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.input.open("r", encoding="utf-8") as source, args.output.open("w", encoding="utf-8") as target:
        for line in source:
            line = line.strip()
            if not line:
                continue
            total += 1
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            item = convert(row)
            if item is None:
                continue
            target.write(json.dumps(item, ensure_ascii=False) + "\n")
            kept += 1

    print(f"Prepared {kept}/{total} examples -> {args.output}")


if __name__ == "__main__":
    main()
