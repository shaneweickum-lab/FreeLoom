# Proprietary SLM strategy

Claude stays the production engine. This is a scoping pass for a future, purpose-built
small language model dedicated to FreeLoom's specific jobs — not a decision to start
training yet.

## 1. What it would actually need to do

FreeLoom's AI usage is narrow and structured, not open-ended chat. The concrete jobs,
all currently handled by Claude via `src/lib/translate.ts` and `src/lib/assistantTools.ts`:

1. **Log translation** (`translateLearningLog`): plain-language activity description →
   `{course_title, subject_area, credit_hours, rationale}`.
2. **Discovery track suggestion** (`suggestTracks`): free-text notes → a short list of
   `{subject, rationale}` suggestions.
3. **Portfolio categorization** (new, see Part C of the product plan): an uncategorized
   portfolio item's caption/description → a matching class (`learning_log_id`) or a new
   one, with a rationale.

All three are variations on the same shape: unstructured parent text in, a small
structured object with a short natural-language rationale out. That's a much narrower
target than general chat, which is exactly what makes a small model plausible here.

## 2. Candidate small open architectures

None of these are benchmarked against FreeLoom's actual task yet — that only happens
once there's real data to test against (Section 4). Rough shortlist, smallest to
largest:

- **Qwen2.5 0.5B / 1.5B / 3B** — strong instruction-following for its size, Apache 2.0,
  good multilingual/structured-output track record. Likely starting point.
- **SmolLM2 1.7B** — purpose-built to be small and efficient; worth a look given the
  low complexity of the target task.
- **Llama 3.2 1B / 3B** — solid baseline, but Llama's community license has usage
  restrictions worth checking against FreeLoom's business model before committing.
- **Phi-3.5-mini (3.8B)** — punches above its size on reasoning-flavored tasks; heavier
  than the others here, worth it only if the smaller models underperform on rationale
  quality.
- **Gemma 2 2B** — another credible mid-point if 1.5B-class models fall short.

Recommendation: start the smallest (Qwen2.5 0.5B or SmolLM2) and only move up if
quality genuinely requires it — the task is narrow enough that a bigger model may be
unnecessary cost.

## 3. Hybrid ML recommendation, not just "one model"

`subject_area` is a closed, fairly stable label set (Math, Life Science, PE, etc.) —
that's a classification problem, not a generation problem. A cheap
**sentence-transformer embedding + a lightweight classifier** (logistic regression or
k-NN over embeddings) will likely be more reliable and far cheaper than asking a
generative model to pick a label out of thin air, and it degrades more predictably at
low data volumes.

Suggested split:
- **Subject-area classification** → embeddings + classifier (traditional ML, not an
  LM at all).
- **Credit-hour estimation** → likely a simple regression/heuristic (activity duration,
  activity type) rather than something an LM should be guessing either.
- **Course title + rationale text** → the one part that's genuinely open-ended
  generation, and the only piece that actually needs the small LM.

This keeps the LM's job as small as possible, which matters a lot at the parameter
counts above.

## 4. Training data strategy

No new UI is needed to start collecting this. It already exists, in disguise:

- Every `translated_courses` row created by Claude is a labeled example
  (input description → structured output).
- The `status` field (`suggested` → `approved` / `edited` / `rejected`) is an implicit
  correction signal: an `edited` row means Claude's first guess was wrong and the
  parent's edit is the corrected label — exactly the kind of data a fine-tune wants,
  and higher-value than an unedited `approved` row.
- The only action item here: don't let this data go stale/unused. Once volume exists,
  export `(raw_description, activity_type, ai output, final approved/edited output)`
  tuples as the training set.

## 5. Fine-tuning approach and go/no-go threshold

LoRA or QLoRA on the chosen base model, not a full fine-tune — far cheaper, and the
task is narrow enough that a full fine-tune is unlikely to be worth its cost.

Don't start this until there's a meaningful volume of real `edited` corrections to
train against — a model fine-tuned on too little data will just overfit to a handful
of families' phrasing. No fabricated number here; the honest answer is "enough that a
held-out test set actually means something," which needs revisiting once usage data
exists.

## 6. Rollout path

- Claude remains the default and the fallback in every case (already the existing
  pattern in `translate.ts` — AI result falls back to a heuristic on any failure; the
  SLM would slot in as a candidate ahead of Claude, not a replacement for the fallback
  chain).
- Once a candidate model is trained, introduce a feature-flag'd traffic split (e.g. a
  percentage of `translateLearningLog` calls routed to the SLM instead of Claude).
- Use the **correction rate** as the automatic quality signal: compare how often the
  SLM's suggestions get `edited` vs. `approved` unchanged, against Claude's existing
  rate on the same slice of traffic. Promote only if the SLM's correction rate is
  competitive.
