"""
The shared 60M-parameter base model: a standard decoder-only transformer
(nanoGPT-style) with every nn.Linear replaced by BitLinear (native BitNet
b1.58 ternary weights, trained from scratch -- not post-hoc quantization).

MLX-only. Cannot run in this Linux container (MLX depends on Apple's Metal
runtime); write/review here, execute on the M5 MacBook. The quantization
math this file wires into MLX's autograd is the same math validated in
ml/model/bitlinear.py's numpy tests -- port bugs should show up as a
divergence from that reference, not as a fresh derivation.

Reference implementations this follows: exo-explore/mlx-bitnet for the
BitLinear + straight-through estimator wiring, nanoGPT for the overall
decoder-block/attention structure.
"""

import math

import mlx.core as mx
import mlx.nn as nn

from config import ModelConfig

_EPS = 1e-5


def _ste_round(x: mx.array) -> mx.array:
    """Straight-through estimator: forward pass rounds, backward pass acts
    like identity (gradient passes through unrounded), via the standard
    stop_gradient trick: x + stop_gradient(round(x) - x) == round(x) in the
    forward pass, but its gradient w.r.t. x is 1 everywhere."""
    rounded = mx.round(x)
    return x + mx.stop_gradient(rounded - x)


def _ste_clip(x: mx.array, lo: float, hi: float) -> mx.array:
    clipped = mx.clip(x, lo, hi)
    return x + mx.stop_gradient(clipped - x)


class BitLinear(nn.Module):
    """A Linear layer whose weights are ternary-quantized {-1, 0, +1} on
    every forward pass (native BitNet b1.58 training, not post-training
    quantization of a full-precision checkpoint).

    Full-precision "shadow" weights are the actual learnable parameter
    (matching every published BitNet training recipe); quantization is
    applied fresh each forward pass via the straight-through estimator so
    gradients still flow into the shadow weights.
    """

    def __init__(self, in_features: int, out_features: int, bias: bool = False):
        super().__init__()
        scale = 1.0 / math.sqrt(in_features)
        self.weight = mx.random.uniform(-scale, scale, (out_features, in_features))
        self.bias = mx.zeros((out_features,)) if bias else None

    def _quantized_weight(self) -> mx.array:
        w = self.weight
        w_scale = 1.0 / mx.maximum(mx.abs(w).mean(), _EPS)
        w_ternary = _ste_clip(_ste_round(w * w_scale), -1, 1)
        return w_ternary / w_scale

    def _quantized_activation(self, x: mx.array) -> mx.array:
        q_max = 127.0
        row_max = mx.maximum(mx.abs(x).max(axis=-1, keepdims=True), _EPS)
        x_scale = q_max / row_max
        x_quant = _ste_clip(_ste_round(x * x_scale), -q_max - 1, q_max)
        return x_quant / x_scale

    def __call__(self, x: mx.array) -> mx.array:
        w_q = self._quantized_weight()
        x_q = self._quantized_activation(x)
        out = x_q @ w_q.T
        if self.bias is not None:
            out = out + self.bias
        return out


class CausalSelfAttention(nn.Module):
    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.n_heads = cfg.n_heads
        self.head_dim = cfg.head_dim
        self.qkv = BitLinear(cfg.d_model, 3 * cfg.d_model)
        self.out_proj = BitLinear(cfg.d_model, cfg.d_model)
        self.dropout = cfg.dropout

    def __call__(self, x: mx.array, mask: mx.array) -> mx.array:
        b, t, d = x.shape
        qkv = self.qkv(x)
        q, k, v = mx.split(qkv, 3, axis=-1)
        q = q.reshape(b, t, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)
        k = k.reshape(b, t, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)
        v = v.reshape(b, t, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)

        scale = 1.0 / math.sqrt(self.head_dim)
        attn = (q @ k.transpose(0, 1, 3, 2)) * scale
        attn = attn + mask
        attn = mx.softmax(attn, axis=-1)
        out = attn @ v
        out = out.transpose(0, 2, 1, 3).reshape(b, t, d)
        return self.out_proj(out)


class MLP(nn.Module):
    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.fc_in = BitLinear(cfg.d_model, cfg.mlp_dim)
        self.fc_out = BitLinear(cfg.mlp_dim, cfg.d_model)

    def __call__(self, x: mx.array) -> mx.array:
        return self.fc_out(nn.gelu(self.fc_in(x)))


class Block(nn.Module):
    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.ln1 = nn.LayerNorm(cfg.d_model)
        self.attn = CausalSelfAttention(cfg)
        self.ln2 = nn.LayerNorm(cfg.d_model)
        self.mlp = MLP(cfg)

    def __call__(self, x: mx.array, mask: mx.array) -> mx.array:
        x = x + self.attn(self.ln1(x), mask)
        x = x + self.mlp(self.ln2(x))
        return x


class BitNetTransformer(nn.Module):
    """The shared base model. LoRA adapters (lora.py) wrap this module's
    BitLinear projections without modifying this file -- the base stays
    frozen once pretrained; only adapter-owned low-rank matrices train
    during each task's fine-tuning pass."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.cfg = cfg
        self.token_emb = nn.Embedding(cfg.vocab_size, cfg.d_model)
        self.pos_emb = nn.Embedding(cfg.max_seq_len, cfg.d_model)
        self.blocks = [Block(cfg) for _ in range(cfg.n_layers)]
        self.ln_f = nn.LayerNorm(cfg.d_model)
        # Tied embedding/output head -- halves the vocab-side parameter cost,
        # standard practice at this scale (see config.py's param estimate).
        self.lm_head_weight = self.token_emb.weight

    def __call__(self, idx: mx.array) -> mx.array:
        b, t = idx.shape
        assert t <= self.cfg.max_seq_len, "sequence longer than max_seq_len"
        positions = mx.arange(t)
        x = self.token_emb(idx) + self.pos_emb(positions)

        mask = nn.MultiHeadAttention.create_additive_causal_mask(t)
        for block in self.blocks:
            x = block(x, mask)
        x = self.ln_f(x)
        return x @ self.lm_head_weight.T
