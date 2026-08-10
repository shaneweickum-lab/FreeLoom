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
import time
from pathlib import Path

import mlx.core as mx
import numpy as np
from tokenizers import Tokenizer

sys.path.insert(0, str(Path(__file__).parent.parent / "model"))
sys.path.insert(0, str(Path(__file__).parent.parent / "train"))
from config import BASE_CONFIG, LORA_ALPHA, LORA_RANK  # noqa: E402
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
             max_new_tokens: int = 160, eos_id: int | None = None, repetition_penalty: float = 1.3) -> list[int]:
    """Greedy (argmax) decoding, same as every other generate() in this
    project -- but plain argmax has a well-known failure mode in small
    models: once it repeats a token, that repeated pattern becomes its own
    highest-probability continuation, and it gets stuck in a loop (exactly
    the "0.25, 0.25, 0.25..." / "and aing, and theing..." collapse seen in
    real eval output). `repetition_penalty` (the standard CTRL-paper/HF
    technique: divide already-generated tokens' positive logits, multiply
    their negative logits, both pushing the logit down) discourages
    picking a token that already appeared in THIS completion, without
    switching to true stochastic sampling -- decoding stays deterministic,
    just biased against looping. Pass 1.0 to fall back to plain argmax."""
    ids = list(prompt_ids)
    generated_start = len(prompt_ids)
    for _ in range(max_new_tokens):
        window = ids[-model.cfg.max_seq_len:]
        logits = model(mx.array([window]))[0, -1].tolist()
        if repetition_penalty != 1.0:
            for tok in set(ids[generated_start:]):
                logits[tok] = logits[tok] / repetition_penalty if logits[tok] > 0 else logits[tok] * repetition_penalty
        next_id = max(range(len(logits)), key=logits.__getitem__)
        ids.append(next_id)
        if eos_id is not None and next_id == eos_id:
            break
    return ids[generated_start:]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-checkpoint", type=str, required=True)
    parser.add_argument("--adapter", type=str, required=True)
    parser.add_argument("--max-new-tokens", type=int, default=160)
    parser.add_argument("--limit", type=int, default=None, help="only run the first N val examples")
    parser.add_argument("--quiet", action="store_true", help="skip printing each completion's raw text, just the pass/fail summary")
    parser.add_argument("--rank", type=int, default=None,
                         help="LoRA rank the adapter file was actually trained/saved with -- must match "
                              "train_adapter.py's --rank for this exact adapter file, or load_adapter() "
                              "breaks on a shape mismatch. Defaults to config.py's LORA_RANK (currently 8).")
    parser.add_argument("--alpha", type=int, default=None, help="LoRA alpha; defaults to matching --rank's alpha/rank=2 convention when --rank is set, else config.py's LORA_ALPHA")
    parser.add_argument("--repetition-penalty", type=float, default=1.3, help="1.0 disables it, falling back to plain argmax")
    args = parser.parse_args()
    if args.rank is not None and args.alpha is None:
        args.alpha = args.rank * 2

    tokenizer = Tokenizer.from_file(str(TOKENIZER_PATH))
    eos_id = tokenizer.token_to_id("<eos>")
    bos_id = tokenizer.token_to_id("<bos>")
    pad_id = tokenizer.token_to_id("<pad>")

    model = BitNetTransformer(BASE_CONFIG)
    model.load_weights(args.base_checkpoint)
    lora_kwargs = {"rank": args.rank, "alpha": args.alpha} if args.rank is not None else {}
    attach_lora_adapters(model, **lora_kwargs)
    load_adapter(model, args.adapter)
    model.eval()
    print(f"Loaded {args.adapter} (rank={args.rank or LORA_RANK}, alpha={args.alpha or LORA_ALPHA})")

    val_data = np.load(DATA_DIR / "kb_authoring_val.npz")
    input_ids_all = val_data["input_ids"]
    loss_mask_all = val_data["loss_mask"]
    if args.limit:
        input_ids_all = input_ids_all[: args.limit]
        loss_mask_all = loss_mask_all[: args.limit]
    total = len(input_ids_all)

    # Autoregressive generation over the full held-out set has no other
    # output until the very end -- without this, a long eval run looks
    # identical to a hung process. Prints each raw completion (unless
    # --quiet) alongside the pass/fail -- format-valid isn't the same as
    # good: a repetition loop can still hit every required field label and
    # pass validate_kb_entry, so the pass/fail count alone can't catch
    # that, only reading the actual text can.
    results = []
    run_start = time.time()
    for i, (input_ids, loss_mask) in enumerate(zip(input_ids_all, loss_mask_all)):
        completion_start = int(np.argmax(loss_mask))
        prompt_ids = [t for t in input_ids[:completion_start].tolist() if t != pad_id]
        if not prompt_ids or prompt_ids[0] != bos_id:
            prompt_ids = [bos_id] + prompt_ids

        generated_ids = generate(model, tokenizer, prompt_ids, args.max_new_tokens, eos_id, args.repetition_penalty)
        completion_text = tokenizer.decode(generated_ids)
        draft = parse_completion(completion_text)

        if draft is None:
            valid, errors = False, ["could not parse expected fields from generated text"]
        else:
            result = validate_kb_entry(draft)
            valid, errors = bool(result), result.errors
        results.append((valid, errors))

        if not args.quiet:
            prompt_text = tokenizer.decode(prompt_ids).strip()
            print(f"[{i}] {prompt_text}")
            print(f"  generated: {completion_text.strip()}")
            print(f"  valid: {valid}" + (f"  errors: {errors}" if errors else ""))
            print()

        elapsed = time.time() - run_start
        avg = elapsed / (i + 1)
        eta = avg * (total - i - 1)
        print(f"  ...{i + 1}/{total} evaluated ({elapsed:.0f}s elapsed, ETA {eta:.0f}s)", flush=True)

    n_valid = sum(1 for valid, _ in results if valid)
    print(f"Format-valid: {n_valid}/{len(results)} ({100 * n_valid / max(len(results), 1):.1f}%)")
    for i, (valid, errors) in enumerate(results):
        if not valid:
            print(f"  [{i}] {errors}")


if __name__ == "__main__":
    main()
