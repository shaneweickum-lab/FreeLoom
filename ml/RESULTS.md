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

### entry_drafting — eval regression, 2026-07-22
Re-ran `eval/run_eval.py` against the *current* `checkpoints/base.safetensors` (the
real pretrained base that finished 2026-07-22) using the existing
`entry_drafting_adapter.safetensors` from 2026-07-21's fine-tuning run below. Result:
**0/207 (0.0%) format-valid** — every single generation failed to parse, a total
collapse from the 99.5% originally measured.

Diagnosis (not yet independently confirmed by a controlled test, but the only
explanation consistent with `kb_authoring`/`platform_help` scoring normally against
this same current base): `entry_drafting`'s adapter was fine-tuned on 2026-07-21
against *whatever* `base.safetensors` existed at that time — necessarily a different,
earlier checkpoint than the one saved by 2026-07-22's full pretraining run, since that
run overwrites the same filename. A LoRA adapter's low-rank matrices are fit as a
correction on top of one specific set of base weights; swapping in a same-shaped but
differently-trained base underneath it doesn't error (no shape mismatch — architecture
is unchanged) but produces the adapter composing with weights it was never actually
fit against, i.e. noise. `kb_authoring` and `platform_help` were both fine-tuned
*today*, after the current base finished, which is why they don't show this problem.
- **Action needed**: re-run `train_adapter.py --task entry_drafting --base-checkpoint
  ../checkpoints/base.safetensors` to retrain fresh against the current base, then
  re-eval, before trusting any entry_drafting number going forward.
