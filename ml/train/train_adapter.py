"""
Fine-tunes one LoRA adapter on top of the frozen, pretrained base model.

MLX-only -- write/review here, run on the M5 MacBook (see train_base.py's
module docstring for why this can't run in this Linux container).

Three tasks share this same script and the same frozen base --
attach_lora_adapters gives each its own independent LoRA params:
- entry_drafting: real synthetic training data (data/generate_synthetic.py).
- kb_authoring: synthetic bootstrap data (data/generate_kb_authoring_synthetic.py)
  -- a deliberate stand-in for real accumulated human_resolutions clusters,
  which don't exist in meaningful volume yet; see that script's docstring.
- platform_help: hand-authored ground truth + paraphrased variants
  (data/platform_help_seed.json, data/generate_platform_help_synthetic.py).

Running `--task X` before prepare_dataset.py has produced that task's
.npz files will fail loudly at the missing file, not silently train on the
wrong thing.

Usage (on the Mac, after train_base.py has produced a base checkpoint):
    python3 train_adapter.py --task entry_drafting --base-checkpoint ../checkpoints/base.safetensors
"""

import argparse
import sys
import time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent / "model"))
from config import BASE_CONFIG, LORA_ALPHA, LORA_RANK  # noqa: E402
from lora import attach_lora_adapters, save_adapter_params, trainable_lora_params  # noqa: E402
from transformer_mlx import BitNetTransformer  # noqa: E402

DATA_DIR = Path(__file__).parent.parent / "data" / "prepared"
CKPT_DIR = Path(__file__).parent.parent / "checkpoints"

TASKS = ("entry_drafting", "kb_authoring", "platform_help")


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
    parser.add_argument("--rank", type=int, default=None,
                         help="LoRA rank, defaults to model/config.py's LORA_RANK (currently 8). Raise this for a "
                              "task that needs more adapter capacity than the default gives it -- e.g. kb_authoring "
                              "has the hardest schema of the three tasks (the only one with list-valued fields, "
                              "keywords/skills) on top of needing to summarize a 3-example cluster, and rank=8 "
                              "produced eval output that collapsed into repeated/nonsense tokens regardless of "
                              "decoding strategy (see eval/run_eval_kb_authoring.py's --repetition-penalty), "
                              "consistent with too little capacity for the task rather than a decoding artifact. "
                              "--rank must match between train_adapter.py and whichever eval/inference script "
                              "later loads this exact adapter file, or load_adapter() breaks on a shape mismatch.")
    parser.add_argument("--alpha", type=int, default=None,
                         help="LoRA alpha, defaults to model/config.py's LORA_ALPHA (currently 16) when --rank is "
                              "also unset. If --rank is set and this isn't, scales alpha to keep the same "
                              "alpha/rank=2 ratio the current default uses, rather than silently changing that "
                              "ratio's effect on the adapter's effective learning rate.")
    args = parser.parse_args()
    if args.rank is not None and args.alpha is None:
        args.alpha = args.rank * 2

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
    # Falls back to attach_lora_adapters' own defaults (config.py's
    # LORA_RANK/LORA_ALPHA) when --rank isn't passed, rather than
    # duplicating those constants here.
    lora_kwargs = {"rank": args.rank, "alpha": args.alpha} if args.rank is not None else {}
    attach_lora_adapters(model, **lora_kwargs)
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

    print(f"Fine-tuning '{args.task}' adapter (rank={args.rank or LORA_RANK}, alpha={args.alpha or LORA_ALPHA}): "
          f"{len(train_data['input_ids'])} train / {len(val_data['input_ids'])} val examples")

    # With datasets this small (tens of examples), a handful of epochs is
    # enough to fully fit the train set and start memorizing it -- val_loss
    # reliably turns upward well before args.epochs runs out. Track whichever
    # epoch's params minimized val_loss and save that snapshot instead of
    # just whatever the model looks like after the last epoch.
    best_val_loss = float("inf")
    best_epoch = None
    best_params = None

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

        if val_loss == val_loss and val_loss < best_val_loss:  # val_loss == val_loss excludes nan (empty val set)
            best_val_loss = val_loss
            best_epoch = epoch + 1
            best_params = dict(trainable_lora_params(model))

    save_path = CKPT_DIR / f"{args.task}_adapter.safetensors"
    if best_params is not None:
        save_adapter_params(best_params, str(save_path))
        if best_epoch < args.epochs:
            note = "later epochs overfit and were discarded"
        else:
            # val_loss was still improving at the last epoch -- nothing was
            # actually discarded, and this run may be undertrained rather
            # than at/past its optimum. Say so instead of the (wrong, in
            # this case) overfitting message.
            note = "val_loss was still improving at the final epoch -- consider more epochs (--epochs) next time"
        print(f"Saved '{args.task}' adapter to {save_path} "
              f"(epoch {best_epoch}/{args.epochs}, best val_loss={best_val_loss:.4f} -- {note})")
    else:
        # No val set to compare against (val_loss was nan every epoch) --
        # nothing to select by, so fall back to the final epoch's params.
        save_adapter_params(dict(trainable_lora_params(model)), str(save_path))
        print(f"Saved '{args.task}' adapter to {save_path} (final epoch -- no val set to select a best epoch from)")


if __name__ == "__main__":
    main()
