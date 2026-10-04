# TENSORRA Model Lab

This folder is the path from **TENSORRA Core + open weights** to a genuinely customized TENSORRA checkpoint.

## Phase 1 — collect data (implemented)

The product stores thumbs-up/down feedback. Training use is opt-in and off by default. `training/export_opt_in_dataset.sql` exports only eligible examples.

## Phase 2 — curate data (implemented starter)

Convert an admin JSONL export into a conversational SFT dataset:

```bash
python model-lab/prepare_sft.py raw_feedback.jsonl tensorra_sft.jsonl
```

Current curation rules:
- positive examples are kept;
- negative answers are excluded unless a human correction exists;
- empty/broken rows are discarded;
- obvious emails, phone numbers, bearer tokens, API keys and password-like secrets are redacted;
- duplicate prompt/answer pairs are removed;
- output stays human-reviewable JSONL.

You can also create a deterministic held-out evaluation split:

```bash
python model-lab/prepare_sft.py raw_feedback.jsonl tensorra_train.jsonl \
  --eval-output tensorra_eval.jsonl --eval-ratio 0.05
```

Before real training, still perform manual quality review and a stronger privacy audit. Automated redaction is a guardrail, not a guarantee.

## Phase 3 — fine-tune

Do not jump to training until the held-out eval set is large enough to measure regressions. TENSORRA's product kernel (routing, memory, tools, RAG, safety and telemetry) should remain independently testable from the model checkpoint.



Target checkpoint: `openai/gpt-oss-20b` first. The model is fine-tunable and supports configurable low/medium/high reasoning. Use the official OpenAI/Hugging Face training guidance current at training time; do not freeze a stale library recipe in the product repo.

Planned naming:
- `TENSORRA-20B-SFT-v1`
- `TENSORRA-20B-DPO-v1`
- `TENSORRA-Reason-v1`

## Phase 4 — self-host

The application already talks to an OpenAI-compatible endpoint through `AI_BASE_URL`, so a future self-hosted Transformers/vLLM endpoint can replace Groq without rewriting the product UI, memory, RAG or tool layer.
