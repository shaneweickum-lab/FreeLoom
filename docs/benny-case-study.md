# Building Benny: an in-house SLM, from scratch — case study log

This is the narrative companion to [`docs/slm-strategy.md`](./slm-strategy.md) (the
technical design doc — architecture, math, full rationale for every decision) and
[`ml/RESULTS.md`](../ml/RESULTS.md) (the raw numbers — every real run's actual output).
This doc is the story: written for an outside reader, kept dated and honest (including
the mistakes and reversals), and structured so any section can be pulled directly into
a LinkedIn post or Substack article without much rewriting.

**Premise**: FreeLoom doesn't want to depend on a third-party API for Benny, its
in-app assistant. So the project is to train a genuinely custom small language model
(SLM) in-house — natively 1.58-bit (ternary weight) BitNet architecture, not a
distilled or post-hoc-quantized copy of someone else's model — and to document the
entire process publicly as a personal case study in becoming an SLM practitioner.

---

## Timeline

**2026-07-14 — Architecture chosen, scaffolding started.**
Settled on BitNet b1.58 (ternary `{-1, 0, +1}` weights, ~1.58 bits/parameter) over a
standard dense transformer, specifically because ternary weights make a 100B+-parameter
model plausible to *run* on consumer/prosumer hardware later — the entire long-term bet
this project is built on. Built the first scaffolding: a domain training corpus (60
hand-authored examples across 12 subject areas), a BPE tokenizer trainer, the
`BitLinear` ternary-quantization math (with numpy unit tests, verifiable without any
GPU), a model-config/param-count estimator, the MLX transformer implementation, a LoRA
adapter module, dataset prep, training loops for both the base model and adapters, and
an eval harness. Originally sized at 60M parameters.

**2026-07-20 — Resized to ~75M params, real base-pretraining corpus added.**
Retrained the tokenizer at a real 8,000-token production vocabulary (up from 1,477,
which was only ever sized for the tiny 76-example proof-of-concept corpus). Widened the
model to ~75M parameters to match. Pulled in a real base-pretraining corpus — TinyStories
(`roneneldan/TinyStories`) + FineWeb-Edu (`HuggingFaceFW/fineweb-edu`) — instead of
training the base model on FreeLoom's own tiny domain corpus alone, since general
English competence has to come from somewhere before domain-specific vocabulary is
layered on top.

**2026-07-21 — First real hardware run, and the first real reversal.**
This is the most useful entry in this whole log for anyone else attempting this: the
~75M-param config measured **~305 tokens/sec** on the actual training hardware (M5
MacBook, MLX + `mx.compile`), which projected to **~84 days** for a single epoch of its
own token budget. Untenable. Root cause, confirmed on real hardware rather than assumed:
native BitNet quantization-aware training (QAT) is *compute-heavier per step* than a
plain dense model the same size, because every `BitLinear` forward pass has to
re-quantize its full-precision shadow weights via the straight-through estimator, on top
of an otherwise-ordinary matmul. BitNet's famous speed/memory win only exists at
*inference* time, with truly packed low-bit weights — not during training. This is a
genuinely underappreciated point worth its own post: **"BitNet trains slower than it
runs — here's why, measured on real hardware."**

The fix: shrink the model to ~13.7M parameters (384 d_model, 6 layers, 6 heads).
Shrinking compounds two savings at once — less compute per token *and* a smaller
token budget to match (the two scale together) — projecting the same epoch down from
~84 days to roughly 2–4 days. Same day: discovered TinyStories' real `train` split only
holds ~475M unique tokens (not the 1.75B originally targeted — a real ceiling on the
dataset itself, not a bug), fixed by repeating it 4 epochs to approximate the original
target, following the same precedent the original TinyStories paper itself used.
Real eval milestone: scaled the entry-drafting adapter's synthetic training data from 60
to 2,060 examples and re-ran fine-tuning — **206/207 (99.5%) format-valid** on the full
held-out set, up from a much smaller, noisier n=7 test before the scale-up. Also
generated real synthetic training data for two more adapters (`kb_authoring`,
`platform_help`) via real `claude-sonnet-5` API runs — see `ml/RESULTS.md` for the exact
costs and volumes.

**2026-07-22 — The tokens-per-parameter question, and a deliberate overtraining bump.**
Went looking for a specific claimed number — "~55 tokens/parameter" — from memory, and
research-checked it against the actual literature. Finding, worth its own post
("**There's no Chinchilla for ternary models — yet**"): the famous ~20 tokens/parameter
compute-optimal ratio (Hoffmann et al., "Chinchilla," 2022) has never been re-derived
specifically for 1.58-bit ternary weights. Microsoft's own flagship BitNet b1.58 2B4T
model trained a 2B-parameter model on 4 trillion tokens — a ~2,000:1 ratio, two orders
of magnitude past Chinchilla — because for a model meant to be deployed cheaply,
inference cost dominates training cost, so deliberately overtraining a small model past
compute-optimal is a well-precedented trade (same logic LLaMA used). Separately, Kumar
et al.'s "Scaling Laws for Precision" (ICLR 2025) found something genuinely
counterintuitive: at low precision, there's a *ceiling* — past a critical data volume for
a given (low) precision and model size, additional pretraining data can actively *hurt*
rather than help, because the model has saturated the capacity its bit-width can hold.
Their fitted models only went up to 1.7B params / 26B tokens, nowhere near ternary's
extremity — so the real curve for ternary architectures at any serious scale is
genuinely unmapped territory. **This is the open research question this project intends
to attack directly, empirically, using our own eval harness** — not borrow someone
else's constant, derive our own.

Decision made and implemented in code (not just discussed): bumped
`TRAIN_TOKENS_PER_PARAM` from 30 (Chinchilla's 20 + a modest +10 margin) to **56**
(landing at ~766.6M tokens for the current ~13.7M-param config) — a deliberate,
more aggressive overtraining push, on the reasoning that this base model is unusually
small and the TinyStories/FineWeb-Edu corpus makes extra tokens cheap relative to the
quality upside. See `ml/model/config.py` for the constant and `ml/RESULTS.md` for what
actually happens once a real run trains at this ratio.

**2026-07-22 — First base model pretraining run completes.**
`train/train_base.py`'s full run (not `--tiny`) finished: **train_loss 2.5515, val_loss
2.2834** after one epoch, ~765M tokens processed against the ~766.6M-token budget the
56:1 ratio called for — matching almost exactly. Val loss landing *below* train loss is
a healthy sign at this size/budget, not a fluke of a single epoch. ~10.3 hours
wall-clock on the M5 MacBook, ~20,600 tokens/sec sustained the whole run — see
`ml/RESULTS.md` for the full entry.

Worth noting for anyone reading this as a training-recipe reference: this run used
*no* learning-rate warmup or decay schedule, and *no* gradient clipping — just a flat
AdamW learning rate the entire epoch. The loss curve was smooth and monotonically
decreasing throughout regardless, no spikes. That doesn't mean those techniques are
unnecessary in general (most published BitNet training recipes use both, specifically
because the straight-through estimator's gradient through the ternary rounding step is
noisier than a normal forward pass), just that this particular run — this size, this
budget, this data — didn't need them to stay stable. Whether that holds at the next
size up is an open question, not an assumption.

Checkpoint saved to `checkpoints/base.safetensors`. Next: fine-tune the `kb_authoring`
and `platform_help` adapters against this real trained base (their synthetic training
data already exists — see `ml/RESULTS.md`'s synthetic-data-generation section).
`entry_drafting`'s 99.5% result was measured before this checkpoint existed, so it's
worth re-running against the real pretrained base too, to confirm the number holds.

**2026-07-22 — A real bug in the synthetic-data pipeline, caught before it cost
anything.** Running `prepare_dataset.py` to pack the `kb_authoring`/`platform_help`
adapter data crashed with `KeyError: 'rationale'` — one of the 660 generated
`kb_authoring` clusters was missing a field the tool schema itself marks `required`.
Root cause, worth remembering for anyone building a synthetic-data pipeline on top of
forced tool calls: `tool_choice` forcing the model to call a specific tool guarantees
*a* call happens, not that every field the schema calls required actually gets
populated. None of the three `generate_*_synthetic.py` scripts checked for that before
writing a row to disk.

Fixed in two places rather than one: `prepare_dataset.py`'s three packing functions now
skip (and count) a malformed row instead of crashing the whole run — which is what
actually unblocked training on the already-generated, already-paid-for data without
spending anything to regenerate it — and all three generator scripts now validate a
response against its own required-fields list before writing, so a future run doesn't
persist the same kind of incomplete row in the first place. Also added
`--skip-base` to `prepare_dataset.py`, since re-packing the full multi-million-text base
corpus just to pick up two adapters' worth of newly-generated data would have wasted
hours re-doing already-correct work.

Once unblocked: **`kb_authoring` adapter fine-tuned for the first time**, against the
real pretrained base. val_loss dropped every single epoch, 2.3982 → 1.2486 over 10
epochs (~150s total), with no overfitting uptick at all — unlike `entry_drafting`'s run,
this one hadn't plateaued yet by the last epoch, meaning 1.2486 is probably not this
adapter's real ceiling. Worth a re-run at more epochs before treating that number as
final. `platform_help` fine-tuning is running next.

**`platform_help` adapter fine-tuned** — same base checkpoint, same day. A visibly
different curve shape than `kb_authoring`: train_loss dropped smoothly the entire run
(1.4865 → 0.2249), but val_loss fell sharply only through epoch 5 (0.5988 → 0.3525),
then plateaued with small noise (a slight uptick at epochs 6 and 9) before landing at
its lowest point, 0.3331, at epoch 10. Train loss still falling while val loss holds
roughly flat is the early signature of overfitting starting to set in, even though val
hasn't turned upward in a clear trend yet — worth watching if this adapter gets
retrained with more data or more epochs, unlike `kb_authoring`'s run, which was still
cleanly improving. All three adapters now have a real fine-tuning result against the
actual pretrained base — see `ml/RESULTS.md` for the full numbers on each.

---

## The long-term vision (the part worth telling as a story on its own)

The honest, staged goal, not a single leap: keep a competent Benny in production
*continuously* while a bigger one trains in the background, then swap it in and start
the next size up — never blocking users on a single big training run, and never
shipping a model that hasn't been measured against the last one on a fixed eval
harness first. The "dream machine" for the far end of this staircase: a
deskside AI supercomputer (MSI XpertStation WS300-class — NVIDIA GB300 Grace Blackwell
Ultra, 20 petaFLOPS, 748GB unified memory) capable of running a 100B-parameter *ternary*
Benny at ~20GB of weights thanks to 1.58-bit quantization — the same property that makes
ternary weights compelling in the first place. Getting there for real means: a
versioned model-promotion convention, a fixed eval bar every new size has to clear
before it replaces the current one in production, and base-corpus scale growing in
lockstep with parameter count at every step — not scaling one and not the other.

---

## Notes for turning this into posts

- Each dated entry above is close to publish-ready as a standalone post; the *reversal*
  entry (2026-07-21, the ~84-day discovery) and the *scaling-law* entry (2026-07-22) are
  the two with the most inherent narrative tension ("we built it, then discovered it
  couldn't actually train — here's the fix" / "the number I remembered wasn't real —
  here's what the literature actually says").
- Real numbers only — every cost, ratio, and eval score above is pulled from an actual
  commit, an actual API run's logged cost, or an actual measured throughput on real
  hardware, never estimated for effect. Keep that discipline as this doc grows; it's the
  entire credibility of an "SLM expertise" case study.
- Update this doc at the same time as `ml/RESULTS.md` — this one gets the story, that
  one gets the numbers backing it up.
