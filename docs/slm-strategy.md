# Proprietary SLM strategy

Scoping pass only — no training happens in this pass. The rule-based pipeline
(`src/lib/pipeline/`) stays the production engine; the SLM's job is narrower and more
specific than "replace the pipeline": fill the gap the pipeline itself already flags,
and help grow the pipeline's own content over time.

## 1. What it would actually need to do

Since the algorithmic-MVP rebuild, FreeLoom's pipeline is Stage 1 (classify) → Stage 2
(retrieve) → Stage 3 (fragment compose) → Stage 4 (confidence check) → Stage 5 (human
resolution). Stages 1–3 are deterministic and already work well for anything the
knowledge base (`src/lib/knowledgeBase.ts`), heuristic clusters, and fragment library
(`src/lib/pipeline/compose.ts`) already cover. The gap is exactly what falls through to
Stage 5 today — a parent gets a blank form and has to write the entry themselves.

Two concrete jobs for an SLM, both scoped to that gap, not to replacing Stages 1–3:

1. **Fill in the blank at Stage 4/5** — when nothing in the rule-based stages produces
   a confident match (e.g. a game like Stationeers before anyone added it to the
   knowledge base), draft a `{subject_area, course_title, credit_value, rationale}`
   candidate instead of leaving the form empty. The parent still reviews, edits, or
   rejects it — Stage 5's human-in-the-loop UI doesn't change, only what pre-fills it.
2. **Propose knowledge-base/fragment updates** — periodically review what's piled up in
   `human_resolutions`, cluster similar unresolved activities, and draft new
   `knowledgeBase.ts`/`fragments` entries in the same format as the existing hand-written
   ones, for a human to approve before they ship. This is the automatable version of the
   manual "content-authoring pass" already proposed as a stopgap.

Both are narrow, structured tasks with a fixed output shape — not open-ended chat.

## 2. BitNet b1.58 — what it actually is, and where it does/doesn't help

Researched directly rather than assumed, since the tradeoffs matter for sizing this
correctly:

- The only real open pretrained BitNet checkpoint is **BitNet b1.58 2B4T** (Microsoft,
  2B parameters, trained on 4T tokens, MIT-licensed, weights on Hugging Face, inference
  code — `bitnet.cpp` — for both CPU and GPU). It's a LLaMA-like decoder-only
  transformer with ternary weights (`{-1, 0, +1}`) and 8-bit activations.
- **Training happens natively at 1.58 bits, not by quantizing an existing model
  afterward** — BitNet replaces the standard linear layer with a custom `BitLinear`
  layer trained end-to-end from scratch (or from a "16-to-1.58" recipe: a few epochs of
  normal-precision pretraining, then a switch to ternary quantization-aware training).
  You can't take Qwen or Llama and "convert" it to BitNet after the fact.
- **The efficiency win is at inference, not training.** Full-precision ("shadow")
  weights are kept throughout training for gradient updates — training compute/memory
  isn't cheaper than training a normal small model at the same parameter count. What's
  dramatically cheaper is *running* the trained model: roughly 8x less memory than an
  fp16 model of the same size, and CPU-only inference is genuinely practical
  (`bitnet.cpp` is built for exactly that). For FreeLoom, that matters because it's the
  difference between self-hosting a model on ordinary infrastructure vs. needing GPU
  serving — directly relevant to staying independent of a hosted API.
- Research (the "BitNet b1.58 Reloaded" paper) shows the architecture holds up at much
  smaller scale too (as small as 100K–48M parameters, with a median-based scaling
  adjustment for stability) — but that's a *research result*, not a productized training
  pipeline anyone can just run. There's no mature, off-the-shelf small-scale BitNet
  training recipe the way there is for, say, fine-tuning a small Qwen checkpoint.
- Below ~3B parameters, published results suggest a real quality gap between ternary and
  16-bit models trained from scratch at the same size — the 2B4T model's competitiveness
  with full-precision peers is specifically a ≥2B-scale result, not evidence that a
  from-scratch 100M ternary model matches a 100M fp16 model.

