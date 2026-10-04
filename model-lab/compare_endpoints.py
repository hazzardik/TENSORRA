#!/usr/bin/env python3
"""Compare a baseline and candidate TENSORRA-compatible model endpoint.

This is intentionally a model-quality harness, not the full Core router eval.
It sends the same held-out prompts to two OpenAI-compatible /chat/completions
endpoints and writes side-by-side responses for review or later judging.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path


def request_completion(base_url: str, api_key: str, model: str, prompt: str) -> tuple[str, float, str | None]:
    url = base_url.rstrip("/") + "/chat/completions"
    payload = json.dumps({
        "model": model,
        "stream": False,
        "temperature": 0.2,
        "max_completion_tokens": 3500,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are TENSORRA. Answer the user's request directly, precisely, "
                    "and do not expose private chain-of-thought."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }).encode("utf-8")

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    started = time.perf_counter()
    request = urllib.request.Request(url, data=payload, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            raw = response.read().decode("utf-8")
        latency = time.perf_counter() - started
        parsed = json.loads(raw)
        answer = (
            parsed.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        return str(answer).strip(), latency, None
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        latency = time.perf_counter() - started
        return "", latency, f"{type(exc).__name__}: {exc}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--eval", type=Path, default=Path("model-lab/evals/core-v1.jsonl"))
    parser.add_argument("--baseline-url", required=True)
    parser.add_argument("--baseline-model", required=True)
    parser.add_argument("--candidate-url", required=True)
    parser.add_argument("--candidate-model", required=True)
    parser.add_argument("--output", type=Path, default=Path("artifacts/model-comparison.jsonl"))
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    baseline_key = os.getenv("BASELINE_API_KEY", "")
    candidate_key = os.getenv("CANDIDATE_API_KEY", "")

    rows: list[dict] = []
    with args.eval.open("r", encoding="utf-8") as source:
        for line in source:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))

    if args.limit > 0:
        rows = rows[: args.limit]

    args.output.parent.mkdir(parents=True, exist_ok=True)

    baseline_total = 0.0
    candidate_total = 0.0
    baseline_errors = 0
    candidate_errors = 0

    with args.output.open("w", encoding="utf-8") as target:
        for index, item in enumerate(rows, start=1):
            prompt = str(item["prompt"])

            baseline_answer, baseline_latency, baseline_error = request_completion(
                args.baseline_url,
                baseline_key,
                args.baseline_model,
                prompt,
            )
            candidate_answer, candidate_latency, candidate_error = request_completion(
                args.candidate_url,
                candidate_key,
                args.candidate_model,
                prompt,
            )

            baseline_total += baseline_latency
            candidate_total += candidate_latency
            baseline_errors += int(bool(baseline_error))
            candidate_errors += int(bool(candidate_error))

            result = {
                "id": item.get("id"),
                "prompt": prompt,
                "rubric": item.get("rubric", []),
                "expected_auto_mode": item.get("expected_auto_mode"),
                "baseline": {
                    "model": args.baseline_model,
                    "answer": baseline_answer,
                    "latency_s": round(baseline_latency, 3),
                    "error": baseline_error,
                },
                "candidate": {
                    "model": args.candidate_model,
                    "answer": candidate_answer,
                    "latency_s": round(candidate_latency, 3),
                    "error": candidate_error,
                },
            }
            target.write(json.dumps(result, ensure_ascii=False) + "\n")
            print(f"[{index}/{len(rows)}] {item.get('id', 'case')}")

    count = max(1, len(rows))
    print(
        json.dumps(
            {
                "cases": len(rows),
                "baseline_avg_latency_s": round(baseline_total / count, 3),
                "candidate_avg_latency_s": round(candidate_total / count, 3),
                "baseline_errors": baseline_errors,
                "candidate_errors": candidate_errors,
                "output": str(args.output),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
