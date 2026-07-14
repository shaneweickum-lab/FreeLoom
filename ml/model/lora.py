"""
LoRA adapters over the shared BitNetTransformer's BitLinear projections.

One LoRAAdapterSet per task (entry-drafting, knowledge-base-authoring). The
base model's BitLinear weights are frozen; only each adapter's own small
A/B matrices train. This is what keeps the two jobs from negative-transfer
risk (docs/slm-strategy.md Section 2/7) -- task specialization lives in a
few hundred thousand adapter params each, not in a shared output head.

MLX-only, same as transformer_mlx.py -- write/review here, run on the M5
MacBook.
"""

import mlx.core as mx
import mlx.nn as nn

from config import LORA_ALPHA, LORA_DROPOUT, LORA_RANK, ModelConfig
from transformer_mlx import BitLinear, BitNetTransformer


class LoRALinear(nn.Module):
    """Wraps a frozen BitLinear layer, adding a trainable low-rank residual:
    output = BitLinear(x) + (alpha / rank) * (dropout(x) @ A.T @ B.T).

    A is initialized to a small random projection, B to zero, so the
    adapter starts as a true no-op identical to the unadapted base model
    (standard LoRA initialization) -- important here specifically because
    it means swapping an adapter in never regresses below "no adapter" on
    the very first checkpoint.
    """

    def __init__(self, base: BitLinear, rank: int = LORA_RANK, alpha: int = LORA_ALPHA,
                 dropout: float = LORA_DROPOUT):
        super().__init__()
        self.base = base
        self.base.freeze()
        out_features, in_features = base.weight.shape
        self.scale = alpha / rank
        self.dropout = dropout
        self.lora_a = mx.random.normal((rank, in_features)) * 0.01
        self.lora_b = mx.zeros((out_features, rank))

    def __call__(self, x: mx.array) -> mx.array:
        base_out = self.base(x)
        h = x
        if self.dropout > 0.0:
            h = nn.Dropout(self.dropout)(h)
        lora_out = (h @ self.lora_a.T) @ self.lora_b.T
        return base_out + self.scale * lora_out


def attach_lora_adapters(model: BitNetTransformer, rank: int = LORA_RANK,
                          alpha: int = LORA_ALPHA, dropout: float = LORA_DROPOUT) -> None:
    """Replaces every BitLinear projection in-place with a LoRALinear
    wrapper. Call once per fresh adapter (a new randomly-initialized A, a
    zero-initialized B) -- entry-drafting and knowledge-base-authoring each
    get their own call against their own copy of the frozen base weights.
    """
    for block in model.blocks:
        block.attn.qkv = LoRALinear(block.attn.qkv, rank, alpha, dropout)
        block.attn.out_proj = LoRALinear(block.attn.out_proj, rank, alpha, dropout)
        block.mlp.fc_in = LoRALinear(block.mlp.fc_in, rank, alpha, dropout)
        block.mlp.fc_out = LoRALinear(block.mlp.fc_out, rank, alpha, dropout)


def trainable_lora_params(model: BitNetTransformer) -> dict:
    """Returns only the LoRA A/B matrices as a flat dict suitable for
    mlx.optimizers -- everything else (the frozen base) is excluded so an
    optimizer step never touches base weights during adapter fine-tuning."""
    params = {}
    for i, block in enumerate(model.blocks):
        for name in ("qkv", "out_proj"):
            layer = getattr(block.attn, name)
            if isinstance(layer, LoRALinear):
                params[f"block{i}.attn.{name}.lora_a"] = layer.lora_a
                params[f"block{i}.attn.{name}.lora_b"] = layer.lora_b
        for name in ("fc_in", "fc_out"):
            layer = getattr(block.mlp, name)
            if isinstance(layer, LoRALinear):
                params[f"block{i}.mlp.{name}.lora_a"] = layer.lora_a
                params[f"block{i}.mlp.{name}.lora_b"] = layer.lora_b
    return params


def save_adapter(model: BitNetTransformer, path: str) -> None:
    """Saves only the trained LoRA params -- typically a few MB, not the
    ~58M-param base -- so entry_drafting.safetensors and
    kb_authoring.safetensors stay small, independent, swappable artifacts."""
    mx.save_safetensors(path, trainable_lora_params(model))


def load_adapter(model: BitNetTransformer, path: str) -> None:
    """Loads a saved adapter's params back onto a model whose LoRA layers
    were already attached via attach_lora_adapters with matching rank."""
    weights = mx.load(path)
    for i, block in enumerate(model.blocks):
        for name in ("qkv", "out_proj"):
            layer = getattr(block.attn, name)
            if isinstance(layer, LoRALinear):
                layer.lora_a = weights[f"block{i}.attn.{name}.lora_a"]
                layer.lora_b = weights[f"block{i}.attn.{name}.lora_b"]
        for name in ("fc_in", "fc_out"):
            layer = getattr(block.mlp, name)
            if isinstance(layer, LoRALinear):
                layer.lora_a = weights[f"block{i}.mlp.{name}.lora_a"]
                layer.lora_b = weights[f"block{i}.mlp.{name}.lora_b"]
