# TENSORRA model-training track

## Goal

Create a genuinely customized TENSORRA checkpoint instead of permanently depending on a hosted model alias.

## Base checkpoint

Start with `openai/gpt-oss-20b` for iteration. The weights are open and fine-tunable under Apache 2.0, subject to the model usage policy.

## Training data policy

Only export examples when BOTH are true:

1. `profiles.allow_training = true`
2. `message_feedback.eligible_for_training = true`

Do not silently train on ordinary private chats.

## Dataset stages

1. Positive rated answers → supervised examples.
2. Negative rated answers + user corrections → preference/correction pairs.
3. Curated synthetic reasoning tasks → domain coverage.
4. Held-out eval set → never train on it.

## Model roadmap

- `TENSORRA-20B-SFT-v1`: supervised fine-tune / LoRA on curated examples.
- `TENSORRA-20B-DPO-v1`: preference optimization from good/bad pairs.
- `TENSORRA-20B-v2`: tool-use and memory-aware post-training.
- Later: distill the best behavior into a smaller fast checkpoint and keep a larger deep model.

## Reasoning levels

Reasoning levels are part of the product contract, not separate brands:

- Fast: low reasoning budget
- Balanced: medium reasoning budget
- Deep: stronger checkpoint / larger budget
- Max: high reasoning budget + verifier pass

The current product already implements this routing before fine-tuning.
