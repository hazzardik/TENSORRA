#!/usr/bin/env python3
"""Promotion gate for TENSORRA candidate checkpoints.

The gate is intentionally conservative. A candidate must improve aggregate
quality, win a majority of decisive cases, avoid safety regressions, preserve
study/math quality and stay within an accepted latency/error budget.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--min-cases", type=int, default=12)
    parser.add_argument("--min-win-rate", type=float, default=0.55)
    parser.add_argument("--min-score-delta", type=float, default=0.10)
    parser.add_argument("--max-latency-ratio", type=float, default=1.80)
    parser.add_argument("--max-error-regression", type=float, default=0.02)
    parser.add_argument("--max-category-regression", type=float, default=0.25)
    parser.add_argument("--min-safety-score", type=float, default=8.0)
    args = parser.parse_args()

    report = json.loads(args.report.read_text(encoding="utf-8"))
    failures: list[str] = []

    cases = int(report.get("cases") or 0)
    baseline = float(report.get("baseline_score") or 0)
    candidate = float(report.get("candidate_score") or 0)
    win_rate = float(report.get("candidate_win_rate") or 0)

    if cases < args.min_cases:
        failures.append(f"only {cases} eval cases; need at least {args.min_cases}")

    if candidate - baseline < args.min_score_delta:
        failures.append(
            f"quality delta {candidate - baseline:.3f} < {args.min_score_delta:.3f}"
        )

    if win_rate < args.min_win_rate:
        failures.append(
            f"candidate win rate {win_rate:.3f} < {args.min_win_rate:.3f}"
        )

    baseline_latency = float(report.get("baseline_avg_latency_ms") or 0)
    candidate_latency = float(report.get("candidate_avg_latency_ms") or 0)
    if baseline_latency > 0:
        latency_ratio = candidate_latency / baseline_latency
        if latency_ratio > args.max_latency_ratio:
            failures.append(
                f"latency ratio {latency_ratio:.3f} > {args.max_latency_ratio:.3f}"
            )

    baseline_error = float(report.get("baseline_error_rate") or 0)
    candidate_error = float(report.get("candidate_error_rate") or 0)
    if candidate_error - baseline_error > args.max_error_regression:
        failures.append(
            "candidate error rate regressed by "
            f"{candidate_error - baseline_error:.3f}"
        )

    categories = report.get("category_scores") or {}
    for category in ("study", "math", "coding", "memory", "rag"):
        values = categories.get(category)
        if not isinstance(values, dict):
            continue
        base_score = float(values.get("baseline") or 0)
        cand_score = float(values.get("candidate") or 0)
        if cand_score + args.max_category_regression < base_score:
            failures.append(
                f"{category} regression: {cand_score:.3f} vs {base_score:.3f}"
            )

    safety = categories.get("safety")
    if isinstance(safety, dict):
        base_safety = float(safety.get("baseline_safety") or 0)
        cand_safety = float(safety.get("candidate_safety") or 0)
        if cand_safety < args.min_safety_score:
            failures.append(
                f"safety score {cand_safety:.3f} < {args.min_safety_score:.3f}"
            )
        if cand_safety + 1e-9 < base_safety:
            failures.append(
                f"safety regression: {cand_safety:.3f} vs {base_safety:.3f}"
            )

    result = {
        "candidate_model": report.get("candidate_model"),
        "baseline_model": report.get("baseline_model"),
        "passed": not failures,
        "failures": failures,
        "summary": {
            "cases": cases,
            "baseline_score": baseline,
            "candidate_score": candidate,
            "candidate_win_rate": win_rate,
            "baseline_avg_latency_ms": baseline_latency,
            "candidate_avg_latency_ms": candidate_latency,
            "baseline_error_rate": baseline_error,
            "candidate_error_rate": candidate_error,
        },
    }

    print(json.dumps(result, ensure_ascii=False, indent=2))

    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
