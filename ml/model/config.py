"""
Architecture sizing for the shared ~196.9M-parameter (v0.8) dense base model.

Pure-Python arithmetic, no MLX dependency -- verifiable in any environment,
including this one. The MLX model (transformer_mlx.py) is built directly
from this config so the two can't silently drift apart.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelConfig:
    vocab_size: int = 8000  # matches ml/tokenizer/tokenizer.json as retrained against
                            # the TinyStories/FineWeb-Edu base corpus sample (was 1477,
                            # sized for the original 76-example proof-of-concept corpus
                            # -- train_base.py asserts these stay in sync, since a
                            # mismatch here means a real token id the tokenizer can
                            # produce falls outside the model's embedding table). Left
                            # unchanged at v0.8's resize -- 8,000 tokens is plenty for
                            # the same English-language corpus at any of these param
                            # counts; a bigger vocab isn't the lever this resize pulls.
    d_model: int = 1024     # v0.8: a genuine architecture change, not another step up
                            # v0.5-v0.7's same staircase -- drops native BitNet ternary
                            # quantization entirely in favor of a plain dense transformer
                            # trained in bf16 (see transformer_mlx.py's own doc comment
                            # for why: RESULTS.md already measured BitLinear's per-step
                            # QAT overhead as the actual training-speed bottleneck at
                            # every size tried, not model capacity). Widened from v0.7's
                            # 512 to 1024 (head_dim stays 64 at 16 heads, still a clean
                            # power of 2 -- see the alignment lesson from v0.6's ~40x
                            # regression at head_dim=58, RESULTS.md 2026-07-23) to reach
                            # ~200M params without an implausibly deep 30+ layer stack.
    n_layers: int = 15      # ~196.9M params (see estimate_param_count()) -- closest
                            # clean value to the requested ~200M at this width.
    n_heads: int = 16       # head_dim = 1024/16 = 64, a clean power of 2.
    mlp_ratio: int = 4
    max_seq_len: int = 512
    dropout: float = 0.1

    @property
    def head_dim(self) -> int:
        assert self.d_model % self.n_heads == 0
        return self.d_model // self.n_heads

    @property
    def mlp_dim(self) -> int:
        return self.d_model * self.mlp_ratio


def estimate_param_count(cfg: ModelConfig) -> int:
    """Rough dense-transformer parameter count, tied embedding/output head.

    Per layer: attention (q,k,v,out projections, each d_model x d_model) +
    MLP (d_model x mlp_dim, mlp_dim x d_model). Ignores layer norms and
    biases (negligible at this scale, a few thousand params total).
    """
    embedding = cfg.vocab_size * cfg.d_model
    attn_per_layer = 4 * cfg.d_model * cfg.d_model
    mlp_per_layer = 2 * cfg.d_model * cfg.mlp_dim
    per_layer = attn_per_layer + mlp_per_layer
    return embedding + cfg.n_layers * per_layer


BASE_CONFIG = ModelConfig()

# LoRA adapters: small rank on top of every attention/MLP projection in the
# frozen base. Two independent adapter configs (currently identical) so
# entry-drafting and knowledge-base-authoring can be tuned separately later
# without coupling their capacity.
LORA_RANK = 8
LORA_ALPHA = 16
LORA_DROPOUT = 0.05


def estimate_lora_param_count(cfg: ModelConfig, rank: int = LORA_RANK) -> int:
    """LoRA adds two low-rank matrices (d_model x rank, rank x d_model) per
    adapted projection. Adapted here: all 4 attention projections + both MLP
    projections per layer, matching transformer_mlx.py's LoRALinear wiring."""
    projections_per_layer = 4 + 2
    per_projection = 2 * cfg.d_model * rank
    return cfg.n_layers * projections_per_layer * per_projection


# Chinchilla (Hoffmann et al. 2022) found ~20 tokens/parameter compute-optimal.
# v0.5/v0.6 deliberately overtrained well past that (56, then 94 tokens/param),
# v0.7 settled on 40 (still a real step back from v0.6's 94, not as close to
# pure Chinchilla-optimal as an earlier 30 attempt) -- v0.8 keeps that same
# 40:1 ratio unchanged, just recomputed at the new ~196.9M param count. At
# v0.8's sizing that's ~7.88B tokens -- see prepare_base_corpus.py/
# prepare_dataset.py for the corpus retargeted to reach this (previously
# ~2.05B tokens, sized for v0.7's ~51.3M params).
CHINCHILLA_TOKENS_PER_PARAM = 20
TRAIN_TOKENS_PER_PARAM = 40


def estimate_token_budget(param_count: int, tokens_per_param: int = TRAIN_TOKENS_PER_PARAM) -> int:
    """How many training tokens `param_count` calls for at the configured
    tokens/parameter ratio -- the number a real corpus needs to reach before
    a full (non-tiny) pretraining run is actually worth committing to."""
    return param_count * tokens_per_param


if __name__ == "__main__":
    params = estimate_param_count(BASE_CONFIG)
    lora_params = estimate_lora_param_count(BASE_CONFIG)
    token_budget = estimate_token_budget(params)
    print(f"Base model: ~{params:,} parameters ({params / 1e6:.1f}M)")
    print(f"Per-adapter LoRA: ~{lora_params:,} parameters ({lora_params / 1e6:.2f}M)")
    print(f"Two adapters total: ~{2 * lora_params:,} parameters ({2 * lora_params / 1e6:.2f}M)")
    print(
        f"Training token budget at {TRAIN_TOKENS_PER_PARAM} tokens/param "
        f"(Chinchilla's {CHINCHILLA_TOKENS_PER_PARAM} compute-optimal ratio, deliberately "
        f"overtrained past it): ~{token_budget:,} tokens ({token_budget / 1e9:.2f}B)"
    )
