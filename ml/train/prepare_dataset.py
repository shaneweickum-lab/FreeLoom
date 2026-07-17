"""
Turns the raw corpus (ml/data/synthetic_corpus.jsonl + seed_examples.json)
into two kinds of tokenized, fixed-length numpy arrays:

1. Base-model pretraining sequences -- every example's full serialized text,
   concatenated and packed into max_seq_len chunks with <bos>/<eos>
   boundaries. This is what teaches the shared base "English + FreeLoom's
   domain vocabulary" competence (docs/slm-strategy.md Section 2).

2. Entry-drafting adapter fine-tuning examples -- the same examples split
   into a masked (prompt, completion) shape: loss is only computed on the
   course_title/subject_area/credit_value/rationale completion, not on the
   echoed activity prompt. Standard instruction-tuning masking.

No knowledge-base-authoring adapter dataset yet: that task needs clusters
of accumulated `human_resolutions`, which doesn't exist in meaningful
volume yet per slm-strategy.md Section 4 ("Real data, as it accumulates").
Building synthetic data for that job now would just be guessing at a shape
real usage data hasn't validated -- revisit once real `human_resolutions`
volume exists.

Pure Python + tokenizers + numpy -- runs and is verifiable in this
environment (no MLX dependency). Run this before either MLX training loop.

Usage: python3 prepare_dataset.py [--seq-len 512] [--val-fraction 0.1]
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from tokenizers import Tokenizer

DATA_DIR = Path(__file__).parent.parent / "data"
TOKENIZER_PATH = Path(__file__).parent.parent / "tokenizer" / "tokenizer.json"
OUT_DIR = Path(__file__).parent.parent / "data" / "prepared"

sys.path.insert(0, str(Path(__file__).parent.parent / "tokenizer"))
from train_tokenizer import format_example, iter_training_texts  # noqa: E402


def load_entry_examples() -> list[dict]:
    """Only the (raw_word_dump -> structured entry) examples -- excludes the
    fragment_templates entries in seed_examples.json, which have a
    different shape and aren't used for entry-drafting fine-tuning."""
    examples = []
    seed = json.loads((DATA_DIR / "seed_examples.json").read_text())
    for entry in seed["knowledge_base_entries"]:
        examples.append({
            "raw_word_dump": entry["activity"],
            "course_title": entry["course_title"],
            "subject_area": entry["subject_area"],
            "credit_value": entry["credit_value"],
            "rationale": entry["rationale"],
        })
    with (DATA_DIR / "synthetic_corpus.jsonl").open() as f:
        for line in f:
            line = line.strip()
            if line:
                examples.append(json.loads(line))
    return examples


def pack_base_sequences(tokenizer: Tokenizer, seq_len: int) -> np.ndarray:
    bos_id = tokenizer.token_to_id("<bos>")
    eos_id = tokenizer.token_to_id("<eos>")
    pad_id = tokenizer.token_to_id("<pad>")

    all_ids: list[int] = []
    for text in iter_training_texts():
        ids = tokenizer.encode(text).ids
        all_ids.append(bos_id)
        all_ids.extend(ids)
        all_ids.append(eos_id)

    n_chunks = max(1, len(all_ids) // seq_len)
    trimmed = all_ids[: n_chunks * seq_len]
    if not trimmed:
        trimmed = all_ids + [pad_id] * (seq_len - len(all_ids))
        n_chunks = 1
    return np.array(trimmed, dtype=np.int32).reshape(n_chunks, seq_len)


def build_entry_drafting_arrays(tokenizer: Tokenizer, examples: list[dict], max_len: int):
    bos_id = tokenizer.token_to_id("<bos>")
    eos_id = tokenizer.token_to_id("<eos>")
    pad_id = tokenizer.token_to_id("<pad>")

    input_ids = np.full((len(examples), max_len), pad_id, dtype=np.int32)
    loss_mask = np.zeros((len(examples), max_len), dtype=np.int32)

    dropped = 0
    for i, example in enumerate(examples):
        prompt_text = f"activity: {example['raw_word_dump']}\n"
        completion_text = (
            f"course_title: {example['course_title']}\n"
            f"subject_area: {example['subject_area']}\n"
            f"credit_value: {example['credit_value']}\n"
            f"rationale: {example['rationale']}"
        )
        prompt_ids = [bos_id] + tokenizer.encode(prompt_text).ids
        completion_ids = tokenizer.encode(completion_text).ids + [eos_id]
        full = prompt_ids + completion_ids

        if len(full) > max_len:
            dropped += 1
            continue

        input_ids[i, : len(full)] = full
        loss_mask[i, len(prompt_ids): len(full)] = 1

    if dropped:
        print(f"  dropped {dropped}/{len(examples)} examples exceeding max_len={max_len}")

    keep = loss_mask.sum(axis=1) > 0
    return input_ids[keep], loss_mask[keep]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seq-len", type=int, default=512)
    parser.add_argument("--val-fraction", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    if not TOKENIZER_PATH.exists():
        raise SystemExit(f"tokenizer not found at {TOKENIZER_PATH} -- run train_tokenizer.py first")

    tokenizer = Tokenizer.from_file(str(TOKENIZER_PATH))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)

    # 1. Base pretraining sequences.
    base_sequences = pack_base_sequences(tokenizer, args.seq_len)
    rng.shuffle(base_sequences)
    n_val = max(1, int(len(base_sequences) * args.val_fraction)) if len(base_sequences) > 1 else 0
    base_val, base_train = base_sequences[:n_val], base_sequences[n_val:]
    np.save(OUT_DIR / "base_train.npy", base_train)
    np.save(OUT_DIR / "base_val.npy", base_val)
    print(f"Base pretraining: {len(base_train)} train / {len(base_val)} val sequences of length {args.seq_len}")

    # 2. Entry-drafting adapter fine-tuning examples.
    examples = load_entry_examples()
    rng.shuffle(examples)
    input_ids, loss_mask = build_entry_drafting_arrays(tokenizer, examples, args.seq_len)
    n_val = max(1, int(len(input_ids) * args.val_fraction))
    val_slice = slice(0, n_val)
    train_slice = slice(n_val, None)
    np.savez(OUT_DIR / "entry_drafting_train.npz",
              input_ids=input_ids[train_slice], loss_mask=loss_mask[train_slice])
    np.savez(OUT_DIR / "entry_drafting_val.npz",
              input_ids=input_ids[val_slice], loss_mask=loss_mask[val_slice])
    print(f"Entry-drafting: {len(input_ids[train_slice])} train / {len(input_ids[val_slice])} val examples")
    print(f"\nSaved to {OUT_DIR}/")
    print("No knowledge-base-authoring dataset yet -- needs real human_resolutions volume first.")


if __name__ == "__main__":
    main()
