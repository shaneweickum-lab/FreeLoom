"""
Architecture sizing for the shared ~13.7M-parameter BitNet base model.

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
                            # produce falls outside the model's embedding table).
    d_model: int = 384      # shrunk from 876 (~80.7M params) after the first real
                            # training run on the M5 showed native BitNet QAT training
                            # is compute-heavier per step than a plain dense model of
                            # the same size (every BitLinear forward re-quantizes its
                            # full-precision shadow weights via the straight-through
                            # estimator, on top of an otherwise-ordinary matmul -- the
                            # famous BitNet speed/memory win only exists at inference
                            # time with truly packed low-bit weights, not during
                            # training). At the observed ~305 tok/s, 876/8-layer sizing
                            # projected to ~84 days for one epoch of its own 2.42B-token
                            # budget. This size's Chinchilla+10 budget (see below) is
                            # ~410.7M tokens -- the token budget scales with param count
                            # too, so shrinking the model compounds: both less compute
                            # per token AND fewer total tokens needed, projecting to
                            # roughly 2 days instead of ~84. Comfortably inside the
                            # well-evidenced 100K-48M-param small-scale BitNet research
                            # range cited in docs/slm-strategy.md Section 3 -- more so
                            # than the previous 80.7M size was.
    n_layers: int = 6
    n_heads: int = 6        # head_dim = 384/6 = 64, a clean power of 2.
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
# Training past that ratio is well-precedented for small models meant to run
# cheaply at inference (LLaMA trained well beyond compute-optimal for exactly
# this reason) -- +10 tokens/parameter here is a deliberate, modest
# overtraining budget on top of the Chinchilla baseline, not a guess.
CHINCHILLA_TOKENS_PER_PARAM = 20
TRAIN_TOKENS_PER_PARAM = CHINCHILLA_TOKENS_PER_PARAM + 10


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
        f"(Chinchilla's {CHINCHILLA_TOKENS_PER_PARAM} + 10): ~{token_budget:,} tokens "
        f"({token_budget / 1e9:.2f}B)"
    )
