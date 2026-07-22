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

3. kb_authoring adapter fine-tuning examples -- a cluster of word dumps ->
   one drafted knowledge-base-style entry (keywords/skills lists included),
   from data/generate_kb_authoring_synthetic.py's synthetic bootstrap.
   Skipped gracefully (no files written) if that script hasn't been run yet.
   This is a deliberate bootstrap: kb_authoring's real input is clusters of
   accumulated `human_resolutions`, which doesn't exist in meaningful volume
   yet (slm-strategy.md Section 4) -- see that generation script's docstring
   for the full reasoning on why synthetic data is being used anyway now.

4. platform_help adapter fine-tuning examples -- a parent's informal
   platform question -> Benny's answer, from the hand-authored
   data/platform_help_seed.json ground truth plus
   data/generate_platform_help_synthetic.py's paraphrased variants. Skipped
   gracefully if neither file exists.

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
import time
from pathlib import Path
from typing import Iterable

import numpy as np
from tokenizers import Tokenizer

# stdout is only line-buffered when connected to a real terminal -- piped
# through `tee` (or redirected to a file) it's fully block-buffered instead,
# so the progress prints below (the whole point of which is "don't let a
# multi-hour run look like a hang") can sit invisible for minutes. Force
# line buffering unconditionally so `python3 prepare_dataset.py | tee log`
# streams live without needing `python3 -u`.
sys.stdout.reconfigure(line_buffering=True)

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
                         batch_size: int = 2000, progress_every_seconds: float = 15.0) -> np.ndarray:
    """Tokenizes `texts` and packs them into fixed-length seq_len chunks.

    Batch-tokenizes in groups of `batch_size` and flushes every completed
    seq_len chunk into `sequences` as its own small numpy array, keeping
    only a short `carry` buffer of not-yet-chunked ids in a plain list at
    any moment -- at real corpus scale (billions of tokens) a single flat
    Python list of every token id would carry ~28+ bytes of per-int object
    overhead each, i.e. tens of GB before the token data itself is
    counted. A list of packed seq_len-sized numpy arrays holds close to
    just the actual payload instead.

    Prints a heartbeat every `progress_every_seconds` -- at real corpus
    scale (millions of texts across TinyStories's repeated epochs +
    FineWeb-Edu) this loop runs long enough that silence looks identical to
    a hang; a time-based interval keeps the cadence steady regardless of
    how fast a given machine tokenizes.
    """
    bos_id = tokenizer.token_to_id("<bos>")
    eos_id = tokenizer.token_to_id("<eos>")
    pad_id = tokenizer.token_to_id("<pad>")

    sequences: list[np.ndarray] = []
    carry: list[int] = []
    batch: list[str] = []
    texts_seen = 0
    start = time.monotonic()
    last_report = start

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
        texts_seen += 1
        if len(batch) >= batch_size:
            flush_batch()
            now = time.monotonic()
            if now - last_report >= progress_every_seconds:
                tokens_so_far = len(sequences) * seq_len
                print(f"  ...{texts_seen:,} texts tokenized, ~{tokens_so_far:,} tokens packed so far "
                      f"({now - start:.0f}s elapsed)")
                last_report = now
    flush_batch()
    print(f"  done: {texts_seen:,} texts tokenized in {time.monotonic() - start:.0f}s")

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


def load_kb_authoring_examples() -> list[dict]:
    """Reads data/kb_authoring_synthetic.jsonl (written by
    generate_kb_authoring_synthetic.py) if it exists; returns [] otherwise so
    main() can skip this task gracefully rather than erroring."""
    path = DATA_DIR / "kb_authoring_synthetic.jsonl"
    if not path.exists():
        return []
    examples = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                examples.append(json.loads(line))
    return examples


