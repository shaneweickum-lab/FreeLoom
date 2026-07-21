"""
Generates kb_authoring completions from a trained adapter against its
held-out validation set, parses them back into candidate entries, and
scores them with validate_kb_entry.py. Mirrors eval/run_eval.py closely for
the entry_drafting adapter; kept as a separate script rather than a
parametrized shared one since the two tasks' field shapes genuinely differ
(this one has keywords/skills list fields entry_drafting doesn't, and no
known-subject-area check -- see validate_kb_entry.py's docstring for why).

MLX-only (needs a real trained checkpoint) -- run on the M5 MacBook after
train_base.py + train_adapter.py --task kb_authoring. validate_kb_entry.py
itself has no MLX dependency and is already tested in this environment
(test_validate_kb_entry.py).

Usage:
    python3 run_eval_kb_authoring.py --base-checkpoint ../checkpoints/base.safetensors \\
        --adapter ../checkpoints/kb_authoring_adapter.safetensors
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
from validate_kb_entry import validate_kb_entry  # noqa: E402

DATA_DIR = Path(__file__).parent.parent / "data" / "prepared"
TOKENIZER_PATH = Path(__file__).parent.parent / "tokenizer" / "tokenizer.json"

FIELD_PATTERN = re.compile(
    r"keywords:\s*(?P<keywords>.*?)\n"
    r"course_title:\s*(?P<course_title>.*?)\n"
    r"subject_area:\s*(?P<subject_area>.*?)\n"
    r"skills:\s*(?P<skills>.*?)\n"
    r"base_credit_hours:\s*(?P<base_credit_hours>.*?)\n"
    r"rationale:\s*(?P<rationale>.*)",
    re.DOTALL,
)


def parse_completion(text: str) -> dict | None:
    match = FIELD_PATTERN.search(text)
    if not match:
        return None
    groups = {k: v.strip() for k, v in match.groupdict().items()}
    groups["keywords"] = [k.strip() for k in groups["keywords"].split(",") if k.strip()]
    groups["skills"] = [s.strip() for s in groups["skills"].split(",") if s.strip()]
    return groups


def generate(model: BitNetTransformer, tokenizer: Tokenizer, prompt_ids: list[int],
             max_new_tokens: int = 160, eos_id: int | None = None) -> list[int]:
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
    parser.add_argument("--max-new-tokens", type=int, default=160)
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

    val_data = np.load(DATA_DIR / "kb_authoring_val.npz")

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
        result = validate_kb_entry(draft)
        results.append((bool(result), result.errors))

    n_valid = sum(1 for valid, _ in results if valid)
    print(f"Format-valid: {n_valid}/{len(results)} ({100 * n_valid / max(len(results), 1):.1f}%)")
    for i, (valid, errors) in enumerate(results):
        if not valid:
            print(f"  [{i}] {errors}")


if __name__ == "__main__":
    main()
