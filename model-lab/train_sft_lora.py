#!/usr/bin/env python3
"""LoRA SFT launcher for the first TENSORRA checkpoint.

This intentionally mirrors the supported gpt-oss Transformers/TRL path:
- openai/gpt-oss-20b base checkpoint;
- MXFP4 weights dequantized for training;
- conversational JSONL produced by prepare_sft.py;
- PEFT LoRA instead of full-parameter training.

Run this on a CUDA machine. It is not intended for Vercel.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, Mxfp4Config
from trl import SFTConfig, SFTTrainer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--eval", type=Path, default=None)
    parser.add_argument("--model", default="openai/gpt-oss-20b")
    parser.add_argument("--output", type=Path, default=Path("artifacts/TENSORRA-20B-SFT-v1"))
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--max-length", type=int, default=4096)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation", type=int, default=16)
    parser.add_argument("--lora-r", type=int, default=8)
    parser.add_argument("--lora-alpha", type=int, default=16)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.train.exists():
        raise SystemExit(f"Training dataset not found: {args.train}")
    if args.eval is not None and not args.eval.exists():
        raise SystemExit(f"Evaluation dataset not found: {args.eval}")

    data_files: dict[str, str] = {"train": str(args.train)}
    if args.eval is not None:
        data_files["eval"] = str(args.eval)
    dataset = load_dataset("json", data_files=data_files)

    quantization_config = Mxfp4Config(dequantize=True)
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype="bfloat16",
        attn_implementation="eager",
        use_cache=False,
        quantization_config=quantization_config,
    )
    tokenizer = AutoTokenizer.from_pretrained(args.model)

    peft_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.0,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules="all-linear",
    )

    training_args = SFTConfig(
        output_dir=str(args.output),
        learning_rate=args.learning_rate,
        num_train_epochs=args.epochs,
        max_length=args.max_length,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=args.gradient_accumulation,
        gradient_checkpointing=True,
        warmup_ratio=0.03,
        lr_scheduler_type="cosine_with_min_lr",
        lr_scheduler_kwargs={"min_lr_rate": 0.1},
        logging_steps=1,
        save_strategy="steps",
        save_steps=100,
        eval_strategy="steps" if args.eval is not None else "no",
        eval_steps=100 if args.eval is not None else None,
        bf16=True,
        report_to="none",
        seed=42,
    )

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset.get("eval"),
        processing_class=tokenizer,
        peft_config=peft_config,
    )
    trainer.train()
    trainer.save_model(str(args.output))
    tokenizer.save_pretrained(str(args.output))

    print(f"Saved TENSORRA adapter -> {args.output}")


if __name__ == "__main__":
    main()
