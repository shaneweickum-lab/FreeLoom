"""
Trains a byte-level BPE tokenizer for FreeLoom's entry-drafting/knowledge-base
SLM, on the synthetic corpus (ml/data/synthetic_corpus.jsonl) plus the real
seed examples (ml/data/seed_examples.json).

Small vocabulary on purpose: at ~75M parameters, the embedding table
(vocab_size * d_model) is a meaningful fraction of total capacity. TinyStories
used a ~vocab 10K-class range for similar-scale models; this starts at 8K and
is easy to re-tune once real training data volume is known.

The corpus is serialized into the same flat "field: value" text shape the
model will actually see at train time (see ml/data/format_example in this
file) so the tokenizer's learned merges match real token boundaries in
course titles, subject areas, and rationale prose -- not just raw JSON syntax.

Usage: python3 train_tokenizer.py [--vocab-size 8000] [--out tokenizer.json]
"""

import argparse
import json
from pathlib import Path

from tokenizers import Tokenizer, pre_tokenizers, decoders, trainers
from tokenizers.models import BPE

DATA_DIR = Path(__file__).parent.parent / "data"
CORPUS_PATH = DATA_DIR / "synthetic_corpus.jsonl"
SEED_PATH = DATA_DIR / "seed_examples.json"

SPECIAL_TOKENS = ["<pad>", "<bos>", "<eos>", "<unk>"]


def format_example(example: dict) -> str:
    """Serializes one (word dump -> drafted entry) example into the flat
    text shape the model trains on: prompt fields, then a separator, then
    the fields the model must learn to generate."""
    return (
        f"activity: {example['raw_word_dump']}\n"
        f"course_title: {example['course_title']}\n"
        f"subject_area: {example['subject_area']}\n"
        f"credit_value: {example['credit_value']}\n"
        f"rationale: {example['rationale']}"
    )


def iter_training_texts():
    seed = json.loads(SEED_PATH.read_text())
    for entry in seed["knowledge_base_entries"]:
        yield (
            f"activity: {entry['activity']}\n"
            f"course_title: {entry['course_title']}\n"
            f"subject_area: {entry['subject_area']}\n"
            f"credit_value: {entry['credit_value']}\n"
            f"rationale: {entry['rationale']}"
        )
    for group_name, fragment in seed["fragment_templates"].items():
        if not isinstance(fragment, dict):
            continue
        yield (
            f"fragment: {group_name}\n"
            f"opening: {fragment['opening']}\n"
            f"connection: {fragment['connection']}\n"
            f"evaluation: {fragment['evaluation']}"
        )
    with CORPUS_PATH.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield format_example(json.loads(line))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vocab-size", type=int, default=8000)
    parser.add_argument("--out", type=str, default=str(Path(__file__).parent / "tokenizer.json"))
    args = parser.parse_args()

    texts = list(iter_training_texts())
    print(f"Training on {len(texts)} serialized examples")

    tokenizer = Tokenizer(BPE(unk_token="<unk>"))
    tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tokenizer.decoder = decoders.ByteLevel()

    trainer = trainers.BpeTrainer(
        vocab_size=args.vocab_size,
        special_tokens=SPECIAL_TOKENS,
        min_frequency=2,
        show_progress=True,
    )
    tokenizer.train_from_iterator(texts, trainer=trainer)

    out_path = Path(args.out)
    tokenizer.save(str(out_path))
    print(f"Saved tokenizer ({tokenizer.get_vocab_size()} tokens) to {out_path}")

    # Sanity check: round-trip one real example.
    sample = texts[0]
    encoded = tokenizer.encode(sample)
    decoded = tokenizer.decode(encoded.ids)
    print(f"\nSample text ({len(encoded.ids)} tokens):\n{sample[:120]}...")
    print(f"\nRound-trip decode:\n{decoded[:120]}...")


if __name__ == "__main__":
    main()
