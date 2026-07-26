"""
Pretrains the shared BitNetTransformer base on the packed sequences from
prepare_dataset.py's base_train.npy/base_val.npy.

MLX-only -- cannot run in this Linux container (confirmed: the mlx pip
wheel installs on Linux but its shared library, libmlx.so, is Apple/Metal
-only). Write/review here, run on the M5 MacBook per
docs/slm-strategy.md Section 5.

Follows that section's plan directly: run --tiny first (a small model on
the current small dataset) to confirm the tokenizer, data loading,
BitLinear layer, and loss curve all behave sanely in minutes, before
committing to a longer run at the full config.py sizing once the corpus
has scaled into the thousands of examples.

Usage (on the Mac, after `pip install -r ../../requirements.txt` and
running prepare_dataset.py):
    python3 train_base.py --tiny                 # pipeline sanity check
    python3 train_base.py                        # full-config run (Sophia, v0.7 default)
    python3 train_base.py --optimizer adamw      # fall back to v0.6's optimizer
    python3 train_base.py --resume base_ckpt.safetensors

A full run saves 5 checkpoints evenly spaced across the whole run by default
(--num-checkpoints), not just one at the end -- a multi-day single process
with no intermediate save loses everything on a crash/interruption. Each
mid-run save also overwrites the canonical base.safetensors, so --resume
always has a recent checkpoint to load.

v0.7 trains with Sophia (model/sophia.py) instead of AdamW by default --
see that module's docstring for the paper citation and why it needs a
second, periodic update path (update_hessian(), called every
--sophia-hessian-interval steps here) that AdamW/plain optimizers don't.
--optimizer adamw is kept as a one-flag fallback in case Sophia misbehaves
on the first real run, since none of this has run on real MLX yet.

Every --diagnostic-every-steps batches (default 500), prints a val_loss
reading (on a small FIXED held-out subsample, so readings are comparable
across the run) plus a short greedy-decoded text sample from the current
weights -- a running, human-readable record of val_loss and language
quality over a run that can span days, not just a single number at the
very end. This came directly out of a real v0.6 run: 22 hours in, train
loss reversed and started climbing (no LR schedule exists yet -- see
docs/slm-strategy.md Section 5 -- so this is the most likely cause), and
there was no val_loss data anywhere near that point to tell overfitting
apart from an LR/stability issue. NOT literally every single step -- a
full val pass every step would be a real, unnecessary cost; tying both
prints to one periodic cadence is the practical middle ground.
"""

import argparse
import sys
import time
from dataclasses import replace
from functools import partial
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np
from mlx.utils import tree_map
from tokenizers import Tokenizer

sys.path.insert(0, str(Path(__file__).parent.parent / "model"))
from config import BASE_CONFIG, ModelConfig, estimate_param_count, estimate_token_budget  # noqa: E402
from sophia import SophiaG  # noqa: E402
from transformer_mlx import BitNetTransformer  # noqa: E402

DATA_DIR = Path(__file__).parent.parent / "data" / "prepared"
CKPT_DIR = Path(__file__).parent.parent / "checkpoints"
TOKENIZER_PATH = Path(__file__).parent.parent / "tokenizer" / "tokenizer.json"

# A deliberately small config for --tiny: fast enough to sanity-check the
# whole pipeline (tokenizer, data loading, BitLinear, loss curve) in
# minutes rather than committing to the full BASE_CONFIG run untested.
TINY_CONFIG = ModelConfig(d_model=128, n_layers=2, n_heads=4, max_seq_len=512)


def loss_fn(model: BitNetTransformer, inputs: mx.array, targets: mx.array) -> mx.array:
    logits = model(inputs)
    return nn.losses.cross_entropy(logits.reshape(-1, logits.shape[-1]), targets.reshape(-1), reduction="mean")


def resampled_loss_fn(model: BitNetTransformer, inputs: mx.array) -> mx.array:
    """Sophia's Gauss-Newton-Bartlett Hessian estimator (model/sophia.py's
    docstring has the full reasoning): loss against a label RESAMPLED from
    the model's own predicted distribution at each position, not the real
    target -- `targets` never enters this function at all. Sum (not mean)
    reduction, since the estimator's derivation scales with the per-example
    loss sum; gnb_hessian_estimate() below divides back out by batch size."""
    logits = model(inputs)
    flat_logits = logits.reshape(-1, logits.shape[-1])
    resampled_labels = mx.random.categorical(flat_logits)
    return nn.losses.cross_entropy(flat_logits, resampled_labels, reduction="sum")