- **Lesson for the process**: a LoRA checkpoint is only valid paired with the exact
  base checkpoint it was trained against — the two need to be versioned/tracked
  together, not treated as independently reusable artifacts. Worth enforcing later
  (e.g. embedding a hash of the base checkpoint into the adapter's saved file), not
  just remembered.

### entry_drafting — retrained against current base, 2026-07-22
- Config: real pretrained base (`checkpoints/base.safetensors`) + LoRA (rank 8, alpha
  16), M5 MacBook, default 10 epochs/batch-size 8/lr 1e-3 — same data as the
  2026-07-21 run below (1,866 train / 207 val), just fine-tuned fresh against the
  current base checkpoint instead of the stale one behind the eval-regression entry
  above
- Result: val_loss 2.4120 → 1.9354 across all 10 epochs, decreasing every epoch, still
  trending down at the final epoch (same "not yet at its ceiling" pattern as
  kb_authoring's run) — a healthy curve, unlike the 0% collapse that motivated this
  retrain
- Wall-clock: ~80.6s/epoch, ~806s total
- Eval: **207/207 (100%) format-valid** via `eval/run_eval.py` against this new
  checkpoint -- confirms the diagnosis in the eval-regression entry above: the
  0% collapse was the stale base/adapter pairing, not a real regression in the
  adapter or the pipeline. Even slightly better than the original 99.5%.

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
- Eval: **38/38 (100%) format-valid** via `eval/run_eval_kb_authoring.py` against this
  same adapter/base pairing (trained and evaluated the same day, unlike entry_drafting
  above) — small sample (n=38) so treat as encouraging, not conclusive.

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

## Serving (real, live-traffic runs)

### inference_server.py attached to deployed FreeLoom — 2026-07-22
- Config: `ml/serve/inference_server.py` (FastAPI/uvicorn) on the M5 MacBook, both
  `entry_drafting` and `platform_help` adapters loaded against the current base;
  exposed via a Cloudflare Tunnel quick-tunnel; Vercel env vars
  (`SLM_ENTRY_DRAFTING_URL`, `SLM_CHAT_URL`, `SLM_SHARED_SECRET`) pointed at it
- Result: `POST /entry-draft` confirmed working end-to-end on the first real attempt --
  a genuine word dump ("Spent an afternoon learning to solder a broken guitar pedal
  circuit board.") produced a correctly-parsed, correctly-displayed draft (Music /
  Applied Music Studies / 0.10cr) in the Learning Log UI. `POST /chat` failed on every
  attempt with a generic client-side "having trouble" reply.
- Bug found: `RuntimeError: There is no Stream(cpu, 1) in current thread` on the
  `/chat` route only. Root cause -- both routes were plain `def` handlers, which
  FastAPI/Starlette offloads to a worker-thread pool (`run_in_threadpool`) rather than
  running on the main thread; MLX's array/stream context is thread-local and is only
  reliably set up on the thread the models were loaded on (main, at server startup).
  `/entry-draft` happened to land on an already-initialized worker thread on its first
  real test; `/chat`'s `platform_help` model had never run inference on any thread
  before that request and landed on one MLX had never touched.
- Fix: changed both `entry_draft` and `chat` route handlers from `def` to `async def`,
  which makes FastAPI call them directly on the event-loop thread (the same one
  `Models(...)` was constructed on at startup) instead of offloading to the thread
  pool -- removes the thread-choice variable entirely rather than working around one
  specific unlucky thread pick.
- Notes: `/entry-draft`'s earlier success was luck, not a guarantee -- this fix applies
  to both routes, not just the one that happened to surface the bug first.

### in-process TS port replaces the Mac-hosted HTTP server — 2026-07-22
- Config: `ml/serve/export_web_weights.py` (pure numpy, no MLX) dequantizes every
  BitLinear projection's ternary shadow weight into a fixed dense matrix and copies
  each adapter's LoRA A/B matrices through unchanged; `src/lib/benny/inference/` is a
  from-scratch TypeScript port of `transformer_mlx.py`'s forward pass reading that
  output directly inside FreeLoom's own Next.js server -- no Mac, tunnel, or shared
  secret involved anymore (see `ml/serve/inference_server.py`, now legacy/optional)
- Why: the Mac + Cloudflare Tunnel setup meant Benny only worked while a specific
  laptop stayed on, awake, and tunneled -- not viable for "all to use"
- Naive port risk found before it shipped: recomputing the full sequence from scratch
  every generation step (matching the Python reference, cheap on MLX's GPU) was
  estimated at ~250 seconds for a single 200-token chat reply in plain JS -- added a
  per-layer KV cache (`math.ts`'s `LayerCache`) so each step only processes the new
  token, mathematically identical output, ~40-50x less total work
- Validated with `ml/serve/verify_web_port.py` (independent pure-numpy reference,
  same exported weights): with deterministic random (untrained) weights, first-step
  logits matched to ~3-4 significant figures (top-5 token ids identical, values
  differing only in the 3rd decimal place) -- consistent with expected float32
  (numpy/real hardware) vs. JS's inherent float64 arithmetic, not a logic bug. A
  15-token greedy generation matched token-for-token for the first 11 steps before
  diverging, exactly the pattern expected when untrained weights have no confidently-
  separated top logit for an accumulated rounding difference to eventually flip
- Measured end-to-end (random weights, smoke test): draftEntry() (120 tokens) ~3.7s,
  chatReply() (200 tokens) ~5.1s -- well within a serverless function's time budget
- Real trained-weight parity check and live Vercel deployment: pending (needs the
  actual base.safetensors/adapter files exported and bundled, on the Mac)

### stale committed tokenizer.json + a real greedy-decoding repetition loop — 2026-07-22
- First real-weight test surfaced two distinct issues once weights were actually bundled:
  1. Every generated token decoded as `<unk>`. Root cause: `ml/tokenizer/tokenizer.json`
     committed to git was the **old 1,477-vocab tokenizer** — the real, retrained
     8,000-vocab one (`model/config.py`'s own comment already documented this as the
     expected file) only ever existed locally on the Mac. Every Python script
     (train/eval/`inference_server.py`) read that correct local file directly, so this
     never surfaced until the TS port bundled whatever was actually committed. Fixed by
     committing the real 8,000-vocab file.
  2. With the tokenizer fixed, `platform_help` got stuck repeating a single token
     ("Every", id 3779) for an entire generation on "where do I get help with
     freeloom?". Confirmed as genuine model behavior, not a port bug: `verify_web_port.py`
     (full recompute every step, no KV cache at all) landed on the *exact same* stuck
     token as `model.ts`'s KV-cached generate() -- mathematically, causal attention
     guarantees these two approaches produce identical output, so agreement here rules
     out a caching bug. Greedy decoding (always the single most-likely token) is a
     known-generally failure mode for repetition loops, more likely on a smaller model
     given an out-of-training-distribution question.
- Fix: added `MAX_CONSECUTIVE_REPEATS = 3` -- stop generation once a token has repeated
  3 times in a row, rather than repeating for the rest of `max_new_tokens`. Applied to
  `model.ts`, `verify_web_port.py`, and `inference_server.py`'s `generate()` loops
  (kept in sync); deliberately **not** applied to `run_eval.py`/
  `run_eval_platform_help.py`, since those need to keep measuring raw greedy-decoding
  behavior unchanged for eval numbers to stay comparable across retrains.
- Confirmed live in the deployed app after both fixes: the same repetition-prone
  question now stops at 2 repeated tokens ("EveryEvery") instead of running to
  `max_new_tokens`, and a second out-of-distribution question got the honest "I'm not
  sure how to answer that one yet" fallback instead of broken output. Both Benny chat
  and Stage 4 entry-drafting now run entirely inside the Vercel deployment -- no Mac,
  tunnel, or shared secret involved at request time.
- A third, smaller issue surfaced immediately after: a reply rendered as a lone
  replacement-character glyph (`�`) followed by stray punctuation. Root cause: the
  byte-level BPE decoder (`@huggingface/tokenizers`'s `TextDecoder("utf-8", {fatal:
  false})`) substitutes U+FFFD for any incomplete/invalid UTF-8 byte sequence --
  generation stopping (the new repetition guard, or just hitting `max_new_tokens`)
  partway through a multi-byte character's constituent tokens produces exactly that.
  Never legitimate model output, so `model.ts`/`inference_server.py` now strip any
  `�` from the final decoded text before returning it.

### the real bug: lm_head_weight silently diverges from token_emb during training — 2026-07-23
- Symptom, after both fixes above landed on the correct branch: the deployed app and
  `verify_web_port.py` (numpy, real weights) both produced the exact same degenerate
  single token from the very first prediction, for every prompt -- including a
  question copied verbatim from the platform_help training data.
- Isolating step: ran the *real* MLX model directly (`inference_server.py`, bypassing
  export/numpy entirely) for that same verbatim training question. It produced a
  correct, coherent, near-exact match to the real answer -- proving the checkpoints
  and tokenizer were both fine, and the bug was specific to the export/port path.
- Root cause: `transformer_mlx.py`'s `self.lm_head_weight = self.token_emb.weight`
  only aliases the two arrays at construction time. MLX's parameter tree treats them
  as independent leaves by attribute path, so each accumulates its own gradient
  during training (the embedding *lookup* usage vs. the final output-*projection*
  usage) and they drift apart over the course of training despite the "tied
  embeddings" framing in the code's own comment. Confirmed directly on the real
  checkpoint: `token_emb.weight` and `lm_head_weight` differ by up to 0.56 in
  absolute value -- nowhere near identical.
- `export_web_weights.py` never captured `lm_head_weight` as its own tensor, so
  every port (the TS runtime, the numpy reference) ran the final output projection
  against `token_emb.weight` instead -- the wrong matrix, from the very first
  generated token, on every single prompt.
- Fix: export `lm_head_weight` as its own tensor; `model.ts`/`verify_web_port.py`
  now use it (not `token_emb.weight`) for the final projection. Verified the
  plumbing with synthetic checkpoints using a deliberately different
  `lm_head_weight` -- loads and runs correctly.
- Confirmed with a fresh real export: `verify_web_port.py` on "What is FreeLoom?"
  now produces "answer: FreeLoom is a record-keeping app made for homeschooling,
  unschooling, and wildschooling families. You just describe in plain, everyday
  language what your kid did, and FreeLoom converts that description into a class
  entry that..." -- a near-exact match to the real MLX model's own output for the
  same question. Bug fully resolved.

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
