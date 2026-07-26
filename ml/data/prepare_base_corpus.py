"""
Pulls the shared base model's pretraining corpus from two open, already-
generated datasets instead of scraping educational sites directly (real
copyright/ToS risk, and reinventing dedup/quality filtering that these
datasets already did):

- TinyStories (roneneldan/TinyStories, license cdla-sharing-1.0): ~2M
  GPT-3.5/4-generated short stories in deliberately simple vocabulary --
  the same precedent docs/slm-strategy.md Section 3 already cites for
  "coherent generation is achievable well under 75M params, if the data
  is narrow enough."
- FineWeb-Edu (HuggingFaceFW/fineweb-edu, license odc-by), sampled from
  the officially-provided "sample-10BT" dedup slice: real web text
  filtered down to the educational-quality tier by a trained classifier.
  Adds academic-register vocabulary (science/history/math terms) that
  TinyStories' toy-story register never touches.

Pulls as much TinyStories as actually exists (its real train split holds
only ~475M unique tokens -- a real ceiling discovered on the first real
pull, not a target this script can raise) plus a 550M-token FineWeb-Edu
target -- together sized for v0.7 (ml/model/config.py, ~51.3M params @ 30
tokens/param -> ~1.54B tokens). ml/train/prepare_dataset.py's
BASE_CORPUS_REPEATS packs TinyStories twice ("2 sets") to reach ~950M of
the ~1.54B total -- still the single dominant source per this project's
own research precedent (narrow/simple data is what makes small-model
coherence achievable), but a smaller relative share than v0.5/v0.6 used
(previously repeated 4x) now that FineWeb-Edu's share of the mix has grown
from ~20% to ~36%.

Both datasets are streamed (HF `streaming=True`) so this never downloads
the full underlying dataset -- only as many shards as needed to satisfy
the token targets below.

No large-vocab tokenizer exists yet to count real tokens as we go (the
committed tokenizer.json is trained on the ~76-example proof-of-concept
corpus, vocab_size=1477 -- wrong for general English). This script
approximates token count via a chars-per-token heuristic (~4 chars/token
for English prose) to decide when to stop streaming; ml/tokenizer/
train_tokenizer.py retrains the real tokenizer against a sample of this
corpus afterward, and ml/train/prepare_dataset.py's real BPE tokenizer
count will differ slightly from this estimate -- expected, not a bug.

NETWORK NOTE: this needs real, open network access to huggingface.co to
actually run. It cannot execute in a cloud sandbox whose egress policy
blocks that host (confirmed blocked in the environment this was
written in) -- run it on a machine with that access instead (e.g. the
Mac this project is otherwise sized for). Nothing about the download
itself needs MLX/Apple Silicon.

DISK NOTE: at the default targets this writes on the order of 10-15GB of
raw text (before any tokenization) -- make sure the target machine has
that much free space before running.

Usage:
    pip install datasets   # not in requirements.txt's default install --
                            # only needed to run this script
    python3 prepare_base_corpus.py
    python3 prepare_base_corpus.py --tinystories-tokens 1_750_000_000 \
        --fineweb-tokens 550_000_000
"""

import argparse
import json
import time
from pathlib import Path
from typing import Iterator

OUT_DIR = Path(__file__).parent / "base_corpus"

TINYSTORIES_DATASET = "roneneldan/TinyStories"
TINYSTORIES_LICENSE = "cdla-sharing-1.0"

FINEWEB_EDU_DATASET = "HuggingFaceFW/fineweb-edu"
FINEWEB_EDU_CONFIG = "sample-10BT"
FINEWEB_EDU_LICENSE = "odc-by"

DEFAULT_CHARS_PER_TOKEN = 4.0
# TinyStories' real train split (~475M tokens) is well short of this --
# left high on purpose so the script always just pulls everything that
# exists rather than needing to be re-tuned whenever that real ceiling
# gets re-confirmed; ml/train/prepare_dataset.py's BASE_CORPUS_REPEATS is
# what actually controls how many effective tokens TinyStories contributes.
DEFAULT_TINYSTORIES_TOKENS = 1_750_000_000
DEFAULT_FINEWEB_TOKENS = 550_000_000


def stream_texts(
    dataset_name: str,
    target_tokens: int,
    chars_per_token: float,
    config: str | None = None,
    text_field: str = "text",
    load_dataset_fn=None,
) -> Iterator[str]:
    """Streams non-empty text fields from an HF dataset until the running
    char count implies target_tokens has been reached (chars_per_token
    estimate). `load_dataset_fn` is an injectable seam so this can be
    exercised with a fake dataset in a dry run, without real network
    access or the `datasets` package's full import cost."""
    if load_dataset_fn is None:
        from datasets import load_dataset as load_dataset_fn  # local import: optional dependency

    target_chars = target_tokens * chars_per_token
    total_chars = 0
    ds = load_dataset_fn(dataset_name, name=config, split="train", streaming=True)
    for row in ds:
        text = (row.get(text_field) or "").strip()
        if not text:
            continue
        yield text
        total_chars += len(text)
        if total_chars >= target_chars:
            return