def gnb_hessian_estimate(hessian_loss_and_grad, model: BitNetTransformer, inputs: mx.array):
    """One Gauss-Newton-Bartlett Hessian-diagonal estimate: an extra
    forward+backward pass on `inputs` (the same batch already used for
    this step's real update) against resampled_loss_fn's resampled labels,
    squaring the resulting gradient per parameter. Call this every
    --sophia-hessian-interval steps, not every step -- see model/sophia.py's
    SophiaG.update_hessian() docstring."""
    _, grads = hessian_loss_and_grad(model, inputs)
    batch_size = inputs.shape[0]
    return tree_map(lambda g: (g * g) / batch_size, grads)


def iterate_batches(sequences: np.ndarray, batch_size: int, rng: np.random.Generator, chunk_size: int = None):
    """Shuffles in contiguous chunks rather than one full random permutation
    over the whole array. A full permutation forces every batch to gather
    scattered, non-contiguous rows -- fine for a small array fully resident
    in RAM, but brutal once `sequences` is memory-mapped (or just large
    enough to create real memory pressure): every batch turns into a
    scattered-read/page-fault storm instead of one sequential read per
    chunk. Chunk order is randomized and each chunk is shuffled internally,
    so batches are still well-mixed across an epoch -- just not gathered
    from arbitrary points across the entire corpus on every single step."""
    n = len(sequences)
    chunk_size = chunk_size or max(batch_size * 64, batch_size)
    chunk_starts = list(range(0, n, chunk_size))
    rng.shuffle(chunk_starts)
    for chunk_start in chunk_starts:
        chunk_end = min(chunk_start + chunk_size, n)
        chunk = np.array(sequences[chunk_start:chunk_end])  # one contiguous read, materializes out of any mmap
        order = rng.permutation(len(chunk))
        for start in range(0, len(order) - batch_size + 1, batch_size):
            idx = order[start: start + batch_size]
            batch = mx.array(chunk[idx])
            yield batch[:, :-1], batch[:, 1:]


def format_duration(seconds: float) -> str:
    """Human-readable duration for ETAs -- "45s", "12m 3s", "2h 14m", "3d 5h"."""
    seconds = int(max(0, seconds))
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, secs = divmod(rem, 60)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


def evaluate(model: BitNetTransformer, sequences: np.ndarray, batch_size: int) -> float:
    if len(sequences) == 0:
        return float("nan")
    rng = np.random.default_rng(0)
    losses = []
    for inputs, targets in iterate_batches(sequences, min(batch_size, len(sequences)), rng):
        losses.append(float(loss_fn(model, inputs, targets)))
    return sum(losses) / max(len(losses), 1)


