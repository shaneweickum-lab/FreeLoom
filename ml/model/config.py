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
    d_model: int = 384      # v0.6: the first deliberate step up the staged-growth
                            # staircase (docs/benny-case-study.md's "long-term vision"),
                            # not another compute-driven shrink. Sizing history: 876
                            # (~80.7M) -> shrunk to 384 (~13.7M) once the first real M5
                            # run showed native BitNet QAT training is compute-heavier
                            # per step than a plain dense model the same size (every
                            # BitLinear forward re-quantizes its full-precision shadow
                            # weights via the straight-through estimator on top of an
                            # otherwise-ordinary matmul -- the famous BitNet speed/memory
                            # win only exists at inference time with truly packed
                            # low-bit weights, not during training). That 13.7M config
                            # then actually trained on the M5: ~20,600 tok/s sustained,
                            # ~10.3 hours for a full 766.6M-token epoch (ml/RESULTS.md,
                            # 2026-07-22) -- far faster than the old 876-config's
                            # measured ~305 tok/s, since compute scales with param count.
                            # That headroom is what this step spends. FIRST ATTEMPT at
                            # this size was 464/9/8 (head_dim=58) -- picked to land as
                            # close as possible to a round ~27.0M params, but a real M5
                            # run measured only ~506 tok/s, a ~40x regression nothing in
                            # the param-count math predicts. head_dim=58 (and d_model=464
                            # itself) aren't multiples of 32, unlike the 13.7M config's
                            # own head_dim=64 -- its doc comment already called that out
                            # as "a clean power of 2", deliberately, and Metal's
                            # matmul/attention kernels have well-known fast paths for
                            # aligned tile sizes (multiples of 32/64) with much slower
                            # generic fallbacks otherwise. 512/7/8 (head_dim=64,
                            # mlp_dim=2048) restores that alignment throughout -- d_model,
                            # head_dim, and mlp_dim are all powers of two again, same
                            # property the 13.7M config relied on -- while landing at
                            # ~26.1M params, still comfortably inside the well-evidenced
                            # 100K-48M-param small-scale BitNet research range cited in
                            # docs/slm-strategy.md Section 3.
    n_layers: int = 9
    n_heads: int = 6        # head_dim = 512/8 = 64, a clean power of 2 again.
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
# this reason). Pushed further here than a modest +10 margin -- Benny's base
# model is unusually small and the TinyStories/FineWeb-Edu corpus makes extra
# tokens cheap to come by, so deliberately overtraining well past
# compute-optimal trades cheap extra pretraining compute for a smaller,
# cheaper model at a given quality bar, same trade LLaMA made. Bumped from 56
# to 94 for v0.6's 512/7/8 (~26.1M param) config specifically so this size's
# own deliberate-overtraining budget lands almost exactly on the ~2.46B
# tokens train/prepare_dataset.py already packed (sized at the time for an
# earlier, larger config) -- the full already-packed corpus becomes exactly
# what this size calls for, rather than most of it being discarded by
# train_base.py's budget-based subsampling the way smaller configs required.
CHINCHILLA_TOKENS_PER_PARAM = 20
TRAIN_TOKENS_PER_PARAM = 94


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
