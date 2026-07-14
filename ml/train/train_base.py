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
import time
from dataclasses import replace
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np

from config import BASE_CONFIG, ModelConfig
from transformer_mlx import BitNetTransformer

DATA_DIR = Path(__file__).parent.parent / "data" / "prepared"
CKPT_DIR = Path(__file__).parent.parent / "checkpoints"

# A deliberately small config for --tiny: fast enough to sanity-check the
# whole pipeline (tokenizer, data loading, BitLinear, loss curve) in
# minutes rather than committing to the full ~60M run untested.
TINY_CONFIG = ModelConfig(d_model=128, n_layers=2, n_heads=4, max_seq_len=512)


def loss_fn(model: BitNetTransformer, inputs: mx.array, targets: mx.array) -> mx.array:
    logits = model(inputs)
    return nn.losses.cross_entropy(logits.reshape(-1, logits.shape[-1]), targets.reshape(-1), reduction="mean")


def iterate_batches(sequences: np.ndarray, batch_size: int, rng: np.random.Generator):
    order = rng.permutation(len(sequences))
    for start in range(0, len(order) - batch_size + 1, batch_size):
        idx = order[start: start + batch_size]
        batch = mx.array(sequences[idx])
        yield batch[:, :-1], batch[:, 1:]


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
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--eval-every", type=int, default=1)
    parser.add_argument("--resume", type=str, default=None)
    args = parser.parse_args()

    cfg = TINY_CONFIG if args.tiny else BASE_CONFIG
    train_sequences = np.load(DATA_DIR / "base_train.npy")
    val_sequences = np.load(DATA_DIR / "base_val.npy")

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

    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    ckpt_name = "base_tiny.safetensors" if args.tiny else "base.safetensors"

    print(f"Training {'TINY' if args.tiny else 'BASE'} config: "
          f"d_model={cfg.d_model} n_layers={cfg.n_layers} vocab={cfg.vocab_size}")
    print(f"{len(train_sequences)} train sequences, {len(val_sequences)} val sequences")

    for epoch in range(args.epochs):
        start = time.time()
        epoch_losses = []
        for inputs, targets in iterate_batches(train_sequences, args.batch_size, rng):
            loss, grads = loss_and_grad(model, inputs, targets)
            optimizer.update(model, grads)
            mx.eval(model.parameters(), optimizer.state)
            epoch_losses.append(float(loss))

        train_loss = sum(epoch_losses) / max(len(epoch_losses), 1)
        msg = f"epoch {epoch + 1}/{args.epochs}  train_loss={train_loss:.4f}  ({time.time() - start:.1f}s)"
        if (epoch + 1) % args.eval_every == 0:
            val_loss = evaluate(model, val_sequences, args.batch_size)
            msg += f"  val_loss={val_loss:.4f}"
        print(msg)

    save_path = CKPT_DIR / ckpt_name
    model.save_weights(str(save_path))
    print(f"Saved base checkpoint to {save_path}")


if __name__ == "__main__":
    main()
