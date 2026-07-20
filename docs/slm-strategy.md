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

## 3. Size and architecture: ~75M parameters, native BitNet b1.58

- **~75M ternary parameters** (876 d_model, 8 layers, 12 heads — see
  `ml/model/config.py`), trained natively at 1.58 bits (BitNet's `BitLinear` layer, not
  post-hoc quantization of an existing model). Bumped up from an initial 60M sizing for
  the MVP; still squarely in the same small-model regime, so the precedent and
  reasoning below still apply.
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
- **Training token budget**: 30 tokens/parameter (Chinchilla's ~20 compute-optimal ratio
  plus a deliberate +10 overtraining margin, the same trade LLaMA made to get a
  cheaper-to-run model at the cost of extra training compute) — **~2.25B tokens** at
  75M params (`ml/model/config.py`'s `estimate_token_budget()`). Section 4's data plan
  needs to actually reach that volume before a full pretraining run is worth
  committing to; the current 60-example proof-of-concept corpus is several orders of
  magnitude short of it.

## 4. Training data: synthetic, style-matched — not a slice of a general web corpus

At ~75M parameters, following TinyStories' validated method matters more than following
the "grab a slice of FineWeb-Edu" approach that would make sense at 1B+ scale:

- **Seed material**: the ~15 hand-authored `knowledgeBase.ts` entries and the fragment
  library (`fragments`/`composition_rules`) are already (description → structured
  output) pairs in exactly FreeLoom's target voice and format — too few alone to train
  on, but the style template for everything else.
- **Synthetic corpus generation**: use a larger model, one time, offline, to generate a
  large volume (thousands of examples) of synthetic (activity description → course
  title + rationale) pairs covering many hobbies/games/subjects, in the same consistent
  voice as the seed entries. This is knowledge distillation via synthetic data
  generation — a one-time offline data-authoring aid, not a live production dependency,
  and it's the specific technique that made TinyStories work at this scale.
- **Real data, as it accumulates**: `entries.generated_description`/`generated_reasoning`
  vs. `final_description`/`final_reasoning` (the correction signal) and
  `human_resolutions` joined to `entries` where `source_stage = 'human'` (the highest-value
  cases — things the rule-based pipeline genuinely couldn't handle). Real usage is very
  low right now, so this supplements the synthetic corpus rather than replacing it in
  the near term.

## 5. Training plan on the actual hardware (MacBook Pro, M5, 24GB unified memory)

- Base M5 (not Pro/Max): 10-core GPU, 24GB unified memory, 153.6GB/s bandwidth. At ~75M
  parameters this is comfortably within budget for both LoRA and full/QAT training —
  meaningfully easier than the 1B-parameter case already sized as workable-but-tighter.
- No confirmed M5-specific pretraining throughput benchmark exists publicly; Apple
  Silicon is well-documented to lag discrete NVIDIA GPUs specifically for training
  workloads (vs. inference, where MLX is competitive). Time estimates here are
  order-of-magnitude, not precise — and time is not the constraint for this project.
- **Validate the pipeline at tiny scale first**: a ~10–25M parameter run on a small data
  slice (minutes to hours, not days) to confirm the tokenizer, data loading, BitLinear
  layer, and loss curve all behave correctly, before committing a multi-day run to the
  full ~75M attempt. Standard practice, not a shortcut — catches a pipeline bug in an
  hour instead of after days of training. That full run still needs the corpus to
  actually reach the ~2.25B-token budget in Section 3 first — the tiny-scale check
  validates the pipeline, not the data volume.

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