**Sources**: [BitNet b1.58 2B4T Technical Report](https://arxiv.org/pdf/2504.12285),
[microsoft/bitnet-b1.58-2B-4T on Hugging Face](https://huggingface.co/microsoft/bitnet-b1.58-2B-4T),
[microsoft/BitNet inference framework](https://github.com/microsoft/BitNet),
[BitNet b1.58 Reloaded](https://arxiv.org/html/2407.09527v1),
[The Era of 1-bit LLMs](https://arxiv.org/html/2402.17764v1).

## 3. Recommendation: fine-tune the 2B4T checkpoint, don't train a custom BitNet from scratch (yet)

Given the above, training a bespoke tiny BitNet from scratch means building a training
pipeline nobody has productized yet, for a quality outcome below 3B-scale that hasn't
been demonstrated to work well. The more realistic path:

- **Start from `microsoft/bitnet-b1.58-2B-4T`** and fine-tune it on FreeLoom's own task
  data (Section 4) rather than architecting a new model. At 1.58 bits, even the full 2B
  model has a genuinely small footprint (~0.4–0.5 GB), self-hostable on CPU — no API
  dependency, no GPU serving requirement.
- **Open engineering question, not yet resolved**: whether the existing LoRA tooling
  ecosystem has first-class support for BitNet's custom `BitLinear` layers, or whether
  fine-tuning here means a full fine-tune (more expensive, still one-time, still cheap
  to *run* afterward at 1.58 bits). This needs a hands-on spike before committing,
  not an assumption either way.
- **Keep the classical-ML split from the original scoping pass** — `subject_area` is
  still a closed, stable label set, better served by classification than generation.
  Stage 2's retrieval already does hashed-vector similarity (`src/lib/pipeline/vectorize.ts`)
  as a classical-ML building block; the same vectors could feed a lightweight classifier
  for subject-area prediction, leaving the SLM to do only the genuinely open-ended part:
  course-title phrasing, rationale sentences, and knowledge-base-entry drafting.
- **Custom small-scale BitNet training is a legitimate v2**, once (a) there's enough
  proprietary training data that a from-scratch model wouldn't just overfit, and (b) the
  small-scale BitNet training tooling has matured past research-paper status. Not a v1
  bet.

## 4. Training data strategy, mapped to the current schema

No new UI needed — it's already being captured by the pipeline tables:

- **`entries.generated_description`/`generated_reasoning` vs. `final_description`/
  `final_reasoning`** — every entry the rule-based pipeline drafted has both what it
  guessed and what the parent actually kept. The delta is a correction signal: identical
  generated/final means the draft was good; a diff means it wasn't, and the final values
  are the corrected label.
- **`human_resolutions` joined to `entries` where `source_stage = 'human'`** — the
  highest-value data of all: cases the rule-based pipeline flagged as unable to help at
  all (Stage 4's honest "no confident match"), where the parent wrote the full answer
  from scratch. This is precisely the gap Section 1's job #1 needs to learn to fill.
- **The existing hand-authored content itself** — `knowledgeBase.ts`'s ~15 entries and
  the fragment library's ~9 fragments are already (description → structured output)
  pairs, useful as seed/eval examples even before real usage accumulates, though far too
  few alone to fine-tune on.
- **Volume**: no fabricated target. For LoRA/task-tuning an already-capable base model
  on a narrow, fixed-format task, low hundreds to low thousands of well-labeled examples
  is a reasonable order of magnitude to aim for before evaluating readiness — but the
  honest constraint is that FreeLoom has very little real usage yet (single digits of
  entries as of this pass), so this is a "revisit once real families are actually using
  it" threshold, not a near-term one.

## 5. Where it plugs into the pipeline

Not a new API surface — the SLM sits inside the existing Stage 4 confidence check:

1. Stage 1 → 2 → 3 run exactly as they do today.
2. Only if all three produce no confident result: call the SLM for a candidate draft
   instead of immediately flagging Stage 5.
3. The candidate still renders in `/log`'s existing "needs your input" form, pre-filled
   instead of blank — the parent reviews/edits/accepts exactly like any other draft.
   Nothing about the transparency model changes: a parent still sees and can override
   everything, the SLM never writes directly to `entries` unreviewed.
4. If the SLM has no better idea either (or isn't deployed yet), fall through to today's
   blank Stage 5 form — no regression versus the current behavior.

## 6. Rollout path

- No traffic served by the SLM until there's a fine-tuned checkpoint and an offline eval
  showing it beats "leave it blank" on held-out Stage-5 cases.
- Feature-flag'd rollout, Stage-4-fallback-only at first (never overriding a Stage 1–3
  confident result).
- Quality signal: whether the parent accepts the SLM's draft as-is vs. edits it heavily
  vs. ignores it and writes their own — same "correction rate" idea as the original
  scoping pass, just measured against Stage 5 outcomes instead of Claude's.
