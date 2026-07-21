# FreeLoom SLM — `ml/`

Implementation of the architecture in [`docs/slm-strategy.md`](../docs/slm-strategy.md):
one shared ~75M-parameter native BitNet b1.58 base model, trained from scratch, with two
LoRA adapters on top (entry-drafting, knowledge-base-authoring). This directory is a
separate Python subproject from the Next.js app in `src/` — it has no shared test runner
or build step with the TS app, and nothing here is imported by production code yet (see
"Where this plugs in" below).

## Two execution environments, on purpose

This was built in a cloud Linux container with no Apple Silicon, so the code here splits
cleanly along what that container can and can't run:

| Runs here (Linux, no GPU) | Mac-only (MLX / Apple Silicon) |
|---|---|
| `data/generate_synthetic.py` (needs a real `ANTHROPIC_API_KEY`) | `model/transformer_mlx.py` |
| `data/prepare_base_corpus.py` (needs real network access to `huggingface.co`) | `model/lora.py` |
| `tokenizer/train_tokenizer.py` | `train/train_base.py` |
| `model/bitlinear.py` + `model/test_bitlinear.py` | `train/train_adapter.py` |
| `model/config.py` | `eval/run_eval.py` |
| `train/prepare_dataset.py` | |
| `eval/validate_output.py` + `test_validate_output.py` | |

Confirmed, not assumed: `mlx` installs via pip on Linux x86_64 but its shared library
(`libmlx.so`) is Apple/Metal-only and fails to import. Also confirmed: this container's
network policy blocks `huggingface.co` outright (`data/prepare_base_corpus.py` was
written and dry-run verified here against a mocked dataset, but the real pull has never
executed — no Apple Silicon needed for that one, just open network access). Everything
in the right-hand column, plus `data/prepare_base_corpus.py`'s real pull, is written and
reviewed but has never actually executed — run it on the M5 MacBook Pro this was sized
for (see `docs/slm-strategy.md` Section 5).

## Current state, honestly

- **Training data**: 13 real `knowledgeBase.ts` entries + 60 hand-authored synthetic
  examples (`data/synthetic_corpus.jsonl`) covering 12 subject areas. This is a
  proof-of-concept volume, not the "thousands of examples" `docs/slm-strategy.md`
  Section 4 calls for — enough to validate the whole pipeline end-to-end, not enough to
  actually pretrain a useful 75M-parameter model on yet. Nowhere close, in fact: see the
  token-budget math below.
- **Tokenizer**: retrained against a sample of the real base corpus (see below), now at
  a real 8,000-token vocab (was 1,477, sized for the original 76-example
  proof-of-concept corpus — byte-level BPE ran out of distinct merges to learn at that
  size). `model/config.py`'s `vocab_size` must match this exactly (`train_base.py`
  asserts it at startup) — already updated.
- **Model sizing**: `model/config.py` computes ~80.7M base params (876 d_model, 8
  layers, 12 heads, head_dim=73, vocab_size=8000) — bumped from the earlier ~75.0M
  estimate now that it's against the real vocab size instead of the tiny proof-of-concept
  one.
- **Training token budget**: `model/config.py`'s `estimate_token_budget()` targets 30
  tokens/parameter — Chinchilla's ~20 compute-optimal ratio plus a deliberate +10
  overtraining margin (same rationale as LLaMA training past compute-optimal for a
  cheaper-to-run model). At ~80.7M params that's **~2.42 billion training tokens**.
  The domain-specific `synthetic_corpus.jsonl` (a few thousand tokens) is separately
  the entry-drafting fine-tune data, not the base-pretrain corpus below.
- **Base-pretraining corpus (pulled, on the Mac)**: `data/prepare_base_corpus.py`
  streams two already-generated, openly-licensed datasets instead of the small domain
  corpus for base pretraining — TinyStories (`roneneldan/TinyStories`, `cdla-sharing-1.0`)
  + FineWeb-Edu (`HuggingFaceFW/fineweb-edu`, `sample-10BT` config, `odc-by`). TinyStories
  was sized at 1.75B tokens but its real `train` split only holds **~475M unique tokens**
  (2.1M stories) — discovered on the first real pull, since `huggingface.co` is blocked
  in this container and this had never actually run before. FineWeb-Edu hit its 500M
  target exactly. `train/prepare_dataset.py` repeats TinyStories 4 epochs (~1.9B tokens,
  matching the original TinyStories paper's own precedent of training over several
  epochs of this same small corpus) to keep it the dominant source and land close to the
  2.42B-token budget above (~2.46B total actually packed, per `train/prepare_dataset.py`'s
  first real run — slightly over is harmless) — see `docs/slm-strategy.md` Section 4 for
  the full reasoning. Read both licenses before
  shipping a model trained on this data (the script prints both URLs on completion).
