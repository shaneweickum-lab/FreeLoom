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
| `tokenizer/train_tokenizer.py` | `model/lora.py` |
| `model/bitlinear.py` + `model/test_bitlinear.py` | `train/train_base.py` |
| `model/config.py` | `train/train_adapter.py` |
| `train/prepare_dataset.py` | `eval/run_eval.py` |
| `eval/validate_output.py` + `test_validate_output.py` | |

Confirmed, not assumed: `mlx` installs via pip on Linux x86_64 but its shared library
(`libmlx.so`) is Apple/Metal-only and fails to import. Everything in the right-hand
column is written and reviewed but has never actually executed — run it on the M5
MacBook Pro this was sized for (see `docs/slm-strategy.md` Section 5).

## Current state, honestly

- **Training data**: 13 real `knowledgeBase.ts` entries + 60 hand-authored synthetic
  examples (`data/synthetic_corpus.jsonl`) covering 12 subject areas. This is a
  proof-of-concept volume, not the "thousands of examples" `docs/slm-strategy.md`
  Section 4 calls for — enough to validate the whole pipeline end-to-end, not enough to
  actually pretrain a useful 75M-parameter model on yet. Nowhere close, in fact: see the
  token-budget math below.
- **Tokenizer**: trained on that small corpus, landed at 1,477 tokens (byte-level BPE
  ran out of distinct merges to learn — expected at this corpus size). Retrain at a
  larger `--vocab-size` (e.g. 8000) once the corpus scales into the thousands, and
  update `model/config.py`'s `vocab_size` to match — the two are required to agree
  (`train_base.py` asserts this at startup).
- **Model sizing**: `model/config.py` computes ~75.0M base params (876 d_model, 8
  layers, 12 heads, head_dim=73) against the *current* small vocab; this will shift
  slightly once the tokenizer is retrained at a realistic vocab size.
- **Training token budget**: `model/config.py`'s `estimate_token_budget()` targets 30
  tokens/parameter — Chinchilla's ~20 compute-optimal ratio plus a deliberate +10
  overtraining margin (same rationale as LLaMA training past compute-optimal for a
  cheaper-to-run model). At ~75M params that's **~2.25 billion training tokens**. The
  current 60-example corpus is on the order of a few thousand tokens — several orders
  of magnitude short. This isn't a data-loading detail to fix later; it's the actual
  blocker between "the architecture is sized" and "there's anything to train it on."
  The corpus needs to scale into the hundreds of thousands to millions of examples
  (synthetic generation per `docs/slm-strategy.md` Section 4, plus real usage data as it
  accumulates) before a full (non-`--tiny`) pretraining run is worth committing days of
  Mac time to.
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
# 1. (Already done, artifact committed) Retrain only if the corpus has grown:
python3 tokenizer/train_tokenizer.py --vocab-size 8000

# 2. Tokenize + pack the corpus into training arrays:
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

- Scale `data/synthetic_corpus.jsonl` into the thousands via `data/generate_synthetic.py`
  once a real `ANTHROPIC_API_KEY` is available (this script exists but has never been
  run end-to-end — the key was an empty placeholder in every environment available
  during this pass).
- Retrain the tokenizer at a production vocab size against the scaled-up corpus, and
  update `model/config.py` to match.
- Build the classical subject-area cross-check from `docs/slm-strategy.md` Section 7
  (this lives in `src/lib/pipeline/`, not `ml/` — it's the existing hashed-vector
  classifier idea, not new ml/ scaffolding).
- Once `human_resolutions` accumulates real volume, build a `kb_authoring` dataset and
  extend `train/prepare_dataset.py` to produce it.