def pull_corpus(
    label: str,
    dataset_name: str,
    target_tokens: int,
    chars_per_token: float,
    out_path: Path,
    config: str | None = None,
    load_dataset_fn=None,
) -> dict:
    """Streams `dataset_name` into `out_path` (one JSON object per line,
    {"text": ...}) until target_tokens (estimated) is reached, and returns
    a manifest entry describing what was actually pulled."""
    print(f"Pulling {label} ({dataset_name}"
          f"{f', config={config}' if config else ''}) toward "
          f"~{target_tokens:,} tokens (~{target_tokens * chars_per_token / 1e9:.1f}B chars)...")

    example_count = 0
    total_chars = 0
    start = time.monotonic()
    with out_path.open("w") as f:
        for text in stream_texts(dataset_name, target_tokens, chars_per_token, config, load_dataset_fn=load_dataset_fn):
            f.write(json.dumps({"text": text}) + "\n")
            example_count += 1
            total_chars += len(text)

    elapsed = time.monotonic() - start
    estimated_tokens = int(total_chars / chars_per_token)
    print(f"  wrote {example_count:,} examples, {total_chars:,} chars "
          f"(~{estimated_tokens:,} estimated tokens) to {out_path} in {elapsed:.0f}s")

    # stream_texts() only stops early on its own target check -- if the
    # underlying dataset's train split is simply smaller than that target,
    # it runs out and the generator just ends with no error. That's a real,
    # silent shortfall worth calling out loudly rather than only in a
    # buried token count.
    if estimated_tokens < target_tokens * 0.95:
        shortfall_pct = 100 * (1 - estimated_tokens / target_tokens)
        print(f"  WARNING: {label}'s dataset ran out before reaching the "
              f"{target_tokens:,}-token target -- only {estimated_tokens:,} "
              f"tokens exist ({shortfall_pct:.0f}% short). This is the "
              f"dataset's real size, not a network/streaming issue.")

    return {
        "label": label,
        "dataset": dataset_name,
        "config": config,
        "target_tokens": target_tokens,
        "estimated_tokens": estimated_tokens,
        "example_count": example_count,
        "char_count": total_chars,
        "chars_per_token_estimate": chars_per_token,
        "out_file": out_path.name,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tinystories-tokens", type=int, default=DEFAULT_TINYSTORIES_TOKENS)
    parser.add_argument("--fineweb-tokens", type=int, default=DEFAULT_FINEWEB_TOKENS)
    parser.add_argument("--fineweb-config", type=str, default=FINEWEB_EDU_CONFIG)
    parser.add_argument("--chars-per-token", type=float, default=DEFAULT_CHARS_PER_TOKEN)
    parser.add_argument("--out-dir", type=str, default=str(OUT_DIR))
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = {"sources": []}

    manifest["sources"].append(pull_corpus(
        "tinystories", TINYSTORIES_DATASET, args.tinystories_tokens,
        args.chars_per_token, out_dir / "tinystories.jsonl",
    ))
    manifest["sources"].append(pull_corpus(
        "fineweb_edu", FINEWEB_EDU_DATASET, args.fineweb_tokens,
        args.chars_per_token, out_dir / "fineweb_edu.jsonl", config=args.fineweb_config,
    ))

    total_estimated = sum(s["estimated_tokens"] for s in manifest["sources"])
    manifest["total_estimated_tokens"] = total_estimated
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"\nTotal: ~{total_estimated:,} estimated tokens ({total_estimated / 1e9:.2f}B) "
          f"across {len(manifest['sources'])} sources. Manifest: {out_dir / 'manifest.json'}")
    print(f"\nLicenses -- read before shipping a model trained on this data:")
    print(f"  TinyStories: {TINYSTORIES_LICENSE} (https://huggingface.co/datasets/{TINYSTORIES_DATASET})")
    print(f"  FineWeb-Edu: {FINEWEB_EDU_LICENSE} (https://huggingface.co/datasets/{FINEWEB_EDU_DATASET})")
    print(f"\nNext: retrain the tokenizer against a sample of this corpus "
          f"(ml/tokenizer/train_tokenizer.py), then run ml/train/prepare_dataset.py "
          f"to pack it for training.")


if __name__ == "__main__":
    main()
