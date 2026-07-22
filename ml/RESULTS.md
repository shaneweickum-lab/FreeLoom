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

### base pretraining — 2026-07-22
- Config: ~13.7M-param BitNetTransformer (`BASE_CONFIG`), 56 tokens/param budget
  (~766.6M tokens), M5 MacBook
- Data: full packed base corpus (`base_train.npy`/`base_val.npy`), one epoch
- Result: train_loss 2.5515, val_loss 2.2834 at epoch end — val below train, no sign
  of overfitting at this size/budget. Loss curve was smooth and monotonically
  decreasing the whole run (2.63 → 2.55 over the final ~6,000 batches shown), no spikes
  despite no LR warmup/schedule or gradient clipping in the training loop.
- Wall-clock: 37,137s (~10.3 hours) for the full epoch, ~20,600 tok/s sustained
  throughput (~765M tokens processed, matching the configured budget almost exactly).
- Notes: checkpoint saved to `checkpoints/base.safetensors`. First real base-model
  result — adapter fine-tuning (entry_drafting already separately validated at 99.5%
  against random-init weights; kb_authoring/platform_help still pending) is the next
  step, now against an actually-pretrained base instead of random init.

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

### kb_authoring — 2026-07-22
- Config: real pretrained base (`checkpoints/base.safetensors`, see base-pretraining
  section above) + LoRA (rank 8, alpha 16), M5 MacBook, default 10 epochs/batch-size
  8/lr 1e-3
- Data: 350 train / 38 val synthetic (word-dump cluster → drafted knowledge-base
  entry) examples — 660 generated clusters minus 267 dropped for exceeding
  `max_len=512` and 5 skipped for a missing required field (see
  `docs/benny-case-study.md`/commit history for that bug and its fix)
- Result: val_loss 2.3982 → 1.2486 across all 10 epochs, decreasing every single
  epoch with no overfitting uptick at all — unlike entry_drafting's run, val_loss was
  still clearly improving at the final epoch, not past its optimum yet.
- Wall-clock: ~15s/epoch, ~150s total
- Notes: since val_loss hadn't plateaued, this run is likely undertrained rather than
  at its real optimum — worth a re-run with more epochs (e.g. `--epochs 20`) to see
  where it actually levels off, before treating 1.2486 as this adapter's ceiling.

### platform_help — 2026-07-22
- Config: real pretrained base (`checkpoints/base.safetensors`) + LoRA (rank 8, alpha
  16), M5 MacBook, default 10 epochs/batch-size 8/lr 1e-3
- Data: 1,246 train / 138 val (hand-authored seed + paraphrased variants) examples
- Result: train_loss decreased smoothly and monotonically the whole run (1.4865 →
  0.2249). val_loss dropped sharply through epoch 5 (0.5988 → 0.3525), then plateaued
  with small noise (upticking slightly at epochs 6 and 9) before landing at its lowest
  point, 0.3331, at epoch 10 -- a different shape than kb_authoring's clean monotonic
  curve: this one looks converged/plateaued rather than still clearly improving, with
  train_loss continuing to drop while val holds roughly flat being the early signature
  of overfitting starting, even though val hasn't turned upward in a clear trend yet.
- Wall-clock: ~55s/epoch, ~550s total
- Notes: saved checkpoint's own log line said "later epochs overfit and were
  discarded," which was printed by the pre-fix version of train_adapter.py (see the
  kb_authoring entry above) and isn't a reliable description of what actually happened
  here -- go by the epoch-by-epoch numbers above, not that message.

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
