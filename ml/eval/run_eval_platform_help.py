"""
Generates platform_help completions from a trained adapter against its
held-out validation set and prints each one side-by-side with the reference
answer -- unlike entry_drafting/kb_authoring, a prose platform-help answer
has no rigid schema to regex-parse or validate automatically, so this is a
qualitative eval, not a numeric one. Read the output and judge whether each
generated answer:
  (1) is factually consistent with the reference (never invents a platform
      behavior, page, or setting that isn't real), and
  (2) actually answers the question asked.

MLX-only (needs a real trained checkpoint) -- run on the M5 MacBook after
train_base.py + train_adapter.py --task platform_help.

Usage:
    python3 run_eval_platform_help.py --base-checkpoint ../checkpoints/base.safetensors \\
        --adapter ../checkpoints/platform_help_adapter.safetensors
"""

import argparse
import sys
from pathlib import Path

import mlx.core as mx
import numpy as np
from tokenizers import Tokenizer

sys.path.insert(0, str(Path(__file__).parent.parent / "model"))
from config import BASE_CONFIG  # noqa: E402
from lora import attach_lora_adapters, load_adapter  # noqa: E402
from transformer_mlx import BitNetTransformer  # noqa: E402

DATA_DIR = Path(__file__).parent.parent / "data" / "prepared"
TOKENIZER_PATH = Path(__file__).parent.parent / "tokenizer" / "tokenizer.json"


def generate(model: BitNetTransformer, tokenizer: Tokenizer, prompt_ids: list[int],
             max_new_tokens: int = 200, eos_id: int | None = None) -> list[int]:
    ids = list(prompt_ids)
    for _ in range(max_new_tokens):
        window = ids[-model.cfg.max_seq_len:]
        logits = model(mx.array([window]))
        next_id = int(mx.argmax(logits[0, -1]))
        ids.append(next_id)
        if eos_id is not None and next_id == eos_id:
            break
    return ids[len(prompt_ids):]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-checkpoint", type=str, required=True)
    parser.add_argument("--adapter", type=str, required=True)
    parser.add_argument("--max-new-tokens", type=int, default=200)
    parser.add_argument("--limit", type=int, default=None, help="only show the first N val examples")
    args = parser.parse_args()

    tokenizer = Tokenizer.from_file(str(TOKENIZER_PATH))
    eos_id = tokenizer.token_to_id("<eos>")
    bos_id = tokenizer.token_to_id("<bos>")
    pad_id = tokenizer.token_to_id("<pad>")

    model = BitNetTransformer(BASE_CONFIG)
    model.load_weights(args.base_checkpoint)
    attach_lora_adapters(model)
    load_adapter(model, args.adapter)
    model.eval()

    val_data = np.load(DATA_DIR / "platform_help_val.npz")
    input_ids_all = val_data["input_ids"]
    loss_mask_all = val_data["loss_mask"]
    if args.limit:
        input_ids_all = input_ids_all[: args.limit]
        loss_mask_all = loss_mask_all[: args.limit]

    for i, (input_ids, loss_mask) in enumerate(zip(input_ids_all, loss_mask_all)):
        completion_start = int(np.argmax(loss_mask))
        prompt_ids = [t for t in input_ids[:completion_start].tolist() if t != pad_id]
        if not prompt_ids or prompt_ids[0] != bos_id:
            prompt_ids = [bos_id] + prompt_ids
        expected_ids = [t for t in input_ids[completion_start:].tolist() if t not in (pad_id, eos_id)]

        generated_ids = generate(model, tokenizer, prompt_ids, args.max_new_tokens, eos_id)

        prompt_text = tokenizer.decode(prompt_ids).strip()
        expected_text = tokenizer.decode(expected_ids).strip()
        generated_text = tokenizer.decode(generated_ids).strip()

        print(f"[{i}] {prompt_text}")
        print(f"  expected:  {expected_text}")
        print(f"  generated: {generated_text}")
        print()


if __name__ == "__main__":
    main()
