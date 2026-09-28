"""
The shared ~196.9M-parameter (v0.8) base model: a standard decoder-only
transformer (nanoGPT-style), trained and run in bfloat16 -- no ternary
quantization.

v0.7 and earlier used native BitNet b1.58 (every nn.Linear replaced by
BitLinear, ternary {-1,0,+1} weights re-quantized on every forward pass via
a straight-through estimator -- see bitlinear.py, now superseded). Dropped
for v0.8: RESULTS.md's real M5 runs consistently measured BitLinear's QAT
training as compute-heavier per step than a plain dense layer of the same
size (every forward re-quantizes full-precision shadow weights on top of an
otherwise-ordinary matmul), which was the actual training-speed bottleneck
at every size tried -- not model capacity, not batch size beyond the memory
ceiling already diagnosed at v0.6. A plain dense transformer removes that
overhead entirely; bf16 (not fp32) keeps memory/bandwidth costs down
without the ternary quantization's own training-time tax.

MLX-only. Cannot run in this Linux container (MLX depends on Apple's Metal
runtime); write/review here, execute on the M5 MacBook.

Reference: nanoGPT (Karpathy) for the overall decoder-block/attention
structure -- the same pedagogical foundation v0.7 built from, minus the
BitNet-specific layer this version no longer needs.
"""

import math

import mlx.core as mx
import mlx.nn as nn

from config import ModelConfig


class DenseLinear(nn.Module):
    """A plain Linear layer whose weights and activations are cast to
    bfloat16 for the forward pass -- standard dense compute, no
    quantization, no straight-through estimator. Shape/call contract
    matches the old BitLinear exactly (out_features, in_features weight,
    optional bias) so lora.py's LoRALinear wrapper works unchanged.
    """

    def __init__(self, in_features: int, out_features: int, bias: bool = False):
        super().__init__()
        scale = 1.0 / math.sqrt(in_features)
        self.weight = mx.random.uniform(-scale, scale, (out_features, in_features)).astype(mx.bfloat16)
        self.bias = mx.zeros((out_features,), dtype=mx.bfloat16) if bias else None

    def __call__(self, x: mx.array) -> mx.array:
        x = x.astype(mx.bfloat16)
        out = x @ self.weight.T
        if self.bias is not None:
            out = out + self.bias
        return out


class CausalSelfAttention(nn.Module):
    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.n_heads = cfg.n_heads
        self.head_dim = cfg.head_dim
        self.qkv = DenseLinear(cfg.d_model, 3 * cfg.d_model)
        self.out_proj = DenseLinear(cfg.d_model, cfg.d_model)
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
        self.fc_in = DenseLinear(cfg.d_model, cfg.mlp_dim)
        self.fc_out = DenseLinear(cfg.mlp_dim, cfg.d_model)

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


class DenseTransformer(nn.Module):
    """The shared base model. LoRA adapters (lora.py) wrap this module's
    DenseLinear projections without modifying this file -- the base stays
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
        #
        # v0.7 tried this via `self.lm_head_weight = self.token_emb.weight`,
        # a second attribute aliasing the same array at construction time --
        # ml/RESULTS.md's 2026-07-23 "real bug" entry found MLX's parameter
        # tree treats attributes as independent leaves by *path*, not by
        # object identity, so each accumulated its own gradient and they
        # silently drifted apart during training (confirmed differing by up
        # to 0.56 on a real checkpoint). Fixed here the way that entry's own
        # lesson implies: don't create a second attribute at all -- reference
        # self.token_emb.weight directly at the point of use below, so
        # there's genuinely one leaf, not two that happen to start equal.

    def __call__(self, idx: mx.array) -> mx.array:
        b, t = idx.shape
        assert t <= self.cfg.max_seq_len, "sequence longer than max_seq_len"
        positions = mx.arange(t)
        x = self.token_emb(idx) + self.pos_emb(positions)

        mask = nn.MultiHeadAttention.create_additive_causal_mask(t)
        for block in self.blocks:
            x = block(x, mask)
        x = self.ln_f(x)
        return x @ self.token_emb.weight.T
