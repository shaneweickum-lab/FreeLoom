"""
Architecture sizing for the shared ~51.3M-parameter BitNet base model.

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
    d_model: int = 512      # v0.7: another deliberate step up the staged-growth
                            # staircase (docs/benny-case-study.md's "long-term vision"),
                            # kept at v0.6's same d_model=512/head_dim=64 -- the width
                            # confirmed fast and safe across the whole v0.6 bisection
                            # (from a ~40x dimension-misalignment regression at
                            # d_model=464/head_dim=58, through a ~829-tok/s
                            # memory-pressure regression at n_layers=7/batch_size=64,
                            # to a real, measured 15,200 tok/s at n_layers=7/
                            # batch_size=16 -- see ml/RESULTS.md 2026-07-23 for the full
                            # log). This size spends capacity on DEPTH instead of width
                            # for exactly that reason: v0.6's bisection showed the memory
                            # cliff was tied to total model footprint at this width, not
                            # width itself, so going deeper at the same already-safe
                            # d_model=512 is the best-evidenced way to grow further,
                            # though a deeper/bigger model will very likely need an even
                            # smaller --batch-size than v0.6's 16 to stay off that same
                            # cliff -- expect to re-run v0.6's batch-size bisection
                            # (halving from 16 until throughput stops improving) rather
                            # than assuming 16 still works here untested.
    n_layers: int = 15       # ~51.3M params (see estimate_param_count()) -- closest
                            # clean value to the requested ~50M at this width.
    n_heads: int = 8        # head_dim = 512/8 = 64, a clean power of 2, unchanged from v0.6.
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
# v0.5/v0.6 both deliberately overtrained well past that (56, then 94
# tokens/param) -- the same trade LLaMA made, cheap extra pretraining compute
# for a smaller, cheaper-to-run model at a given quality bar, leaning on how
# cheap extra TinyStories/FineWeb-Edu tokens are. v0.7 is a deliberate change
# of strategy, not a continuation of that trend: 30 tokens/param, much closer
# to Chinchilla-optimal than either prior size. At ~51.3M params that's
# ~1.54B tokens -- landing almost exactly on the ~1.5B-token corpus v0.7 packs
# (TinyStories x2 ~950M + FineWeb-Edu ~550M, see prepare_base_corpus.py/
# prepare_dataset.py), so this is again sized to consume the whole packed
# corpus rather than waste most of it to subsampling.
CHINCHILLA_TOKENS_PER_PARAM = 20
TRAIN_TOKENS_PER_PARAM = 30


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