- **`entry_drafting` adapter**: has real (if small) training data via
  `train/prepare_dataset.py`.
- **`kb_authoring` adapter**: structurally wired (its own independent LoRA params on the
  same frozen base), but has **no training data yet** — that job needs a meaningful
  volume of accumulated `human_resolutions` rows, which doesn't exist yet per
  `docs/slm-strategy.md` Section 4. `train_adapter.py --task kb_authoring` fails loudly
  at the missing dataset file rather than guessing at a shape untested by real usage.

## Setup on the M5 MacBook

```bash
cd ml
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Run order

```bash
# 0. Pull the base-pretraining corpus (needs open network access to
#    huggingface.co -- run this on the Mac, not in a network-restricted
#    sandbox). Writes ~10-15GB of raw text to data/base_corpus/ -- make
#    sure there's disk headroom before running:
pip install datasets
python3 data/prepare_base_corpus.py

# 1. Retrain the tokenizer against the domain corpus + a sample of the
#    base corpus pulled in step 0:
python3 tokenizer/train_tokenizer.py --vocab-size 8000

# 2. Tokenize + pack the full corpus (domain + base) into training arrays:
python3 train/prepare_dataset.py

# 3. Pipeline sanity check FIRST -- small model, same data, minutes not hours.
#    Confirms tokenizer/data-loading/BitLinear/loss curve all behave before
#    committing to a long run (docs/slm-strategy.md Section 5):
python3 train/train_base.py --tiny

# 4. Full base pretrain (once the tiny run's loss curve looks sane, and
#    ideally once the corpus has scaled well beyond today's 73 examples):
python3 train/train_base.py

# 5. Fine-tune the entry-drafting adapter on the frozen base:
python3 train/train_adapter.py --task entry_drafting \
    --base-checkpoint checkpoints/base.safetensors

# 6. Score the adapter against its held-out set (Section 7's per-adapter eval):
python3 eval/run_eval.py \
    --base-checkpoint checkpoints/base.safetensors \
    --adapter checkpoints/entry_drafting_adapter.safetensors
```

## Tests (run anywhere, including this container)

```bash
pip install -r requirements.txt   # tokenizers, numpy, pytest -- skip the mlx/anthropic lines
python3 -m pytest model/test_bitlinear.py eval/test_validate_output.py -v
```

## Where this plugs in (not built yet)

Per `docs/slm-strategy.md` Section 6/8: nothing in `src/` calls into `ml/` yet. The
integration point, once there's a trained checkpoint with an eval that beats "leave it
blank," is a Stage 4 fallback call in `src/lib/pipeline/` — feature-flagged, never
overriding a confident Stage 1–3 result, and never bypassing Stage 5 human review. That
wiring is separate follow-up work from this scaffolding pass.

## Known gaps / next steps

- Done: `data/prepare_base_corpus.py` has now actually run (on the Mac, real network
  access) — see the corrected TinyStories/FineWeb-Edu numbers above and
  `docs/slm-strategy.md` Section 4.
- Scale `data/synthetic_corpus.jsonl` into the thousands via `data/generate_synthetic.py`
  once a real `ANTHROPIC_API_KEY` is available (this script exists but has never been
  run end-to-end — the key was an empty placeholder in every environment available
  during this pass). This is still the entry-drafting fine-tune data, separate from the
  base-pretrain corpus above — scaling it further improves the adapter, not the base.
- Retrain the tokenizer at a production vocab size against the scaled-up corpus, and
  update `model/config.py` to match.
- Once real revenue funds a much larger custom-generated corpus (discussed but not
  committed to yet): a 30B-token target is far past this 75M-parameter model's
  Chinchilla+10 budget (~400 tokens/param vs. the 30 target) — that scale of spend is
  better matched to a bigger model (~1-1.5B params at 20-30 tokens/param) than to
  overtraining Benny as currently sized, or to reusing the corpus across several small
  models rather than one.
- Build the classical subject-area cross-check from `docs/slm-strategy.md` Section 7
  (this lives in `src/lib/pipeline/`, not `ml/` — it's the existing hashed-vector
  classifier idea, not new ml/ scaffolding).
- Once `human_resolutions` accumulates real volume, build a `kb_authoring` dataset and
  extend `train/prepare_dataset.py` to produce it.
