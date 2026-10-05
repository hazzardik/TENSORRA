#!/usr/bin/env python3
"""Prepare opt-in TENSORRA feedback exports for future SFT.

Input: JSONL rows with fields such as user_prompt, assistant_answer, correction,
rating, mode. Output: conversational JSONL suitable for a Hugging Face/TRL-style
messages dataset.

The pipeline intentionally stays reviewable:
- only opt-in exports should be passed to this script;
- obvious secrets and direct identifiers are redacted;
- duplicate prompt/answer pairs are removed;
- negative answers are kept only when a human correction exists;
- an optional deterministic evaluation split can be produced.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

SYSTEM = (
    "You are TENSORRA, a precise reasoning assistant. Answer directly, distinguish "
    "facts from uncertainty, challenge weak assumptions, use tools when needed, "
    "and never expose private chain-of-thought."
)

REDACTIONS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"),
        "[EMAIL]",
    ),
    (
        re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)"),
        "[PHONE]",
    ),
    (
        re.compile(
            r"(?i)\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*[^\s,;]{6,}"
        ),
        "[SECRET]",
    ),
    (
        re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}"),
        "Bearer [TOKEN]",
    ),
    (
        re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"),
        "[API_KEY]",
    ),
]


def normalize_text(value: object, limit: int = 30000) -> str:
    if not isinstance(value, str):
        return ""

    raw = value.replace("\x00", " ").replace("\r\n", "\n").replace("\r", "\n")
    lines = [" ".join(line.split()) for line in raw.split("\n")]

    compact: list[str] = []
    previous_blank = False
    for line in lines:
        if line:
            compact.append(line)
            previous_blank = False
        elif not previous_blank and compact:
            compact.append("")
            previous_blank = True

    return "\n".join(compact).strip()[:limit]


def redact_sensitive(text: str) -> str:
    result = text
    for pattern, replacement in REDACTIONS:
        result = pattern.sub(replacement, result)
    return result


def clean_text(value: object, limit: int = 30000) -> str:
    return redact_sensitive(normalize_text(value, limit=limit))


def stable_key(prompt: str, answer: str) -> str:
    material = f"{prompt.strip().lower()}\n---\n{answer.strip().lower()}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def convert(row: dict) -> dict | None:
    if row.get("model_name") == "tensorra-policy-gate":
        return None

    prompt = clean_text(row.get("user_prompt"))
    correction = clean_text(row.get("correction"))
    answer = correction or clean_text(row.get("assistant_answer"))
    rating = row.get("rating")

    if len(prompt) < 3 or len(answer) < 8:
        return None

    # A negatively-rated model answer is not a training target by itself.
    # It becomes useful only when the user or reviewer supplied a correction.
    if rating == -1 and not correction:
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
            "sanitized": True,
            "used_human_correction": bool(correction),
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
    parser.add_argument("output", type=Path, help="Prepared training JSONL")
    parser.add_argument(
        "--eval-output",
        type=Path,
        default=None,
        help="Optional held-out evaluation JSONL path",
    )
    parser.add_argument(
        "--eval-ratio",
        type=float,
        default=0.05,
        help="Deterministic evaluation share when --eval-output is used (default: 0.05)",
    )
    args = parser.parse_args()

    if not 0 <= args.eval_ratio <= 0.5:
        raise SystemExit("--eval-ratio must be between 0 and 0.5")

    total = 0
    rejected = 0
    duplicates = 0
    seen: set[str] = set()
    train_items: list[dict] = []
    eval_items: list[dict] = []

    with args.input.open("r", encoding="utf-8") as source:
        for line in source:
            line = line.strip()
            if not line:
                continue

            total += 1
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                rejected += 1
                continue

            item = convert(row)
            if item is None:
                rejected += 1
                continue

            prompt = item["messages"][1]["content"]
            answer = item["messages"][2]["content"]
            key = stable_key(prompt, answer)

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
        "Prepared "
        f"train={len(train_items)} "
        f"eval={len(eval_items)} "
        f"rejected={rejected} "
        f"duplicates={duplicates} "
        f"from total={total}"
    )


if __name__ == "__main__":
    main()
