# Proprietary SLM strategy — settled architecture

Scoping and architecture decisions only — no training has started yet. The rule-based
pipeline (`src/lib/pipeline/`: classify → retrieve → compose → confidence check → human
resolution) stays the production engine. The SLM's job is narrower than "replace the
pipeline": fill the specific gap the pipeline already flags, and help grow the
pipeline's own content over time. This is also an explicit learning project — training
from scratch, not just fine-tuning an existing checkpoint, is the intended path.

## 1. What it needs to do — two jobs, not five

Stages 1–3 (rules, retrieval, fragment composition) already work well for anything the
knowledge base and fragment library cover. The gap is Stage 4/5: when nothing produces a
confident match, a parent gets a blank form today. Two concrete jobs for the SLM, both
scoped to that gap:

1. **Entry drafting** — a single activity description → a candidate
   `{course_title, credit_value, rationale}` for the Stage 5 "needs your input" form,
   pre-filled instead of blank.
2. **Knowledge-base authoring** — a cluster of similar unresolved activities
   (`human_resolutions`) plus existing `knowledgeBase.ts` entries as style examples → a
   drafted new entry, for a human to approve before it ships.

Everything else in the pipeline stays classical, deliberately:
- **Subject-area classification** — a closed, stable label set. An embeddings +
  lightweight classifier (building on the same hashed vectors `src/lib/pipeline/vectorize.ts`
  already computes for Stage 2 retrieval) is more reliable and cheaper than asking a
  generative model to pick a label out of thin air.
- **Credit-hour estimation** — a duration-based heuristic/regression, not a language
  model's job.

This keeps the SLM's actual surface area to exactly two generative tasks.

## 2. Architecture: one shared base, two LoRA adapters, deterministic switching

Not two fully separate models, and not a learned Mixture-of-Experts router — both were
considered and both have real downsides for this specific case:

- **Fully separate models** would mean each one redundantly re-learns basic English
  fluency and FreeLoom's domain vocabulary from scratch — wasted capacity and wasted
  training data at a scale where both are already scarce.
- **A learned MoE router** solves a routing-ambiguity problem FreeLoom doesn't have.
  The calling code always knows deterministically which job it needs (Stage 4/5 fallback
  vs. the periodic content-review pass) — there's nothing for a router to learn.
- **A single fully-shared encoder with two output heads** (naive hard parameter
  sharing) risks a well-documented failure mode called negative transfer: a shared
  representation forced to serve two meaningfully different output shapes (single
  example → title+rationale, vs. multiple examples + few-shot context → a structured
  multi-field entry) can get pulled in conflicting directions and underperform on both.

The settled design: **one shared base model, fine-tuned once for FreeLoom's general
domain, with two lightweight LoRA adapters on top** — one per job. The shared base
carries the "understands English and FreeLoom's task domain" competence once; each
adapter carries only the last-mile specialization for its own job, avoiding the
negative-transfer failure mode that a naive shared-head design would risk. The
application code — which already knows which job it needs — swaps in the right adapter.
No learned gate, no ambiguity to resolve at inference time.

## 3. Size and architecture: v0.8, ~196.9M parameters, dense bf16 (v0.7 history below)

v0.8 is a genuine architecture change, not another turn of v0.5-v0.7's same
sizing staircase: it drops native BitNet b1.58 ternary quantization
entirely in favor of a plain dense transformer trained in bf16, and grows
from ~51.3M to ~196.9M parameters (1024 d_model, 15 layers, 16 heads,
head_dim=64, vocab_size=8000 unchanged -- see `ml/model/config.py`).
Reasons, in order:

- **Ternary quantization's own training-time cost was the real bottleneck,
  not model capacity.** Every v0.5-v0.7 sizing attempt (documented in full
  below and in `ml/RESULTS.md`) ran into a throughput ceiling that turned
  out to trace back to `BitLinear`'s straight-through-estimator
  re-quantization on every forward pass -- compute-heavier per step than an
  equivalent plain dense layer, on top of an otherwise-ordinary matmul. That
  overhead exists specifically because training needs gradients to flow
  through the quantization step; dropping quantization removes it outright,
  rather than requiring another round of hardware bisection to work around
  it at a bigger size.
