"""
Fine-tunes one LoRA adapter on top of the frozen, pretrained base model.

MLX-only -- write/review here, run on the M5 MacBook (see train_base.py's
module docstring for why this can't run in this Linux container).

Only entry_drafting has real training data right now (from
prepare_dataset.py's entry_drafting_train.npz/entry_drafting_val.npz).
kb_authoring is wired up structurally -- attach_lora_adapters gives it its
own independent LoRA params on the same frozen base -- but has no dataset
yet; see prepare_dataset.py's docstring for why (needs accumulated
human_resolutions volume first). Running `--task kb_authoring` before that
data exists will fail loudly at the missing .npz file, not silently train
on the wrong thing.

Usage (on the Mac, after train_base.py has produced a base checkpoint):
    python3 train_adapter.py --task entry_drafting --base-checkpoint ../checkpoints/base.safetensors
"""

import argparse
import time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np

from config import BASE_CONFIG
from lora import attach_lora_adapters, save_adapter
from transformer_mlx import BitNetTransformer

DATA_DIR = Path(__file__).parent.parent / "data" / "prepared"
CKPT_DIR = Path(__file__).parent.parent / "checkpoints"

TASKS = ("entry_drafting", "kb_authoring")


def masked_loss_fn(model: BitNetTransformer, inputs: mx.array, targets: mx.array, mask: mx.array) -> mx.array:
    logits = model(inputs)
    per_token = nn.losses.cross_entropy(
        logits.reshape(-1, logits.shape[-1]), targets.reshape(-1), reduction="none"
    ).reshape(targets.shape)
    masked = per_token * mask
    return masked.sum() / mx.maximum(mask.sum(), 1.0)


def iterate_batches(input_ids: np.ndarray, loss_mask: np.ndarray, batch_size: int, rng: np.random.Generator):
    order = rng.permutation(len(input_ids))
    for start in range(0, len(order) - batch_size + 1, batch_size):
        idx = order[start: start + batch_size]
        ids = mx.array(input_ids[idx])
        mask = mx.array(loss_mask[idx])
        # Next-token targets: predict token t+1 from tokens[:t+1]; mask
        # shifts the same way so loss still lands only on completion tokens.
        yield ids[:, :-1], ids[:, 1:], mask[:, 1:]


def evaluate(model: BitNetTransformer, input_ids: np.ndarray, loss_mask: np.ndarray, batch_size: int) -> float:
    if len(input_ids) == 0:
        return float("nan")
    rng = np.random.default_rng(0)
    losses = []
    for inputs, targets, mask in iterate_batches(input_ids, loss_mask, min(batch_size, len(input_ids)), rng):
        losses.append(float(masked_loss_fn(model, inputs, targets, mask)))
    return sum(losses) / max(len(losses), 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=TASKS, required=True)
    parser.add_argument("--base-checkpoint", type=str, required=True)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-3)
    args = parser.parse_args()

    train_path = DATA_DIR / f"{args.task}_train.npz"
    val_path = DATA_DIR / f"{args.task}_val.npz"
    if not train_path.exists():
        raise SystemExit(
            f"no dataset at {train_path} -- {args.task} has no training data prepared yet "
            "(see prepare_dataset.py docstring)"
        )

    train_data = np.load(train_path)
    val_data = np.load(val_path)

    model = BitNetTransformer(BASE_CONFIG)
    model.load_weights(args.base_checkpoint)
    attach_lora_adapters(model)
    model.freeze()

    # Unfreeze exactly the LoRA params -- everything else (base BitLinear
    # weights, embeddings, layer norms) stays frozen throughout.
    for _, module in model.named_modules():
        if hasattr(module, "lora_a"):
            module.unfreeze(keys=["lora_a", "lora_b"])

    optimizer = optim.AdamW(learning_rate=args.lr)
    loss_and_grad = nn.value_and_grad(model, masked_loss_fn)
    rng = np.random.default_rng(0)

    CKPT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Fine-tuning '{args.task}' adapter: {len(train_data['input_ids'])} train / "
          f"{len(val_data['input_ids'])} val examples")

    for epoch in range(args.epochs):
        start = time.time()
        epoch_losses = []
        for inputs, targets, mask in iterate_batches(
            train_data["input_ids"], train_data["loss_mask"], args.batch_size, rng
        ):
            loss, grads = loss_and_grad(model, inputs, targets, mask)
            optimizer.update(model, grads)
            mx.eval(model.parameters(), optimizer.state)
            epoch_losses.append(float(loss))

        train_loss = sum(epoch_losses) / max(len(epoch_losses), 1)
        val_loss = evaluate(model, val_data["input_ids"], val_data["loss_mask"], args.batch_size)
        print(f"epoch {epoch + 1}/{args.epochs}  train_loss={train_loss:.4f}  "
              f"val_loss={val_loss:.4f}  ({time.time() - start:.1f}s)")

    save_path = CKPT_DIR / f"{args.task}_adapter.safetensors"
    save_adapter(model, str(save_path))
    print(f"Saved '{args.task}' adapter to {save_path}")


if __name__ == "__main__":
    main()
