"""
Turns the raw corpus into two kinds of tokenized, fixed-length numpy arrays:

1. Base-model pretraining sequences -- the domain corpus's serialized
   examples (ml/data/synthetic_corpus.jsonl + seed_examples.json) plus,
   once generated, the full TinyStories/FineWeb-Edu base corpus from
   ml/data/prepare_base_corpus.py -- concatenated and packed into
   max_seq_len chunks with <bos>/<eos> boundaries. This is what teaches
   the shared base "English + FreeLoom's domain vocabulary" competence
   (docs/slm-strategy.md Section 2).

2. Entry-drafting adapter fine-tuning examples -- the domain corpus's
   examples split into a masked (prompt, completion) shape: loss is only
   computed on the course_title/subject_area/credit_value/rationale
   completion, not on the echoed activity prompt. Standard
   instruction-tuning masking. Deliberately NOT drawn from the base
   corpus -- TinyStories/FineWeb-Edu teach general competence, not
   FreeLoom's own output format.

No knowledge-base-authoring adapter dataset yet: that task needs clusters
of accumulated `human_resolutions`, which doesn't exist in meaningful
volume yet per slm-strategy.md Section 4 ("Real data, as it accumulates").
Building synthetic data for that job now would just be guessing at a shape
real usage data hasn't validated -- revisit once real `human_resolutions`
volume exists.

Pure Python + tokenizers + numpy -- runs and is verifiable in this
environment (no MLX dependency). Run this before either MLX training loop.

Note on scale: pack_base_sequences() batch-tokenizes and flushes completed
seq_len chunks as numpy arrays rather than accumulating one flat Python
list of token ids -- at real base-corpus scale (~2.25B tokens) a flat list
of individual Python ints would need on the order of tens of GB just in
per-object overhead, before counting the actual token data.

Usage: python3 prepare_dataset.py [--seq-len 512] [--val-fraction 0.1]
"""

import argparse
import itertools
import json
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
from tokenizers import Tokenizer

DATA_DIR = Path(__file__).parent.parent / "data"
BASE_CORPUS_DIR = DATA_DIR / "base_corpus"
TOKENIZER_PATH = Path(__file__).parent.parent / "tokenizer" / "tokenizer.json"
OUT_DIR = Path(__file__).parent.parent / "data" / "prepared"

sys.path.insert(0, str(Path(__file__).parent.parent / "tokenizer"))
from train_tokenizer import format_example, iter_training_texts  # noqa: E402


# TinyStories' actual train split turned out to hold only ~475M tokens
# (2.1M stories) -- well short of the 1.75B it was originally sized for, a
# real ceiling on the dataset itself, not a bug in the pull script. Repeating
# it BASE_CORPUS_REPEATS times (~1.9B tokens total) approximates the original
# target while keeping it the dominant source, matching both this project's
# own design intent (docs/slm-strategy.md Section 4: narrow/simple data
# should dominate) and the original TinyStories paper's own precedent
# (training small models over several epochs of this same small corpus).
# FineWeb-Edu hit its 500M target in one pass and isn't repeated.
BASE_CORPUS_REPEATS = {"tinystories.jsonl": 4, "fineweb_edu.jsonl": 1}


def iter_base_corpus_texts():
    """Yields every text in the TinyStories/FineWeb-Edu base corpus written
    by ml/data/prepare_base_corpus.py, if it's been generated yet -- yields
    nothing otherwise, so this script still works against just the small
    domain corpus like it always has. Unlike train_tokenizer.py's sample
    (bounded, for vocab statistics only), this reads the full corpus: base
    pretraining needs the real token volume, not a representative slice."""
    for name, repeats in BASE_CORPUS_REPEATS.items():
        path = BASE_CORPUS_DIR / name
        if not path.exists():
            continue
        for _ in range(repeats):
            with path.open() as f:
                for line in f:
                    line = line.strip()
                    if line:
                        yield json.loads(line)["text"]


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


def pack_base_sequences(tokenizer: Tokenizer, seq_len: int, texts: Iterable[str],
                         batch_size: int = 2000) -> np.ndarray:
    """Tokenizes `texts` and packs them into fixed-length seq_len chunks.

    Batch-tokenizes in groups of `batch_size` and flushes every completed
    seq_len chunk into `sequences` as its own small numpy array, keeping
    only a short `carry` buffer of not-yet-chunked ids in a plain list at
    any moment -- at real corpus scale (billions of tokens) a single flat
    Python list of every token id would carry ~28+ bytes of per-int object
    overhead each, i.e. tens of GB before the token data itself is
    counted. A list of packed seq_len-sized numpy arrays holds close to
    just the actual payload instead.
    """
    bos_id = tokenizer.token_to_id("<bos>")
    eos_id = tokenizer.token_to_id("<eos>")
    pad_id = tokenizer.token_to_id("<pad>")

    sequences: list[np.ndarray] = []
    carry: list[int] = []
    batch: list[str] = []

    def flush_batch():
        nonlocal carry
        if not batch:
            return
        for encoding in tokenizer.encode_batch(batch):
            carry.append(bos_id)
            carry.extend(encoding.ids)
            carry.append(eos_id)
        batch.clear()
        while len(carry) >= seq_len:
            sequences.append(np.array(carry[:seq_len], dtype=np.int32))
            carry = carry[seq_len:]

    for text in texts:
        batch.append(text)
        if len(batch) >= batch_size:
            flush_batch()
    flush_batch()

    if not sequences:
        padded = carry + [pad_id] * (seq_len - len(carry))
        return np.array([padded], dtype=np.int32)
    return np.stack(sequences)


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

    # 1. Base pretraining sequences: domain corpus + (if generated) the full
    # TinyStories/FineWeb-Edu base corpus.
    base_texts = itertools.chain(iter_training_texts(), iter_base_corpus_texts())
    base_sequences = pack_base_sequences(tokenizer, args.seq_len, base_texts)
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