- **AdamW replaces Sophia as the default.** Sophia's second-order Hessian
  estimate (`ml/model/sophia.py`) was adopted specifically to offset
  BitNet's training-time overhead by converging in fewer steps -- a
  reasonable trade when steps were expensive. With that overhead gone,
  AdamW (the standard choice, and the one every other decision in this
  section didn't have to be re-validated against) is the simpler default;
  Sophia stays available via `--optimizer sophia` for anyone who wants to
  compare the two on real data.
- **40 tokens/parameter stays exactly the same ratio** (`TRAIN_TOKENS_PER_PARAM`
  in `ml/model/config.py`) -- this is a size and training-mechanics change,
  not a re-litigation of the deliberate-overtraining trade-off Section 3's
  v0.7 discussion below already settled. At v0.8's ~196.9M params that's
  **~7.88B tokens**, recomputed from the same formula, not a new ratio.

### v0.5-v0.7 sizing history (native BitNet b1.58, superseded)

- **~26.1M ternary parameters** (512 d_model, 7 layers, 8 heads, head_dim=64,
  vocab_size=8000 — see `ml/model/config.py`), trained natively at 1.58 bits (BitNet's
  `BitLinear` layer, not post-hoc quantization of an existing model). Sizing history:
  60M for the MVP, then ~75M once the tokenizer was retrained at a real 8,000-token
  vocab (it was 1,477, sized for the original 76-example proof-of-concept corpus — the
  embedding table's own size scales with vocab_size), then shrunk to ~13.7M after the
  first real training run on the M5 measured native BitNet QAT training as
  compute-heavier per step than a plain dense model of the same size (every
  `BitLinear` forward re-quantizes its full-precision shadow weights via the
  straight-through estimator, on top of an otherwise-ordinary matmul — BitNet's famous
  speed/memory win only exists at *inference* time with truly packed low-bit weights,
  not during training). At ~81M params and the observed ~305 tok/s, one epoch projected
  to ~84 days; shrinking to ~13.7M compounded two effects at once (less compute per
  token, and a smaller deliberate-overtraining token budget to match — Section 4), and
  the actual real run came in even better than projected: **~20,600 tok/s sustained,
  ~10.3 hours for a full 766.6M-token epoch** (`ml/RESULTS.md`, 2026-07-22) — both base
  pretraining and all three adapters trained clean, coherent, correctly-formatted
  output on top of it.
- **v0.6 is the first deliberate step up** that same staircase
  (`docs/benny-case-study.md`'s "long-term vision" section — keep a competent Benny in
  production while a bigger one trains in the background, never shipping an untested
  size), not another compute-driven shrink — but its first sizing attempt was itself a
  real, documented regression. That attempt, 464 d_model / 9 layers / 8 heads
  (head_dim=58), was picked purely to land as close as possible to a round ~27.0M
  params. A real M5 run measured only **~506 tok/s** — a ~40x regression nothing in the
  param-count math predicts (1.9x more params than the 13.7M config should project to
  roughly half its throughput, ~10,500 tok/s, not a 40x cliff). Diagnosis: head_dim=58
  (and d_model=464 itself) aren't multiples of 32, unlike the 13.7M config's own
  head_dim=64 — its own doc comment already called that out as "a clean power of 2",
  deliberately, and Metal's matmul/attention kernels have well-known fast paths for
  aligned tile sizes (multiples of 32/64) with much slower generic fallbacks otherwise.
  **Corrected to 512/7/8** (head_dim=64, mlp_dim=2048) — d_model, head_dim, and mlp_dim
  are all powers of two again, restoring the same alignment property the 13.7M config
  relied on, landing at ~26.1M params instead of an exact ~27.0M. Still comfortably
  inside the well-evidenced small-BitNet-research range below.
- **v0.7 grows again, to ~51.3M params (464/9/8 was the ~27.0M-target shape; v0.7's
  target is ~50M) — 512/15/8** (d_model/n_layers/n_heads unchanged in width from v0.6,
  only deeper). Deliberately kept d_model=512/head_dim=64 rather than widening further:
  v0.6's full bisection (this section, above, and `ml/RESULTS.md`) showed the real
  memory-pressure cliff was tied to *this width's total footprint* growing with depth
  and batch size together, not to width itself -- n_layers=5 at this same width stayed
  fast even at the old batch_size=64, while n_layers=7 didn't. Going deeper at an
  already-proven-safe width is the best-evidenced way to add capacity; the corollary is
  that v0.7 will very likely need an even smaller `--batch-size` than v0.6's 16 to stay
  off that same cliff, and that hasn't been tested yet -- expect to re-run v0.6's
  batch-size bisection (halving from 16 until throughput stops improving) rather than
  assuming 16 still works untested at this size.
- This size range is unusually well-evidenced for BitNet specifically: published
  small-scale BitNet research ("BitNet b1.58 Reloaded") tested ternary models in the
  100K–48M parameter range — the closest real precedent available, well short of
  Microsoft's only public checkpoint (2B parameters) but the best-documented regime
  below it.
- Real-world coherent generation at small scale has separate, strong precedent too:
  the TinyStories research showed models under 50M parameters — even under 10M — produce
  coherent, grammatical text, *provided the training data is narrowed to match the task*
  rather than general web text (Section 4 leans directly on this).
- **Reference implementations to build from, not a blank file**: `exo-explore/mlx-bitnet`
  (real, working MLX-native ternary/BitLinear + QAT training code for Apple Silicon) for
  the BitNet-specific pieces, and `nanoGPT` (Karpathy) as the pedagogical foundation for
  understanding the standard dense-transformer training loop before layering ternary
  weights on top — reading and adapting working reference code is the standard way this
  is actually learned, not a shortcut around learning it.
- **Training token budget**: v0.7 is a deliberate change of *strategy*, not another turn
  of the same dial -- it first moved to 30 tokens/parameter (much closer to Chinchilla's
  ~20 compute-optimal ratio than v0.5/v0.6's 56/94, both well past it, the
  deliberate-overtraining trade LLaMA also made, leaning on how cheap extra
  TinyStories/FineWeb-Edu tokens are), then moved back up to **40 tokens/parameter** --
  still a real step back from v0.6's 94, just not as close to pure Chinchilla-optimal as
  the initial 30 attempt. At v0.7's ~51.3M params that's **~2.05B tokens**
  (`ml/model/config.py`'s `estimate_token_budget()`) -- landing almost exactly on the
  ~2.05B-token corpus Section 4 packs for this size (TinyStories x2 ~950M, unchanged,
  + FineWeb-Edu ~1.1B filling the remainder), so this is again sized to consume
  essentially the whole packed corpus rather than waste most of it to subsampling.

**v0.8 note**: the 40 tokens/parameter ratio itself is unchanged from v0.7 (see this
section's top). At v0.8's ~196.9M params that recomputes to **~7.88B tokens** --
Section 4's numbers below are v0.7's, kept for the historical reasoning; see
`ml/data/prepare_base_corpus.py` and `ml/train/prepare_dataset.py` for the actual
current pull/repeat targets (TinyStories still capped at ~950M/2 epochs, FineWeb-Edu
raised to ~6.95B to fill the rest of the larger budget).

## 4. Training data: two separate pools for two separate jobs

At v0.7's ~51.3M parameters, the base model's job (general English + broad academic
register) and the adapters' job (FreeLoom's exact output format) call for genuinely
different data — conflating them was the original open question here; the settled
split (numbers below are v0.7's; see the v0.8 note above for the current targets):

- **Base-pretraining pool — ~2.05B tokens, from already-generated open datasets, not a
  custom scrape**: `ml/data/prepare_base_corpus.py` streams **TinyStories**
  (`roneneldan/TinyStories`, license `cdla-sharing-1.0` — GPT-3.5/4-generated short
  stories in deliberately simple vocabulary, the direct precedent for "coherent
  generation is achievable well under 75M params if the data is narrow enough") plus
  **FineWeb-Edu** (`HuggingFaceFW/fineweb-edu`, `sample-10BT` config, license `odc-by` —
  real web text filtered to the educational-quality tier by a trained classifier, adding
  academic-register vocabulary TinyStories' toy-story register never touches).
  TinyStories was originally sized at 1.75B tokens, but its actual `train` split turned
  out to hold only **~475M unique tokens** (2.1M stories) — a real ceiling on the
  dataset's own size, discovered on the first real pull (this container's network
  policy blocks `huggingface.co`, so it had never actually run before). `ml/train/
  prepare_dataset.py` repeated TinyStories 4 epochs (~1.9B tokens) for v0.5/v0.6, to
  approximate the original target while keeping it the dominant source — both this
  project's own design intent below and the original TinyStories paper's own precedent
  (it trained small models over several epochs of this same small corpus). v0.7 repeats
  it only 2 epochs instead (~950M tokens, "2 sets") — still the dominant *individual*
  source, but no longer the majority of the overall mix once the 40-tokens/param bump
  raised FineWeb-Edu's own target to **~1.1B** (up from ~550M at the initial 30:1
  attempt, filling however much of the larger token budget TinyStories' fixed ~950M
  doesn't cover) — FineWeb-Edu is now ~54% of the mix vs. TinyStories' ~46%, continuing
  the same rebalancing direction v0.7 already started, just taken further. FineWeb-Edu
  is never repeated regardless of its target. `train/prepare_dataset.py`'s first real
  run packed ~2.46B tokens total -- sized at the time for an even earlier ~81M-param
  config; re-running `prepare_base_corpus.py` at v0.7's new ~950M/~1.1B targets is a
  real, one-time re-pull this size change calls for, since packing/tokenizing this much
  data is itself hours of work not worth doing speculatively. `train/train_base.py`'s
  full run subsamples whatever's actually packed down to the *current* config's own
  deliberate-overtraining budget (Section 3) -- at v0.7's sizing, that budget (~2.05B
  tokens) is close enough to the ~2.05B freshly-packed corpus that no meaningful
  subsampling actually happens.
  Deliberately **not** a custom scrape
  of "educational sites and documents" — most such sites are copyrighted and not
  licensed for training use, and building a scraper would just reinvent the
  deduplication/quality-filtering work these two datasets already did. Neither dataset is
  FreeLoom-domain content; they teach the shared base "understands English" competence
  from Section 2, not FreeLoom's own output format.
- **Adapter fine-tuning pool — small, custom, FreeLoom-voice specific**: the ~15
  hand-authored `knowledgeBase.ts` entries and fragment library
  (`fragments`/`composition_rules`) are already (description → structured output) pairs
  in exactly FreeLoom's target voice — too few alone to train on, but the style
  template. `ml/data/generate_synthetic.py` uses a larger model, one time, offline, to
  generate thousands of synthetic (activity description → course title + rationale)
  pairs in that same voice — knowledge distillation via synthetic data generation, a
  one-time offline data-authoring aid, not a live production dependency. This pool stays
  orders of magnitude smaller than the base-pretraining pool on purpose: it only needs
  to teach the last-mile task format, not general language competence.
- **Real data, as it accumulates**: `entries.generated_description`/`generated_reasoning`
  vs. `final_description`/`final_reasoning` (the correction signal) and
  `human_resolutions` joined to `entries` where `source_stage = 'human'` (the highest-value
  cases — things the rule-based pipeline genuinely couldn't handle). Real usage is very
  low right now, so this supplements the adapter fine-tuning pool rather than replacing
  it in the near term.
- **Future scale-up, not yet committed to**: once real revenue funds a much larger
  custom-generated corpus (on the order of tens of billions of tokens), that scale
  overshoots this ~51.3M-parameter model's deliberate-overtraining budget by roughly
  15x (~40 tokens/param target vs. ~585 tokens/param at 30B tokens) — spent on Benny as
  currently sized, most of it would go to waste. The two honest paths at that point are
  scaling the model up to match (this budget's own ratio at that token count implies
  something on the order of 750M params, a genuinely bigger model) or reusing that
  corpus across several smaller specialized models instead of overtraining one. Decide
  deliberately when the budget is real, not now.

## 5. Training plan on the actual hardware (MacBook Pro, M5, 24GB unified memory)

- Base M5 (not Pro/Max): 10-core GPU, 24GB unified memory, 153.6GB/s bandwidth. Memory
  was never the constraint at any size considered here (even the original ~81M config
  used a small fraction of 24GB) — the real bottleneck, confirmed on real hardware
  below, turned out to be compute time, not memory.
- **Confirmed, not estimated, as of the first real full-config run**: native BitNet QAT
  training is compute-heavier per step than a plain dense model of the same size, since
  every `BitLinear` forward re-quantizes its full-precision shadow weights via the
  straight-through estimator on top of an otherwise-ordinary matmul — the BitNet
  speed/memory win only exists at *inference* time with truly packed low-bit weights.
  The original ~81M-param config measured **~305 tokens/sec** on the base M5 (`mx.compile`
  + batch_size=64), projecting to ~84 days for one epoch of its own 2.42B-token budget —
  untenable. The resize to ~13.7M params was the direct response, and its real run
  (`ml/RESULTS.md`, 2026-07-22) measured **~20,600 tokens/sec**, ~10.3 hours for the full
  766.6M-token epoch — far better than a naive linear projection from the 81M number
  would have suggested, and the real headroom v0.6's step-up spends.
- **v0.6's first sizing attempt (464/9/8) measured only ~506 tok/s on a real M5 run** —
  a ~40x regression the param-count math alone doesn't explain (1.9x more params than
  the 13.7M config should project to roughly half its throughput, not a 40x cliff).
  Diagnosed as a dimension-alignment problem: head_dim=58 (from 464 d_model / 8 heads)
  isn't a multiple of 32, unlike the 13.7M config's own head_dim=64, which its doc
  comment already called out as deliberately "a clean power of 2" — Metal's
  matmul/attention kernels have well-documented fast paths for aligned tile sizes
  (multiples of 32/64) and fall back to much slower generic paths otherwise. **Corrected
  to 512/7/8** (head_dim=64, mlp_dim=2048, all powers of two again) — see Section 3.
- **The alignment fix alone wasn't enough either**: 512/7/8 on the *full* packed corpus,
  still at `train_base.py`'s then-default `--batch-size 64`, measured only **~829
  tok/s** — barely better than the misaligned config, and nowhere near the ~10,800 tok/s
  a linear projection from the 13.7M config predicted. Real hands-on bisection across
  many M5 runs (varying d_model, n_layers, and finally batch size, one variable at a
  time — full log in `ml/RESULTS.md`) traced the actual cause to batch size: at this
  model's total size, `batch_size=64`'s activation/gradient memory pushes the M5's 24GB
  unified memory into swap, and *that* swap — not the model's architecture at all — was
  the real bottleneck the whole time. A clean, single-variable confirmation (identical
  512/7/8/mlp_ratio=4 architecture, only batch size changed) nailed it down:
  `batch_size=64` → ~829 tok/s, `batch_size=16` → **~15,200 tok/s**, same hardware, same
  full corpus. `train_base.py`'s default `--batch-size` is now 16 to match.
- **v0.6 (512/7/8, ~26.1M params, batch_size=16) — real measured throughput: ~15,200
  tok/s**, or roughly **45 hours (~1.9 days)** for one full epoch over the ~2.45B-token
  budget (Section 3). A real number now, not a projection — see `ml/RESULTS.md`,
  2026-07-23, for the complete bisection log across every architecture and batch-size
  variant tried along the way.
- **v0.7 (512/15/8, ~51.3M params) throughput — never measured; superseded before a real
  run happened.** Per this section's own bisection findings above, the memory-pressure
  cliff tracked total model footprint at d_model=512 growing with depth *and* batch size
  together (n_layers=5 stayed fast at batch=64; n_layers=7 didn't) -- v0.7 was more than
  twice as deep as the config that needed batch=16, so batch_size=16 was flagged as a
  starting point to re-test, not an assumption to trust. v0.8 (below) replaced the
  architecture before that re-bisection happened.
- **v0.8 (1024/15/16, ~196.9M params, dense bf16) — a genuine architecture change, not
  another turn of this same staircase.** Drops native BitNet ternary quantization
  entirely: every measurement in this section traced its throughput ceiling back to
  `BitLinear`'s straight-through-estimator re-quantization overhead, not model capacity
  or batch size beyond the memory ceiling already found at v0.6. A plain dense
  transformer (`transformer_mlx.py`'s `DenseLinear`) removes that overhead outright.
  **Throughput not yet measured** -- this is both a bigger model (1024 vs. 512 d_model)
  and a fundamentally different compute profile per step (no quantization tax, but no
  ternary-matmul savings either, which only ever applied at inference time regardless).
  Start the same halve-until-it-stops-helping batch-size bisection from scratch rather
  than assuming any prior batch_size value transfers -- see `train/train_base.py`'s
  own `--batch-size` help text.
- **Optimizer: AdamW instead of Sophia.** Sophia ("Sophia: A Scalable Stochastic
  Second-order Optimizer for Language Model Pre-training", Liu, Zhang, Basu, Chen, Ma,
  Liang, Ma & Wang, 2023, https://arxiv.org/abs/2305.14342) was adopted for v0.7
  specifically to offset BitNet's training-time overhead -- its periodically-refreshed
  diagonal Hessian estimate reaches a given loss in roughly half the steps AdamW needs
  at comparable scale, for ~5% extra per-step compute, a reasonable trade when every
  step was already expensive. With that overhead gone in v0.8's dense architecture,
  AdamW (the standard choice) is the simpler default; Sophia stays available via
  `--optimizer sophia` for anyone who wants to compare the two on real data.
  `ml/model/sophia_math.py`'s update-rule arithmetic is still verified by its own
  numpy-only unit tests, and `ml/model/sophia.py`'s MLX wiring still **has never run on
  real hardware** -- unchanged facts, just no longer the default path.
- **Validate the pipeline at tiny scale first**: `train/train_base.py --tiny` uses a
  deliberately small model (d_model=128, 2 layers) on a small data subsample (minutes,
  not hours) to confirm the tokenizer, data loading, dense layers, and loss curve all
  behave correctly, before committing to the full run. Standard practice, not a
  shortcut — catches a pipeline bug in an
  hour instead of after days of training. `train/train_base.py`'s full run
  automatically subsamples the already-packed corpus down to whatever the current
  config's own deliberate-overtraining budget calls for (Section 4) — at v0.8's sizing
  that's ~7.88B of the freshly-packed corpus (Section 4's v0.8 note), effectively no
  subsampling — the tiny-scale check validates the pipeline, not the data volume.

## 6. Where it plugs into the pipeline

Not a new API surface — it sits inside the existing Stage 4 confidence check:

1. Stage 1 → 2 → 3 run exactly as they do today.
2. Only if all three produce no confident result: call the entry-drafting adapter for a
   candidate instead of immediately flagging Stage 5.
3. The candidate still renders in `/log`'s existing "needs your input" form, pre-filled
   instead of blank — the parent reviews/edits/accepts exactly like any other draft.
   Nothing about the transparency model changes: the SLM never writes directly to
   `entries` unreviewed.
4. Separately, on a periodic schedule (not per-request), the knowledge-base-authoring
   adapter reviews accumulated `human_resolutions`, drafts candidate new
   `knowledgeBase.ts`/`fragments` entries, and hands them off for human approval before
   they ship — the automated version of the manual "content-authoring pass" already
   used as a stopgap.

## 7. Safeguards against negative transfer and quality regressions

Same defense-in-depth pattern the rule-based pipeline already uses everywhere else,
applied to the SLM's output — not a new subsystem, an extension of the existing one:

- **Held-out eval set per adapter**, scored on every retrain. If updating one adapter
  ever degrades the other's score, that's negative transfer showing up as a number
  before it ships, not after.
- **Output-format validation** — reject a draft that doesn't have a valid subject_area,
  a plausible credit_value, or all required fields; fall through to Stage 5 same as any
  other low-confidence case.
- **Cross-check against the classical subject-area classifier** (Section 1) — if the
  entry-drafting adapter's subject guess substantially disagrees with the independent
  classical prediction, flag for human review instead of trusting the SLM silently.
  Costs nothing new to build; it's two existing signals compared against each other.
- **Per-adapter acceptance-rate monitoring** — Stage 5's UI already captures
  accept/edit/reject on every draft; track it separately per adapter. A drop after a
  retrain is a real-time quality-regression signal.
- **Canary/shadow rollout** before fully replacing a live adapter with a retrained one.
- **The existing backstop, unchanged**: the SLM never bypasses Stage 5's human review
  regardless of any of the above. Worst case for a quality regression is a worse first
  draft that gets edited or rejected more often — not bad information silently entering
  a child's record.

## 8. Rollout path

- No traffic served by either adapter until there's a trained checkpoint and an offline
  eval showing it beats "leave it blank" (entry-drafting) or "no suggestion" (knowledge-base
  authoring) on held-out cases.
- Feature-flag'd, Stage-4-fallback-only at first — never overriding a Stage 1–3
  confident result.
- Promote based on acceptance rate vs. rejection/heavy-edit rate on real Stage 5
  outcomes, same idea as the original scoping pass's "correction rate," now tracked
  per adapter per Section 7.
