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

Do not jump to training until the held-out eval set is large enough to measure regressions. TENSORRA's product kernel (routing, memory, tools, RAG, safety and telemetry) remains independently testable from the model checkpoint.

The first target is `openai/gpt-oss-20b`. The repository now contains a CUDA LoRA launcher based on the maintained gpt-oss Transformers/TRL path.

Prepare data:

```bash
python model-lab/prepare_sft.py raw_feedback.jsonl tensorra_train.jsonl \
  --eval-output tensorra_eval.jsonl --eval-ratio 0.05
```

Create a dedicated GPU environment and install training dependencies:

```bash
pip install -r model-lab/requirements-training.txt
```

Start the first adapter run:

```bash
python model-lab/train_sft_lora.py \
  --train tensorra_train.jsonl \
  --eval tensorra_eval.jsonl \
  --output artifacts/TENSORRA-20B-SFT-v1
```

Baseline hyperparameters live in `model-lab/configs/tensorra-20b-sft-v1.yaml`. They intentionally start near the maintained Hugging Face gpt-oss LoRA recipe instead of inventing a custom recipe before we have measurements.

Planned naming:
- `TENSORRA-20B-SFT-v1`
- `TENSORRA-20B-DPO-v1`
- `TENSORRA-Reason-v1`

## Phase 4 — self-host

Core v1 supports a dedicated OpenAI-compatible model endpoint through `TENSORRA_MODEL_BASE_URL` and `TENSORRA_MODEL_API_KEY`. A future self-hosted vLLM/compatible endpoint can therefore replace the hosted development model without rewriting the product UI, memory, RAG, planner, verifier or tool layer.

Promotion rule: never switch production to a TENSORRA checkpoint only because training loss improved. The checkpoint must beat the base model on the held-out Core Eval and must not regress tool use, factuality, safety, latency beyond the accepted budget, or Russian-language quality.

For a first side-by-side model comparison, expose the base and candidate through OpenAI-compatible endpoints and run:

```bash
BASELINE_API_KEY=... CANDIDATE_API_KEY=... \
python model-lab/compare_endpoints.py \
  --baseline-url https://BASE/v1 \
  --baseline-model openai/gpt-oss-20b \
  --candidate-url https://CANDIDATE/v1 \
  --candidate-model TENSORRA-20B-SFT-v1
```

The comparator writes both answers, latency and errors to JSONL. This does not replace the full Core eval because routing, memory, RAG and tools live above the raw checkpoint.
