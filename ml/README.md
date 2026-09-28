# FreeLoom SLM — `ml/`

Implementation of the architecture in [`docs/slm-strategy.md`](../docs/slm-strategy.md):
one shared ~196.9M-parameter (v0.8) dense bf16 base model, trained from scratch, with
three LoRA adapters on top (entry-drafting, knowledge-base-authoring, platform-help).
(v0.7 and earlier used native BitNet b1.58 ternary quantization instead -- superseded,
see `docs/slm-strategy.md` Section 3 and `model/bitlinear.py`'s own doc comment.)
This directory is a separate Python subproject from the Next.js app in `src/` — it has
no shared test runner or build step with the TS app, and nothing here is imported by
production code yet (see "Where this plugs in" below).

This project is also being run as a documented public case study — see
[`docs/benny-case-study.md`](../docs/benny-case-study.md) for the dated narrative log
and [`RESULTS.md`](./RESULTS.md) for every real run's actual numbers. Update both
whenever a real training/eval run completes, not just this file.

## Two execution environments, on purpose

This was built in a cloud Linux container with no Apple Silicon, so the code here splits
cleanly along what that container can and can't run:

| Runs here (Linux, no GPU) | Mac-only (MLX / Apple Silicon) |
|---|---|
| `data/generate_synthetic.py` (needs a real `ANTHROPIC_API_KEY`) | `model/transformer_mlx.py` |
| `data/generate_kb_authoring_synthetic.py` (needs a real `ANTHROPIC_API_KEY`) | `model/lora.py` |
| `data/generate_platform_help_synthetic.py` (needs a real `ANTHROPIC_API_KEY`) | `train/train_base.py` |
| `data/prepare_base_corpus.py` (needs real network access to `huggingface.co`) | `train/train_adapter.py` |
| `tokenizer/train_tokenizer.py` | `eval/run_eval.py` |
| `model/bitlinear.py` + `model/test_bitlinear.py` | `eval/run_eval_kb_authoring.py` |
| `model/config.py` | `eval/run_eval_platform_help.py` |
| `train/prepare_dataset.py` | |
| `eval/validate_output.py` + `test_validate_output.py` | |
| `eval/validate_kb_entry.py` + `test_validate_kb_entry.py` | |
| `scripts/freeloom_scraper.py` (needs real network access to `api.eric.ed.gov`/`api.crossref.org`) | |
| `scripts/convert_research_spreadsheet.py` | |

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
- **Model sizing**: `model/config.py` computes ~196.9M base params (1024 d_model, 15
  layers, 16 heads, head_dim=64, vocab_size=8000) — v0.8, a genuine architecture change
  from v0.5-v0.7's native-BitNet-ternary staircase (~51.3M at v0.7), not another step up
  the same one. Drops ternary quantization entirely for a plain dense transformer
  trained in bf16 (`model/transformer_mlx.py`'s `DenseLinear`), after v0.5-v0.7's own
  real M5 runs consistently traced their throughput ceiling back to `BitLinear`'s
  per-step quantization overhead, not model capacity or batch size beyond the memory
  ceiling v0.6 diagnosed. **v0.8's own throughput has not been measured yet** — this is
  both a wider model and a different compute profile per step, so `--batch-size 16`
  (carried over as a starting point) needs the same halve-until-it-stops-helping
  bisection re-run from scratch, not assumed. See `docs/slm-strategy.md` Section 3 for
  the full v0.5-v0.7 sizing history and the v0.8 redesign reasoning, and `RESULTS.md`
  for every real run's actual numbers.
- **Optimizer**: `train/train_base.py` now defaults to **AdamW** (`--optimizer adamw`)
  again, after v0.7 defaulted to Sophia specifically to offset BitNet's training-time
  overhead — with that overhead gone in v0.8's dense architecture, the standard
  optimizer is the simpler default. Sophia (a second-order optimizer using a
  periodically-refreshed diagonal Hessian estimate, Liu, Zhang, Basu, Chen, Ma, Liang,
  Ma & Wang, 2023, [arXiv:2305.14342](https://arxiv.org/abs/2305.14342)) stays
  available via `--optimizer sophia` for anyone who wants to compare the two on real
  data; `model/sophia_math.py`'s update-rule arithmetic is still verified by
  `model/test_sophia_math.py` in this Linux sandbox, and `model/sophia.py`'s MLX wiring
  still **has never actually run** on real hardware — unchanged facts, just no longer
  the default path.
- **Training token budget**: `model/config.py`'s `estimate_token_budget()` still targets
  **40 tokens/parameter** — unchanged ratio from v0.7 (see `docs/slm-strategy.md`
  Section 3 for how v0.5-v0.7 arrived at 40), just recomputed at v0.8's bigger param
  count. At v0.8's ~196.9M params that's **~7.88 billion training tokens**. The
  domain-specific `synthetic_corpus.jsonl` (a few thousand tokens) is separately the
  entry-drafting fine-tune data, not the base-pretrain corpus below (though it's also
  mixed into base pretraining — see the next bullet).
- **Base-pretraining corpus (pulled, on the Mac)**: `data/prepare_base_corpus.py`
  streams two already-generated, openly-licensed datasets instead of the small domain
  corpus for base pretraining — TinyStories (`roneneldan/TinyStories`, `cdla-sharing-1.0`)
  + FineWeb-Edu (`HuggingFaceFW/fineweb-edu`, `sample-10BT` config, `odc-by`), plus the
  domain `synthetic_corpus.jsonl` mixed in via `train/prepare_dataset.py`'s
  `main()` (`itertools.chain(iter_training_texts(), iter_base_corpus_texts())`).
  TinyStories was originally sized at 1.75B tokens but its real `train` split only
  holds **~475M unique tokens** (2.1M stories) — discovered on the first real pull,
  since `huggingface.co` is blocked in this container and this had never actually run
  before. `train/prepare_dataset.py` still repeats TinyStories only 2 epochs
  (~950M tokens), **unchanged from v0.7 despite v0.8's ~4x bigger token budget** —
  TinyStories' own ~475M-token ceiling doesn't grow just because the model did, and
  repeating a fixed small corpus further risks memorization past what the TinyStories
  paper's own precedent (a few epochs) actually validated. All of v0.8's extra budget
  comes from FineWeb-Edu's own pull target instead, raised 1.1B → **~6.95B tokens** to
  fill the remainder, making FineWeb-Edu the large majority of the mix now (~88% vs.
  TinyStories' ~12%) — a much bigger swing than v0.6/v0.7's gradual rebalancing, because
  a token-budget jump this size has to land somewhere and TinyStories has a hard ceiling
  that isn't it. Re-run both `data/prepare_base_corpus.py` and `train/prepare_dataset.py`
  before training v0.8 — the previously-packed corpus was sized for v0.7's smaller
  ~2.05B-token budget. `train/train_base.py`'s full run subsamples the freshly packed
  corpus down to whatever the *current* config's own budget calls for — at v0.8's
  sizing (~7.88B tokens) that's effectively the whole freshly-packed corpus, not a
  meaningful subsample. See `docs/slm-strategy.md` Section 4 for the full reasoning.
  Read both licenses before shipping a model trained on this data (the script prints
  both URLs on completion).
- **`entry_drafting` adapter**: real training data via `train/prepare_dataset.py`,
  confirmed working (see the Known gaps entry below).
- **`kb_authoring` adapter**: now has a synthetic *bootstrap* dataset via
  `data/generate_kb_authoring_synthetic.py` — a deliberate deviation from this
  project's original plan (kb_authoring's real input is clusters of accumulated
  `human_resolutions` cases, which don't exist in meaningful volume yet per
  `docs/slm-strategy.md` Section 4; synthetic data for this task was originally held
  off as "guessing at a shape real usage data hasn't validated"). Each synthetic
  example is a cluster of 3 informal word dumps about the same niche activity
  deliberately absent from `src/lib/knowledgeBase.ts`'s real keyword list, paired with
  one drafted new entry (`keywords`/`skills` lists included, matching that file's real
  `KnowledgeBaseEntry` shape) generalizing across them. **660 clusters** generated
  across two real `claude-sonnet-5` runs (~$7.21 total — the first run stopped early at
  160/500 on an exhausted API credit balance, not a cost-cap or bug; a second run after
  adding credits finished clean at 500/500). Scored via `eval/run_eval_kb_authoring.py`
  against `eval/validate_kb_entry.py` — deliberately has **no** known-subject-area
  cross-check (unlike entry_drafting's), since this adapter's whole job is drafting
  entries for topics not already known. `subject_area` values came out highly
  fragmented across clusters (e.g. "Engineering / Physics" vs. "Physics / Engineering"
  vs. "Engineering / Applied Physics") since there's no fixed topic→subject mapping
  the way entry_drafting's `TOPIC_POOL` has — expected, not a bug, and not penalized by
  the validator. Retrain on real `human_resolutions` clusters once meaningful volume
  accumulates — this bootstrap is a stand-in, not a permanent substitute.
- **`platform_help` adapter**: answers a parent's informal question about how the
  FreeLoom platform itself works (not an entry-drafting or kb-authoring task) — the
  first step toward Benny answering real questions in the assistant-mode chat panel
  (`src/lib/benny/chat.ts`). Training data is
  hand-authored ground truth (`data/platform_help_seed.json`, 24 accurate
  question/answer pairs about real FreeLoom features) plus paraphrased variants from
  `data/generate_platform_help_synthetic.py`, anchored per-seed so the model learns to
  vary phrasing without ever inventing a platform behavior that isn't real — accuracy
  matters more here than for the other two adapters, since a wrong chat answer is read
  directly by a parent rather than passing through Stage 5 human review first.
  **1,360 paraphrased variants** generated across two real `claude-sonnet-5` runs
  (~$5.10 total, same credit-exhaustion-then-top-up pattern as kb_authoring) + the 24
  seed examples = **1,384 total**. Scored qualitatively via
  `eval/run_eval_platform_help.py` (no rigid schema to regex-validate for free-form
  prose, unlike the other two adapters).

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
#    Confirms tokenizer/data-loading/dense-layer/loss curve all behave before
#    committing to a long run (docs/slm-strategy.md Section 5):
python3 train/train_base.py --tiny

# 4. Full base pretrain (once the tiny run's loss curve looks sane).
#    Automatically subsamples the packed corpus down to this config's own
#    ~7.88B-token budget (40 tokens/param) -- at v0.8's sizing that's
#    effectively the whole packed corpus, not a meaningful subsample. Defaults
#    to --optimizer adamw (v0.8's default; --optimizer sophia is available to
#    compare, see the Optimizer note above). Default --batch-size is 16,
#    carried over as a starting point only -- NOT yet re-verified at v0.8's
#    bigger, dense architecture, expect to re-bisect from scratch if
#    throughput looks off. Every --diagnostic-every-steps (default 500)
#    prints val_loss on a small fixed held-out subsample plus a short
#    greedy-decoded text sample from the current weights -- added after a
#    real v0.6 run's train loss reversed 22 hours in with zero val_loss data
#    anywhere near that point to tell overfitting apart from an LR-stability
#    issue (no LR schedule exists yet, see the Model sizing note above and
#    docs/slm-strategy.md Section 5):
python3 train/train_base.py

# 5. Fine-tune the entry-drafting adapter on the frozen base:
python3 train/train_adapter.py --task entry_drafting \
    --base-checkpoint checkpoints/base.safetensors

# 6. Score the adapter against its held-out set (Section 7's per-adapter eval):
python3 eval/run_eval.py \
    --base-checkpoint checkpoints/base.safetensors \
    --adapter checkpoints/entry_drafting_adapter.safetensors

# 7. (Optional) Generate the kb_authoring bootstrap + platform_help synthetic
#    data (needs a real ANTHROPIC_API_KEY -- run these two anywhere with
#    network access, not necessarily the Mac), then re-run step 2 to pack them:
python3 data/generate_kb_authoring_synthetic.py --count 500 --max-cost 15.00
python3 data/generate_platform_help_synthetic.py --per-seed 30 --max-cost 10.00
python3 train/prepare_dataset.py

# 8. Fine-tune + score the two new adapters, same pattern as steps 5-6:
python3 train/train_adapter.py --task kb_authoring \
    --base-checkpoint checkpoints/base.safetensors
python3 eval/run_eval_kb_authoring.py \
    --base-checkpoint checkpoints/base.safetensors \
    --adapter checkpoints/kb_authoring_adapter.safetensors

python3 train/train_adapter.py --task platform_help \
    --base-checkpoint checkpoints/base.safetensors
python3 eval/run_eval_platform_help.py \
    --base-checkpoint checkpoints/base.safetensors \
    --adapter checkpoints/platform_help_adapter.safetensors
```

## Tests (run anywhere, including this container)

```bash
pip install -r requirements.txt   # tokenizers, numpy, pytest -- skip the mlx/anthropic lines
python3 -m pytest model/test_bitlinear.py model/test_sophia_math.py eval/test_validate_output.py eval/test_validate_kb_entry.py -v
```

## Where this plugs in

Inference runs in-process, inside FreeLoom's own Next.js server —
`ml/serve/export_web_weights.py` bakes the trained base + adapters into a portable
format (no MLX needed for a fixed-weight forward pass, only for training), and
`src/lib/benny/inference/` is a from-scratch TS port of the same forward pass that
reads that output directly. See that directory's own README for the full picture,
and `ml/serve/README.md` for the (now-optional) standalone HTTP server this
replaced. Two integration points, feature-flagged and inert until
`src/lib/benny/inference/weights/`'s files are actually bundled with the deployment:

- **`entry_drafting`** → Stage 4 fallback in `src/lib/pipeline/slmDraft.ts` — never
  overrides a confident Stage 1-3 result, never bypasses Stage 5 human review.
- **`platform_help`** (and eventually a general chat adapter) → Benny assistant-mode
  chat panel in `src/lib/benny/chat.ts` — replies with an honest placeholder until
  the weight files are bundled.

`kb_authoring` has no TS-side integration point yet — per `docs/slm-strategy.md`
Section 6, it's meant to run on a periodic schedule (not per-request) reviewing
accumulated cases and handing off drafted entries for human approval, not something a
single request calls synchronously. That scheduling/approval-queue piece is unbuilt.

## Known gaps / next steps

- Done: `data/prepare_base_corpus.py` has now actually run (on the Mac, real network
  access) — see the corrected TinyStories/FineWeb-Edu numbers above and
  `docs/slm-strategy.md` Section 4.
- Done: `data/synthetic_corpus.jsonl` scaled from 60 to 2,060 examples via
  `data/generate_synthetic.py` (real `claude-sonnet-5` run, 2,000/2,000 succeeded,
  ~$15.86), confirmed to fix the data-volume problem it targeted:
  `entry_drafting_{train,val}.npz` regenerated at 1,866 train / 207 val examples (up
  from 66/7), and a re-run of `train/train_adapter.py --task entry_drafting` produced a
  smooth, near-monotonic val_loss curve (2.2611 → 1.9584 across epochs 1-9, only a
  trivial uptick at epoch 10) instead of the old run's sharp overfitting spike. Scored
  on the full 207-example held-out set via `eval/run_eval.py`: **206/207 (99.5%)
  format-valid** — the one remaining failure is the same category as before (an
  unparseable generation), just far rarer at this data volume. A real, statistically
  meaningful result now (n=207 vs. the old n=7, where a single example flipping swung
  the score by ~14 points).
- Done: tokenizer retrained at a real 8,000-token production vocab against the base
  corpus sample, `model/config.py` updated to match.
- Once real revenue funds a much larger custom-generated corpus (discussed but not
  committed to yet): a 30B-token target is still past this ~196.9M-parameter (v0.8)
  model's deliberate-overtraining budget (~152 tokens/param vs. the 40 target, ~3.8x
  over -- much closer than v0.7's ~51.3M-param version was, at ~15x over the same
  30B-token target) — that scale of spend is better matched to a genuinely bigger model
  (~750M params at a 40:1 ratio, unchanged math) than to overtraining Benny as
  currently sized, or to reusing the corpus across several small models rather than one.
- Build the classical subject-area cross-check from `docs/slm-strategy.md` Section 7
  (this lives in `src/lib/pipeline/`, not `ml/` — it's the existing hashed-vector
  classifier idea, not new ml/ scaffolding).
- Done (bootstrap, not final): `kb_authoring` now has a synthetic dataset via
  `data/generate_kb_authoring_synthetic.py` (660 clusters, ~$7.21). Retrain on real
  `human_resolutions` clusters once meaningful volume accumulates — see the Current
  state entry above for the full reasoning on why synthetic data was used now despite
  the original plan. Training + eval on this dataset not yet run.
- Done: `platform_help` adapter for Benny answering FreeLoom platform questions —
  `data/platform_help_seed.json` (24 hand-authored ground-truth Q&A pairs) +
  `data/generate_platform_help_synthetic.py`'s paraphrased variants (1,360 generated,
  ~$5.10) = 1,384 total examples. Training + eval on this dataset not yet run. No
  production serving decided yet (see "Where this plugs in").
- Done: model-serving mechanism built — `ml/serve/export_web_weights.py` +
  `src/lib/benny/inference/`'s TS port run inference in-process inside the deployed
  Next.js app itself, no external Mac/tunnel dependency. See that directory's README.
