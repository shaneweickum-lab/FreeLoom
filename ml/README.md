# FreeLoom SLM — `ml/`

Implementation of the architecture in [`docs/slm-strategy.md`](../docs/slm-strategy.md):
one shared ~13.7M-parameter native BitNet b1.58 base model, trained from scratch, with
three LoRA adapters on top (entry-drafting, knowledge-base-authoring, platform-help).
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
- **Training token budget**: `model/config.py`'s `estimate_token_budget()` targets 56
  tokens/parameter — well past Chinchilla's ~20 compute-optimal ratio, a deliberate
  overtraining budget (same rationale as LLaMA training past compute-optimal for a
  cheaper-to-run model, pushed further here since Benny's base model is unusually
  small and TinyStories/FineWeb-Edu make extra tokens cheap). At ~13.7M params that's
  **~766.6 million training tokens** (the budget scales with param count too, so
  shrinking the model compounds: less compute per token *and* fewer tokens needed
  at a fixed ratio -- though the ratio itself has been bumped up from the smaller
  size's original +10 margin, see `model/config.py`). The domain-specific
  `synthetic_corpus.jsonl` (a few thousand tokens) is separately the entry-drafting
  fine-tune data, not the base-pretrain corpus below.
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
  whatever the *current* config's own budget calls for (~766.6M tokens, ~1.50M of the
  packed 4.3M sequences) rather than assuming the two always match — see
  `docs/slm-strategy.md` Section 4 for the full reasoning. Read both licenses before
  shipping a model trained on this data (the script prints both URLs on completion).
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
  (`src/lib/benny/chat.ts`, gated behind `SLM_CHAT_URL`). Training data is
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
#    Confirms tokenizer/data-loading/BitLinear/loss curve all behave before
#    committing to a long run (docs/slm-strategy.md Section 5):
python3 train/train_base.py --tiny

# 4. Full base pretrain (once the tiny run's loss curve looks sane).
#    Automatically subsamples the packed corpus down to this config's own
#    ~766.6M-token deliberate-overtraining budget rather than training on the
#    whole packed corpus (which was sized for an earlier, larger config):
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
python3 -m pytest model/test_bitlinear.py eval/test_validate_output.py eval/test_validate_kb_entry.py -v
```

## Where this plugs in

`ml/serve/inference_server.py` is the serving endpoint (see `ml/serve/README.md` for
running it and exposing it to the deployed app via a tunnel) -- MLX only runs on
Apple Silicon, and this app is deployed to Vercel/Node, so this process runs on the
M5 MacBook itself and gets reached over the network. Two integration points are
wired on the TS side, feature-flagged and inert until `SLM_ENTRY_DRAFTING_URL`/
`SLM_CHAT_URL` actually point at a running instance of it:

- **`entry_drafting`** → Stage 4 fallback in `src/lib/pipeline/slmDraft.ts`, gated
  behind `SLM_ENTRY_DRAFTING_URL` — never overrides a confident Stage 1-3 result, never
  bypasses Stage 5 human review.
- **`platform_help`** (and eventually a general chat adapter) → Benny assistant-mode
  chat panel in `src/lib/benny/chat.ts`, gated behind `SLM_CHAT_URL` — replies with an
  honest placeholder until something real is listening.

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
  committed to yet): a 30B-token target is even further past this 13.7M-parameter
  model's deliberate-overtraining budget now (~2,190 tokens/param vs. the 56 target)
  than it was at the old ~80.7M size (~400 tokens/param) — that scale of spend is better matched to
  a genuinely bigger model than to overtraining Benny as currently sized, or to reusing
  the corpus across several small models rather than one.
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
- Build the actual model-serving mechanism (how a Vercel-deployed Next.js app calls an
  MLX-only model) — explicitly not decided yet, needed before `SLM_ENTRY_DRAFTING_URL`
  or `SLM_CHAT_URL` do anything in production.
