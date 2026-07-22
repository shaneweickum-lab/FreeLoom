# Benny — real run results log

Raw numbers only, append-only, most recent first within each section. This is the
receipts backing [`docs/benny-case-study.md`](../docs/benny-case-study.md)'s narrative —
every entry here should be copy-pasteable into a post without needing to round up or
soften anything. Never record a projected/estimated number here; those belong in
`docs/slm-strategy.md`'s design rationale instead. If a number here isn't from an actual
completed run, it doesn't belong in this file yet.

**Entry template** (copy this for each new real run):
```
### <task/model> — <date>
- Config: <params, tokens/param ratio, hardware>
- Data: <corpus/dataset size actually used>
- Result: <loss curve / eval score / throughput — whatever's measurable>
- Wall-clock: <actual time>
- Cost: <if a paid API was involved>
- Notes: <anything a reader would need to interpret the number correctly>
```

---

## Base model pretraining

**Status: pending.** No real base-pretraining run has completed yet as of 2026-07-22 —
`train/prepare_dataset.py` is packing the corpus on the Mac now; `train/train_base.py`'s
full run (56 tokens/param, ~766.6M tokens, ~13.7M params) hasn't been executed. This
section gets its first real entry the moment that run finishes: train/val loss curve,
tokens/sec throughput, actual wall-clock time, and the resulting checkpoint's size.

## Adapter fine-tuning

### entry_drafting — 2026-07-21
- Config: ~13.7M-param frozen base + LoRA (rank 8, alpha 16), M5 MacBook
- Data: 2,060 synthetic (activity → course_title/subject_area/credit_value/rationale)
  examples, scaled up from an original 60
- Result: val_loss 2.2611 → 1.9584 across 9 epochs, smooth and near-monotonic (only a
  trivial uptick at epoch 10) — no longer the sharp overfitting spike seen at the old
  60-example scale. Scored **206/207 (99.5%) format-valid** on the full held-out set via
  `eval/run_eval.py` — the one failure is an unparseable generation, the same category
  as before but far rarer at this data volume.
- Notes: statistically meaningful for the first time (n=207 vs. the old n=7, where one
  example flipping swung the score by ~14 points).

### kb_authoring — pending
No real fine-tuning run yet — synthetic training data exists (see below) but the
adapter hasn't been trained on it.

### platform_help — pending
No real fine-tuning run yet — synthetic training data exists (see below) but the
adapter hasn't been trained on it.

## Synthetic data generation (real, paid API runs)

### entry_drafting corpus — `data/generate_synthetic.py`
- Model: `claude-sonnet-5`
- Result: 2,000/2,000 examples generated successfully
- Cost: ~$15.86

### kb_authoring bootstrap — `data/generate_kb_authoring_synthetic.py`
- Model: `claude-sonnet-5`, two runs (first stopped early at 160/500 on an exhausted API
  credit balance — not a cost cap or bug — second finished clean at 500/500 after
  topping up credits)
- Result: **660 clusters** total (3 word dumps → 1 drafted knowledge-base entry each)
- Cost: ~$7.21 total across both runs

### platform_help paraphrases — `data/generate_platform_help_synthetic.py`
- Model: `claude-sonnet-5`, two runs (same credit-exhaustion-then-top-up pattern as
  kb_authoring)
- Result: **1,360 paraphrased variants** + 24 hand-authored seed examples = **1,384
  total**
- Cost: ~$5.10 total across both runs