def generate_sample(model: BitNetTransformer, tokenizer: Tokenizer, bos_id: int,
                     eos_id: int | None, max_new_tokens: int) -> str:
    """Greedy-decodes a short completion from the CURRENT (mid-training)
    weights, seeded with just <bos> -- a base model, not yet adapter-tuned,
    has no prompt/instruction to answer, so this is free-form continuation,
    not a question/answer. Same one-token-at-a-time loop as eval/run_eval.py's
    generate(), called eagerly (not through train_step's compiled graph) --
    this exists purely as a documentary, human-readable checkpoint of how
    Benny's language looks at this point in training, not a metric anything
    downstream reads. Not batched and not the full held-out eval -- fine,
    since --diagnostic-every-steps callers only need one short sample."""
    ids = [bos_id]
    for _ in range(max_new_tokens):
        window = ids[-model.cfg.max_seq_len:]
        logits = model(mx.array([window]))
        next_id = int(mx.argmax(logits[0, -1]))
        ids.append(next_id)
        if eos_id is not None and next_id == eos_id:
            break
    return tokenizer.decode(ids[1:])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tiny", action="store_true", help="use TINY_CONFIG for a fast pipeline sanity check")
    parser.add_argument("--epochs", type=int, default=None,
                         help="defaults to 20 for --tiny (many quick passes over a small subsample) or "
                              "1 for the full run -- base_train.npy already IS the full token budget "
                              "the corpus was packed for (see prepare_dataset.py's BASE_CORPUS_REPEATS "
                              "for the current TinyStories/FineWeb-Edu repeat counts), so one epoch over "
                              "it hits that budget exactly; each additional epoch here multiplies the "
                              "effective token count on top of that, not for free")
    parser.add_argument("--batch-size", type=int, default=16,
                         help="was 64 at v0.6's 512/7/8 (~26.1M param) config, real M5 runs measured "
                              "only ~829 tok/s -- a swap-triggering memory bottleneck confirmed by a "
                              "clean single-variable test (identical model, only batch size changed): "
                              "batch=64 gave ~829 tok/s, batch=16 gave ~15,200 tok/s on the same "
                              "hardware and same full corpus (ml/RESULTS.md, 2026-07-23). Bigger "
                              "batches don't reduce total FLOPs, and trade many small matmuls for "
                              "fewer, bigger ones -- normally a good trade for MLX/Metal throughput, "
                              "but only once the model's total activation/gradient memory at that "
                              "batch size actually fits without swapping. Raise this if you have "
                              "memory headroom to spare (more unified memory, or a smaller model); "
                              "lower it further if you still hit a memory error.")
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--optimizer", type=str, choices=["sophia", "adamw"], default="sophia",
                         help="Sophia (model/sophia.py) is v0.7's default -- a second-order optimizer "
                              "the paper reports converging in roughly half the steps AdamW needs at "
                              "comparable scale. Falls back to plain AdamW (v0.6's optimizer) with one "
                              "flag if Sophia misbehaves on the first real run -- none of this has run "
                              "on real MLX yet, see model/sophia.py's docstring.")
    parser.add_argument("--weight-decay", type=float, default=0.1,
                         help="decoupled weight decay, same meaning for both --optimizer choices. 0.1 "
                              "matches Sophia's own paper defaults for LM pretraining-scale runs.")
    parser.add_argument("--sophia-rho", type=float, default=0.04,
                         help="Sophia-only: the clipping-threshold hyperparameter in "
                              "model/sophia_math.py's clipped_update() -- the paper's own default.")
    parser.add_argument("--sophia-hessian-interval", type=int, default=10,
                         help="Sophia-only: recompute the Hessian diagonal estimate (an extra "
                              "forward+backward pass, model/train_base.py's gnb_hessian_estimate()) "
                              "every this-many steps rather than every step -- the paper's own k=10 "
                              "default, balancing a fresher estimate against the extra compute cost.")
    parser.add_argument("--eval-every", type=int, default=1)
    parser.add_argument("--resume", type=str, default=None)
    parser.add_argument("--heartbeat-seconds", type=float, default=20.0,
                         help="print an in-epoch progress line at least this often")
    parser.add_argument("--tiny-train-samples", type=int, default=2000,
                         help="--tiny also caps the DATA, not just the model -- otherwise a full "
                              "epoch over millions of real sequences takes hours even at TINY_CONFIG's "
                              "tiny model size, defeating the point of a fast sanity check")
    parser.add_argument("--tiny-val-samples", type=int, default=200)
    parser.add_argument("--target-tokens", type=int, default=None,
                         help="full run only -- caps train_sequences to roughly this many tokens "
                              "(defaults to cfg's own estimate_token_budget(), i.e. "
                              "TRAIN_TOKENS_PER_PARAM tokens/param from model/config.py). "
                              "base_train.npy holds however many tokens the corpus pipeline packed, "
                              "which can be far more than a given model's budget calls for -- training "
                              "extra tokens past that deliberate-overtraining target doesn't add "
                              "anything the ratio says is worth having, just wastes the same multiple "
                              "in wall-clock time.")
    parser.add_argument("--max-val-sequences", type=int, default=2000,
                         help="full run only -- val is just a generalization sanity check, doesn't "
                              "need every held-out sequence to be useful")
    parser.add_argument("--full-corpus", action="store_true",
                         help="skip the --target-tokens cap and train on every packed sequence "
                              "regardless of cfg's token budget")
    parser.add_argument("--diagnostic-every-steps", type=int, default=500,
                         help="every this many training steps (batches), print a val_loss reading and "
                              "a short greedy-decoded text sample from the current weights -- a running, "
                              "human-readable record of Benny's language sharpening over a multi-day run "
                              "(previously the only val_loss print was at the very end of the whole run, "
                              "so a long run gave zero visibility into whether/when it started overfitting "
                              "or destabilizing). NOT literally every step -- a full val pass is a real "
                              "cost to pay that often, so this reuses the same periodic cadence for both "
                              "the (cheap, fixed-subsample) val_loss check and the sample. Set to 0 to "
                              "disable both.")
    parser.add_argument("--diagnostic-val-sequences", type=int, default=256,
                         help="size of the FIXED held-out subsample --diagnostic-every-steps reads "
                              "val_loss from -- deliberately much smaller than --max-val-sequences (the "
                              "full end-of-epoch eval) since this one runs far more often. Fixed (same "
                              "sequences every time, chosen once before training starts) rather than "
                              "freshly resampled each check, so the printed numbers are actually "
                              "comparable to each other across the run instead of each reading being a "
                              "different random slice of val.")
    parser.add_argument("--sample-max-new-tokens", type=int, default=60,
                         help="length of the greedy-decoded text sample --diagnostic-every-steps prints")
    parser.add_argument("--num-checkpoints", type=int, default=5,
                         help="save this many checkpoints evenly spaced across the whole planned run "
                              "(in addition to the final save at the end), not just one at the very "
                              "end -- a full run can take hours to days in one process (see "
                              "docs/slm-strategy.md Section 5 for the current config's own estimate), "
                              "and a crash/interruption with no intermediate save loses all of it. "
                              "Each is saved as "
                              "base_checkpoint_<N>.safetensors (N = total batches done so far) AND "
                              "overwrites the canonical base.safetensors/base_tiny.safetensors path, "
                              "so --resume always has a recent one to load regardless of which "
                              "numbered file you'd reference. Set to 0 to disable and only save at "
                              "the end, matching the old behavior.")
    args = parser.parse_args()
    if args.epochs is None:
        args.epochs = 20 if args.tiny else 1

    cfg = TINY_CONFIG if args.tiny else BASE_CONFIG
    # mmap rather than a full eager load -- at v0.6's sizing, the token
    # budget covers essentially the entire packed corpus (~4.3M sequences,
    # ~8.85GB as plain int32), so this stays resident in RAM for the whole
    # run unless subsampled below. mmap keeps it disk-backed and paged in on
    # demand instead of forcing the whole thing into the M5's 24GB unified
    # memory up front; iterate_batches' chunked-shuffle access pattern below
    # is what actually makes that mmap cheap to read from during training.
    train_sequences = np.load(DATA_DIR / "base_train.npy", mmap_mode="r")
    val_sequences = np.load(DATA_DIR / "base_val.npy", mmap_mode="r")

    if args.tiny:
        tiny_rng = np.random.default_rng(0)
        if len(train_sequences) > args.tiny_train_samples:
            idx = tiny_rng.choice(len(train_sequences), size=args.tiny_train_samples, replace=False)
            train_sequences = train_sequences[idx]
        if len(val_sequences) > args.tiny_val_samples:
            idx = tiny_rng.choice(len(val_sequences), size=args.tiny_val_samples, replace=False)
            val_sequences = val_sequences[idx]
    elif not args.full_corpus and len(train_sequences) > 0:
        # The packed corpus can hold far more tokens than this cfg's own
        # deliberate-overtraining budget calls for (it was sized for whatever
        # model was configured at packing time, not necessarily this one) --
        # training every extra token past that target doesn't add anything the
        # ratio says is worth having, it just spends the same multiple in
        # wall-clock time for no benefit.
        target_tokens = args.target_tokens or estimate_token_budget(estimate_param_count(cfg))
        target_sequences = max(1, min(len(train_sequences), -(-target_tokens // train_sequences.shape[1])))
        if target_sequences < len(train_sequences):
            full_rng = np.random.default_rng(0)
            idx = full_rng.choice(len(train_sequences), size=target_sequences, replace=False)
            train_sequences = train_sequences[idx]
            print(f"Capped training data to {target_sequences:,} sequences "
                  f"(~{target_sequences * train_sequences.shape[1]:,} tokens) matching this config's "
                  f"~{target_tokens:,}-token budget -- pass --full-corpus to train on "
                  f"every packed sequence instead.")
        if len(val_sequences) > args.max_val_sequences:
            full_val_rng = np.random.default_rng(1)
            idx = full_val_rng.choice(len(val_sequences), size=args.max_val_sequences, replace=False)
            val_sequences = val_sequences[idx]

    # vocab_size in cfg must match the tokenizer actually used to build
    # these arrays -- prepare_dataset.py doesn't re-derive it, so mismatches
    # here mean the tokenizer was retrained without updating config.py.
    max_token = int(train_sequences.max())
    assert max_token < cfg.vocab_size, (
        f"token id {max_token} >= configured vocab_size {cfg.vocab_size}; "
        "update ModelConfig.vocab_size to match the current tokenizer.json"
    )

    model = BitNetTransformer(cfg)
    if args.resume:
        model.load_weights(args.resume)
    mx.eval(model.parameters())

    if args.optimizer == "sophia":
        optimizer = SophiaG(learning_rate=args.lr, rho=args.sophia_rho, weight_decay=args.weight_decay)
    else:
        optimizer = optim.AdamW(learning_rate=args.lr, weight_decay=args.weight_decay)
    loss_and_grad = nn.value_and_grad(model, loss_fn)
    # Only actually used for --optimizer sophia (gnb_hessian_estimate below),
    # but cheap to always create -- nn.value_and_grad just wraps a function,
    # no compute happens until it's called.
    hessian_loss_and_grad = nn.value_and_grad(model, resampled_loss_fn)
    rng = np.random.default_rng(0)

    # mx.compile fuses the repeated training-step graph instead of MLX
    # dispatching each op eagerly every batch -- the standard MLX pattern for
    # a training loop (state must be passed explicitly since compile can't
    # otherwise see that model/optimizer state changes between calls).
    # NOTE: authored without access to Apple Silicon/MLX in this sandbox --
    # verify this actually runs before trusting it for a long unattended run.
    state = [model.state, optimizer.state]

    @partial(mx.compile, inputs=state, outputs=state)
    def train_step(inputs: mx.array, targets: mx.array) -> mx.array:
        loss, grads = loss_and_grad(model, inputs, targets)
        optimizer.update(model, grads)
        return loss

    # Deliberately NOT wrapped in mx.compile like train_step above -- this
    # only runs every --sophia-hessian-interval steps (not every step), so
    # the payoff of compiling it is much smaller, and keeping it eager
    # avoids mixing a second, separately-compiled graph that also touches
    # optimizer.state with train_step's. Only ever called for --optimizer
    # sophia; a no-op branch for adamw (see the training loop below).
    def maybe_update_hessian(inputs: mx.array):
        if args.optimizer != "sophia":
            return
        estimate = gnb_hessian_estimate(hessian_loss_and_grad, model, inputs)
        optimizer.update_hessian(estimate)
        mx.eval(optimizer.state)

    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    ckpt_name = "base_tiny.safetensors" if args.tiny else "base.safetensors"
    ckpt_prefix = "tiny_checkpoint" if args.tiny else "base_checkpoint"

    def save_checkpoint(batches_done_total: int, final: bool = False):
        canonical_path = CKPT_DIR / ckpt_name
        model.save_weights(str(canonical_path))
        if final:
            print(f"Saved base checkpoint to {canonical_path}")
        else:
            numbered_path = CKPT_DIR / f"{ckpt_prefix}_{batches_done_total}.safetensors"
            model.save_weights(str(numbered_path))
            print(f"  ...checkpoint saved: {numbered_path} (also updated {canonical_path})")

    print(f"Training {'TINY' if args.tiny else 'BASE'} config: "
          f"d_model={cfg.d_model} n_layers={cfg.n_layers} vocab={cfg.vocab_size}")
    print(f"{len(train_sequences)} train sequences, {len(val_sequences)} val sequences")

    # Batches per epoch, matching iterate_batches' own step math -- used only
    # to print "N/total" in the heartbeat below, not for anything functional.
    batches_per_epoch = max(0, (len(train_sequences) - args.batch_size) // args.batch_size + 1) \
        if len(train_sequences) >= args.batch_size else 0
    total_batches_planned = batches_per_epoch * args.epochs
    # Evenly spaced intervals across the whole planned run -- 0 disables
    # mid-run checkpointing (matching the old behavior of one save at the end).
    checkpoint_interval = max(1, total_batches_planned // args.num_checkpoints) if args.num_checkpoints > 0 else 0
    # Target-side tokens per batch (inputs/targets are each seq_len-1 long,
    # since one position is shifted off for next-token prediction) -- the
    # standard "tokens/sec" convention for LM training throughput.
    seq_len = train_sequences.shape[1] if len(train_sequences) else 0
    tokens_per_batch = args.batch_size * max(0, seq_len - 1)

    # --diagnostic-every-steps setup: a tokenizer (for decoding text samples)
    # and one FIXED, small val subsample chosen once up front -- reused for
    # every periodic check so the val_loss readings are actually comparable
    # to each other across the run (a fresh random subsample each time would
    # make step 500 vs step 5000 an apples-to-oranges comparison). Loaded
    # unconditionally rather than gated on diagnostic_every_steps > 0 --
    # negligible cost, and keeps --resume mid-run simple.
    tokenizer = Tokenizer.from_file(str(TOKENIZER_PATH))
    bos_id = tokenizer.token_to_id("<bos>")
    eos_id = tokenizer.token_to_id("<eos>")
    diagnostic_val_sequences = val_sequences
    if len(diagnostic_val_sequences) > args.diagnostic_val_sequences:
        diag_rng = np.random.default_rng(2)
        idx = diag_rng.choice(len(diagnostic_val_sequences), size=args.diagnostic_val_sequences, replace=False)
        diagnostic_val_sequences = np.array(diagnostic_val_sequences[idx])

    run_start = time.time()
    total_batches_done = 0

    for epoch in range(args.epochs):
        start = time.time()
        epoch_losses = []
        last_heartbeat = start
        batches_done = 0
        for inputs, targets in iterate_batches(train_sequences, args.batch_size, rng):
            loss = train_step(inputs, targets)
            mx.eval(state)
            epoch_losses.append(float(loss))
            batches_done += 1
            total_batches_done += 1

            if total_batches_done % args.sophia_hessian_interval == 0:
                maybe_update_hessian(inputs)

            if checkpoint_interval and total_batches_done % checkpoint_interval == 0 \
                    and total_batches_done < total_batches_planned:
                save_checkpoint(total_batches_done)

            # Documentary record of val_loss + a language sample over the
            # course of a long run -- previously the only val_loss print was
            # at the very end of the whole run, so a multi-day run gave zero
            # visibility into whether/when it started overfitting or
            # (see docs/slm-strategy.md's v0.6 flat-LR loss-reversal note)
            # destabilizing partway through.
            if args.diagnostic_every_steps and total_batches_done % args.diagnostic_every_steps == 0:
                diag_val_loss = evaluate(model, diagnostic_val_sequences, args.batch_size)
                sample_text = generate_sample(model, tokenizer, bos_id, eos_id, args.sample_max_new_tokens)
                print(f"  [diagnostic @ step {total_batches_done}] val_loss={diag_val_loss:.4f}")
                print(f"    sample: {sample_text!r}")

            # A full run can spend many minutes-to-hours per epoch (hundreds
            # of thousands of batches at the base config) with the loop above
            # otherwise printing nothing until the whole epoch finishes --
            # indistinguishable from a hang. This is the same fix as
            # prepare_dataset.py's tokenization heartbeat, applied here.
            now = time.time()
            if now - last_heartbeat >= args.heartbeat_seconds:
                running_loss = sum(epoch_losses) / len(epoch_losses)
                # Throughput/ETA use the run-wide average rather than just
                # this epoch's, since MLX's lazy compilation makes the very
                # first few batches of the whole run slower than steady state
                # -- a run-wide average is more stable than re-measuring from
                # zero every epoch.
                elapsed_total = now - run_start
                tok_per_sec = (total_batches_done * tokens_per_batch) / elapsed_total if elapsed_total > 0 else 0
                remaining_batches = max(0, total_batches_planned - total_batches_done)
                sec_per_batch = elapsed_total / total_batches_done if total_batches_done > 0 else 0
                eta = format_duration(remaining_batches * sec_per_batch)
                print(f"  ...epoch {epoch + 1}/{args.epochs}: batch {batches_done}/{batches_per_epoch or '?'}, "
                      f"running loss={running_loss:.4f}, {tok_per_sec:,.0f} tok/s, ETA {eta} "
                      f"({now - start:.0f}s elapsed this epoch)")
                last_heartbeat = now

        elapsed_total = time.time() - run_start
        tok_per_sec = (total_batches_done * tokens_per_batch) / elapsed_total if elapsed_total > 0 else 0
        train_loss = sum(epoch_losses) / max(len(epoch_losses), 1)
        msg = (f"epoch {epoch + 1}/{args.epochs}  train_loss={train_loss:.4f}  "
               f"({time.time() - start:.1f}s, {tok_per_sec:,.0f} tok/s avg)")
        if (epoch + 1) % args.eval_every == 0:
            val_loss = evaluate(model, val_sequences, args.batch_size)
            msg += f"  val_loss={val_loss:.4f}"
        print(msg)

    save_checkpoint(total_batches_done, final=True)


if __name__ == "__main__":
    main()
