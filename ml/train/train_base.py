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
    python3 train_base.py                        # full-config run
    python3 train_base.py --resume base_ckpt.safetensors
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

sys.path.insert(0, str(Path(__file__).parent.parent / "model"))
from config import BASE_CONFIG, ModelConfig, estimate_param_count, estimate_token_budget  # noqa: E402
from transformer_mlx import BitNetTransformer  # noqa: E402

DATA_DIR = Path(__file__).parent.parent / "data" / "prepared"
CKPT_DIR = Path(__file__).parent.parent / "checkpoints"

# A deliberately small config for --tiny: fast enough to sanity-check the
# whole pipeline (tokenizer, data loading, BitLinear, loss curve) in
# minutes rather than committing to the full BASE_CONFIG run untested.
TINY_CONFIG = ModelConfig(d_model=128, n_layers=2, n_heads=4, max_seq_len=512)


def loss_fn(model: BitNetTransformer, inputs: mx.array, targets: mx.array) -> mx.array:
    logits = model(inputs)
    return nn.losses.cross_entropy(logits.reshape(-1, logits.shape[-1]), targets.reshape(-1), reduction="mean")


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tiny", action="store_true", help="use TINY_CONFIG for a fast pipeline sanity check")
    parser.add_argument("--epochs", type=int, default=None,
                         help="defaults to 20 for --tiny (many quick passes over a small subsample) or "
                              "1 for the full run -- base_train.npy already IS the full ~2.4B-token "
                              "budget the corpus was originally packed for (TinyStories was already "
                              "repeated 4x when the corpus was assembled), so one epoch over it hits "
                              "that budget exactly; each additional epoch here multiplies the effective "
                              "token count on top of that, not for free")
    parser.add_argument("--batch-size", type=int, default=64,
                         help="was 8 -- a very conservative default for a 24GB-unified-memory Mac and "
                              "an ~81M-param model. Bigger batches don't reduce total FLOPs, but they "
                              "trade many small matmuls for fewer, bigger ones, which usually improves "
                              "real MLX/Metal throughput. Lower this if you hit a memory error.")
    parser.add_argument("--lr", type=float, default=3e-4)
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

    optimizer = optim.AdamW(learning_rate=args.lr)
    loss_and_grad = nn.value_and_grad(model, loss_fn)
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

    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    ckpt_name = "base_tiny.safetensors" if args.tiny else "base.safetensors"

    print(f"Training {'TINY' if args.tiny else 'BASE'} config: "
          f"d_model={cfg.d_model} n_layers={cfg.n_layers} vocab={cfg.vocab_size}")
    print(f"{len(train_sequences)} train sequences, {len(val_sequences)} val sequences")

    # Batches per epoch, matching iterate_batches' own step math -- used only
    # to print "N/total" in the heartbeat below, not for anything functional.
    batches_per_epoch = max(0, (len(train_sequences) - args.batch_size) // args.batch_size + 1) \
        if len(train_sequences) >= args.batch_size else 0
    total_batches_planned = batches_per_epoch * args.epochs
    # Target-side tokens per batch (inputs/targets are each seq_len-1 long,
    # since one position is shifted off for next-token prediction) -- the
    # standard "tokens/sec" convention for LM training throughput.
    seq_len = train_sequences.shape[1] if len(train_sequences) else 0
    tokens_per_batch = args.batch_size * max(0, seq_len - 1)

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

    save_path = CKPT_DIR / ckpt_name
    model.save_weights(str(save_path))
    print(f"Saved base checkpoint to {save_path}")


if __name__ == "__main__":
    main()
