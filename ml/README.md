# FreeLoom SLM — `ml/`

Implementation of the architecture in [`docs/slm-strategy.md`](../docs/slm-strategy.md):
one shared ~13.7M-parameter native BitNet b1.58 base model, trained from scratch, with two
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

- **Training data**: 13 real `knowledgeBase.ts` entries + 2,060 synthetic examples
  (`data/synthetic_corpus.jsonl`) covering 15 subject areas — the original 60
  hand-authored proof-of-concept examples plus 2,000 generated via
  `data/generate_synthetic.py` (real `claude-sonnet-5` run, 2,000/2,000 succeeded,
  ~$15.86), matching `docs/slm-strategy.md` Section 4's "thousands of examples" target
  for the entry-drafting adapter's fine-tuning pool. This is separate from the
  base-pretraining corpus below, which is its own much larger (and already
  Chinchilla-budget-sized) pool — scaling this pool improves the adapter, not the base.
- **Tokenizer**: retrained against a sample of the real base corpus (see below), now at
  a real 8,000-token vocab (was 1,477, sized for the original 76-example
  proof-of-concept corpus — byte-level BPE ran out of distinct merges to learn at that
  size). `model/config.py`'s `vocab_size` must match this exactly (`train_base.py`
  asserts it at startup) — already updated.
- **Model sizing**: `model/config.py` computes ~13.7M base params (384 d_model, 6
  layers, 6 heads, head_dim=64, vocab_size=8000) — shrunk from an earlier ~80.7M
  (876/8/12) after the first real training run on the M5 measured native BitNet QAT
  training as compute-heavier per step than a plain dense model the same size (every
  `BitLinear` forward re-quantizes its full-precision shadow weights via the
  straight-through estimator, on top of an otherwise-ordinary matmul -- the BitNet
  speed/memory win only exists at inference time with truly packed low-bit weights, not
  during training). At ~80.7M params, the measured ~305 tok/s projected to ~84 days for
  one epoch -- untenable. See `docs/slm-strategy.md` Section 5 for the full story.
- **Training token budget**: `model/config.py`'s `estimate_token_budget()` targets 30
  tokens/parameter — Chinchilla's ~20 compute-optimal ratio plus a deliberate +10
  overtraining margin (same rationale as LLaMA training past compute-optimal for a
  cheaper-to-run model). At ~13.7M params that's **~410.7 million training tokens**
  (down from ~2.42B at the old size -- the budget scales with param count too, so
  shrinking the model compounds: less compute per token *and* fewer tokens needed).
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
  epochs of this same small corpus) to keep it the dominant source, packing ~2.46B
  tokens total on its first real run -- sized for the ~80.7M config in place at the
  time. `train/train_base.py`'s full run now subsamples that packed corpus down to
  whatever the *current* config's own budget calls for (~410.7M tokens, ~802K of the
  packed 4.3M sequences) rather than assuming the two always match — see
  `docs/slm-strategy.md` Section 4 for the full reasoning. Read both licenses before
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

# 4. Full base pretrain (once the tiny run's loss curve looks sane).
#    Automatically subsamples the packed corpus down to this config's own
#    ~410.7M-token Chinchilla+10 budget rather than training on the whole
#    packed corpus (which was sized for an earlier, larger config):
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
- Done: `data/synthetic_corpus.jsonl` scaled from 60 to 2,060 examples via
  `data/generate_synthetic.py` (real `claude-sonnet-5` run, 2,000/2,000 succeeded,
  ~$15.86). `train/prepare_dataset.py` needs to be re-run to regenerate
  `entry_drafting_{train,val}.npz` from this bigger corpus, then
  `train/train_adapter.py --task entry_drafting` re-run against the new arrays — the
  first real adapter fine-tune (on the old 66-example split) scored 4/7 (57.1%) on
  `eval/run_eval.py`, with 2 of the 3 failures being fully unparseable generations, not
  just borderline content — a data-volume problem this directly targets, not yet
  confirmed fixed.
- Done: tokenizer retrained at a real 8,000-token production vocab against the base
  corpus sample, `model/config.py` updated to match.
- Once real revenue funds a much larger custom-generated corpus (discussed but not
  committed to yet): a 30B-token target is even further past this 13.7M-parameter
  model's Chinchilla+10 budget now (~2,190 tokens/param vs. the 30 target) than it was
  at the old ~80.7M size (~400 tokens/param) — that scale of spend is better matched to
  a genuinely bigger model than to overtraining Benny as currently sized, or to reusing
  the corpus across several small models rather than one.
- Build the classical subject-area cross-check from `docs/slm-strategy.md` Section 7
  (this lives in `src/lib/pipeline/`, not `ml/` — it's the existing hashed-vector
  classifier idea, not new ml/ scaffolding).
- Once `human_resolutions` accumulates real volume, build a `kb_authoring` dataset and
  extend `train/prepare_dataset.py` to produce it.