def build_kb_authoring_arrays(tokenizer: Tokenizer, examples: list[dict], max_len: int):
    """Same masked (prompt, completion) shape as build_entry_drafting_arrays,
    but the prompt is a cluster of word dumps (not a single activity) and the
    completion includes keywords/skills lists, matching
    src/lib/knowledgeBase.ts's real KnowledgeBaseEntry shape."""
    bos_id = tokenizer.token_to_id("<bos>")
    eos_id = tokenizer.token_to_id("<eos>")
    pad_id = tokenizer.token_to_id("<pad>")

    input_ids = np.full((len(examples), max_len), pad_id, dtype=np.int32)
    loss_mask = np.zeros((len(examples), max_len), dtype=np.int32)

    dropped = 0
    for i, example in enumerate(examples):
        word_dump_lines = "\n".join(f"- {w}" for w in example["word_dumps"])
        prompt_text = f"activities not yet in the knowledge base:\n{word_dump_lines}\ndraft a new knowledge base entry:\n"
        completion_text = (
            f"keywords: {', '.join(example['keywords'])}\n"
            f"course_title: {example['course_title']}\n"
            f"subject_area: {example['subject_area']}\n"
            f"skills: {', '.join(example['skills'])}\n"
            f"base_credit_hours: {example['base_credit_hours']}\n"
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


def load_platform_help_examples() -> list[dict]:
    """Hand-authored ground truth (data/platform_help_seed.json) plus
    paraphrased variants (data/generate_platform_help_synthetic.py) if that
    file exists yet -- the seed alone is enough to run this task, unlike
    kb_authoring/entry_drafting which need their generation script run
    first."""
    examples = []
    seed = json.loads((DATA_DIR / "platform_help_seed.json").read_text())
    examples.extend(seed["platform_qa"])
    synth_path = DATA_DIR / "platform_help_synthetic.jsonl"
    if synth_path.exists():
        with synth_path.open() as f:
            for line in f:
                line = line.strip()
                if line:
                    examples.append(json.loads(line))
    return examples


def build_platform_help_arrays(tokenizer: Tokenizer, examples: list[dict], max_len: int):
    bos_id = tokenizer.token_to_id("<bos>")
    eos_id = tokenizer.token_to_id("<eos>")
    pad_id = tokenizer.token_to_id("<pad>")

    input_ids = np.full((len(examples), max_len), pad_id, dtype=np.int32)
    loss_mask = np.zeros((len(examples), max_len), dtype=np.int32)

    dropped = 0
    for i, example in enumerate(examples):
        prompt_text = f"question: {example['question']}\n"
        completion_text = f"answer: {example['answer']}"
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
    parser.add_argument("--skip-base", action="store_true",
                         help="skip re-packing base_train.npy/base_val.npy -- that step re-tokenizes "
                              "the full TinyStories/FineWeb-Edu corpus (millions of texts) and is by "
                              "far the slowest part of this script. Use this when base_train.npy "
                              "already exists and you just need to (re)build one or more adapter "
                              "tasks' .npz files, e.g. after running a *_synthetic.py generator for "
                              "the first time.")
    args = parser.parse_args()

    if not TOKENIZER_PATH.exists():
        raise SystemExit(f"tokenizer not found at {TOKENIZER_PATH} -- run train_tokenizer.py first")

    tokenizer = Tokenizer.from_file(str(TOKENIZER_PATH))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)

    # 1. Base pretraining sequences: domain corpus + (if generated) the full
    # TinyStories/FineWeb-Edu base corpus.
    if args.skip_base:
        print("--skip-base set: leaving base_train.npy/base_val.npy untouched.")
    else:
        print("Packing base pretraining sequences -- millions of texts at real corpus "
              "scale, this can take a while (progress prints below)...")
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

    # 3. kb_authoring adapter fine-tuning examples (synthetic bootstrap --
    # see generate_kb_authoring_synthetic.py's docstring). Skips gracefully
    # if that script hasn't been run yet.
    kb_examples = load_kb_authoring_examples()
    if kb_examples:
        rng.shuffle(kb_examples)
        kb_input_ids, kb_loss_mask = build_kb_authoring_arrays(tokenizer, kb_examples, args.seq_len)
        n_val = max(1, int(len(kb_input_ids) * args.val_fraction))
        np.savez(OUT_DIR / "kb_authoring_train.npz",
                  input_ids=kb_input_ids[n_val:], loss_mask=kb_loss_mask[n_val:])
        np.savez(OUT_DIR / "kb_authoring_val.npz",
                  input_ids=kb_input_ids[:n_val], loss_mask=kb_loss_mask[:n_val])
        print(f"kb_authoring: {len(kb_input_ids) - n_val} train / {n_val} val examples")
    else:
        print("kb_authoring: no synthetic data yet -- run generate_kb_authoring_synthetic.py first, skipped")

    # 4. platform_help adapter fine-tuning examples.
    platform_examples = load_platform_help_examples()
    if platform_examples:
        rng.shuffle(platform_examples)
        ph_input_ids, ph_loss_mask = build_platform_help_arrays(tokenizer, platform_examples, args.seq_len)
        n_val = max(1, int(len(ph_input_ids) * args.val_fraction))
        np.savez(OUT_DIR / "platform_help_train.npz",
                  input_ids=ph_input_ids[n_val:], loss_mask=ph_loss_mask[n_val:])
        np.savez(OUT_DIR / "platform_help_val.npz",
                  input_ids=ph_input_ids[:n_val], loss_mask=ph_loss_mask[:n_val])
        print(f"platform_help: {len(ph_input_ids) - n_val} train / {n_val} val examples")
    else:
        print("platform_help: no data yet -- skipped")

    print(f"\nSaved to {OUT_DIR}/")


if __name__ == "__main__":
    main()
