"""
Generates entry-drafting completions from a trained adapter against the
held-out validation set (prepare_dataset.py's entry_drafting_val.npz),
parses them back into draft dicts, and scores them with validate_output.py.

This is docs/slm-strategy.md Section 7's "held-out eval set per adapter,
scored on every retrain" -- the number this produces is what a negative
transfer regression would show up in before anything ships.

MLX-only (needs a real trained checkpoint) -- run on the M5 MacBook after
train_base.py + train_adapter.py. validate_output.py itself has no MLX
dependency and is already tested in this environment (test_validate_output.py).

Usage:
    python3 run_eval.py --base-checkpoint ../checkpoints/base.safetensors \\
        --adapter ../checkpoints/entry_drafting_adapter.safetensors
"""

import argparse
import re
import sys
from pathlib import Path

import mlx.core as mx
import numpy as np
from tokenizers import Tokenizer

sys.path.insert(0, str(Path(__file__).parent.parent / "model"))
sys.path.insert(0, str(Path(__file__).parent.parent / "train"))
from config import BASE_CONFIG  # noqa: E402
from lora import attach_lora_adapters, load_adapter  # noqa: E402
from transformer_mlx import BitNetTransformer  # noqa: E402
from validate_output import load_known_subject_areas, validate_draft  # noqa: E402

DATA_DIR = Path(__file__).parent.parent / "data" / "prepared"
TOKENIZER_PATH = Path(__file__).parent.parent / "tokenizer" / "tokenizer.json"

FIELD_PATTERN = re.compile(
    r"course_title:\s*(?P<course_title>.*?)\n"
    r"subject_area:\s*(?P<subject_area>.*?)\n"
    r"credit_value:\s*(?P<credit_value>.*?)\n"
    r"rationale:\s*(?P<rationale>.*)",
    re.DOTALL,
)


def parse_completion(text: str) -> dict | None:
    match = FIELD_PATTERN.search(text)
    if not match:
        return None
    draft = {k: v.strip() for k, v in match.groupdict().items()}
    return draft


def generate(model: BitNetTransformer, tokenizer: Tokenizer, prompt_ids: list[int],
             max_new_tokens: int = 120, eos_id: int | None = None) -> list[int]:
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
    parser.add_argument("--max-new-tokens", type=int, default=120)
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

    val_data = np.load(DATA_DIR / "entry_drafting_val.npz")
    known_subject_areas = load_known_subject_areas()

    results = []
    for input_ids, loss_mask in zip(val_data["input_ids"], val_data["loss_mask"]):
        completion_start = int(np.argmax(loss_mask))
        prompt_ids = [t for t in input_ids[:completion_start].tolist() if t != pad_id]
        if not prompt_ids or prompt_ids[0] != bos_id:
            prompt_ids = [bos_id] + prompt_ids

        generated_ids = generate(model, tokenizer, prompt_ids, args.max_new_tokens, eos_id)
        completion_text = tokenizer.decode(generated_ids)
        draft = parse_completion(completion_text)

        if draft is None:
            results.append((False, ["could not parse expected fields from generated text"]))
            continue
        result = validate_draft(draft, known_subject_areas)
        results.append((bool(result), result.errors))

    n_valid = sum(1 for valid, _ in results if valid)
    print(f"Format-valid: {n_valid}/{len(results)} ({100 * n_valid / max(len(results), 1):.1f}%)")
    for i, (valid, errors) in enumerate(results):
        if not valid:
            print(f"  [{i}] {errors}")


if __name__ == "__main__":
    main()
