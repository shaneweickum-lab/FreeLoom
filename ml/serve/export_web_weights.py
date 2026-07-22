"""
Exports the trained base model + LoRA adapters into a portable, framework-
agnostic format that a plain (non-MLX) runtime can serve -- specifically, a
pure-TypeScript port running inside FreeLoom's own Vercel deployment, so
Benny no longer depends on a Mac staying on and tunneled to the internet
(see ml/serve/inference_server.py, which this replaces).

MLX-free by design (only needs numpy + safetensors), matching
ml/model/bitlinear.py's "framework agnostic, verifiable in any environment"
approach -- the actual quantization math run here is that file's
weight_quant(), not a reimplementation.

Why this is safe to do once, ahead of time, instead of at serve time: every
BitLinear forward pass in transformer_mlx.py re-quantizes its full-precision
*shadow* weight on every call, but that shadow weight is fixed at inference
time (no gradient updates happening), so the quantized-and-rescaled result
is the same dense float matrix on every single forward call. Baking it once
here removes the need to reimplement weight quantization (or the straight-
through estimator, which only matters for backpropagation) in the serving
runtime at all -- the serving side only ever needs a plain dense matmul for
these, and its own activation quantization (which DOES depend on the actual
input at request time, ported separately in the TS runtime).

Output layout (all in ml/serve/web_weights/, not gitignored):
    base.safetensors            -- token/pos embeddings, every LayerNorm's
                                    weight/bias, and each BitLinear
                                    projection's dequantized dense weight.
    entry_drafting_lora.safetensors / platform_help_lora.safetensors
                                 -- each adapter's LoRA A/B matrices, copied
                                    through unchanged (never quantized in
                                    the first place -- see lora.py).

Usage (on the Mac, after training):
    cd ml/serve
    python3 export_web_weights.py

MLX's nn.Module.save_weights() flattens the module tree with dot-joined
keys and integer list indices (e.g. "blocks.0.attn.qkv.weight") -- this
can't be verified without MLX itself (Apple Silicon-only, doesn't run in
every dev environment), so every lookup below fails with the full list of
keys actually present in the file rather than a bare KeyError, so a naming
mismatch is a two-minute fix instead of a guessing game.
"""

import sys
from pathlib import Path

import numpy as np
from safetensors.numpy import load_file, save_file

sys.path.insert(0, str(Path(__file__).parent.parent / "model"))
from bitlinear import weight_quant  # noqa: E402
from config import BASE_CONFIG  # noqa: E402

CKPT_DIR = Path(__file__).parent.parent / "checkpoints"
OUT_DIR = Path(__file__).parent / "web_weights"

BITLINEAR_PROJECTIONS = ("attn.qkv", "attn.out_proj", "mlp.fc_in", "mlp.fc_out")
LORA_PROJECTIONS = (("attn", "qkv"), ("attn", "out_proj"), ("mlp", "fc_in"), ("mlp", "fc_out"))


def _require(weights: dict, key: str) -> np.ndarray:
    if key not in weights:
        available = "\n  ".join(sorted(weights.keys()))
        raise KeyError(
            f"expected key {key!r} not found in checkpoint. This likely means MLX's "
            f"save_weights() flattening convention differs from what this script assumed "
            f"-- here's every key actually in the file, to fix the naming above:\n  {available}"
        )
    return weights[key]


def export_base(base_checkpoint: Path) -> dict[str, np.ndarray]:
    raw = load_file(str(base_checkpoint))
    out: dict[str, np.ndarray] = {
        "token_emb.weight": _require(raw, "token_emb.weight"),
        "pos_emb.weight": _require(raw, "pos_emb.weight"),
        "ln_f.weight": _require(raw, "ln_f.weight"),
        "ln_f.bias": _require(raw, "ln_f.bias"),
    }
    for i in range(BASE_CONFIG.n_layers):
        for norm in ("ln1", "ln2"):
            out[f"blocks.{i}.{norm}.weight"] = _require(raw, f"blocks.{i}.{norm}.weight")
            out[f"blocks.{i}.{norm}.bias"] = _require(raw, f"blocks.{i}.{norm}.bias")
        for proj in BITLINEAR_PROJECTIONS:
            shadow_weight = _require(raw, f"blocks.{i}.{proj}.weight")
            quantized, scale = weight_quant(shadow_weight)
            out[f"blocks.{i}.{proj}.weight"] = (quantized / scale).astype(np.float32)
    return out


def export_lora(adapter_checkpoint: Path) -> dict[str, np.ndarray]:
    raw = load_file(str(adapter_checkpoint))
    out: dict[str, np.ndarray] = {}
    for i in range(BASE_CONFIG.n_layers):
        for group, proj in LORA_PROJECTIONS:
            for part in ("lora_a", "lora_b"):
                key = f"block{i}.{group}.{proj}.{part}"
                out[key] = _require(raw, key).astype(np.float32)
    return out


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    base_ckpt = CKPT_DIR / "base.safetensors"
    print(f"Exporting base model from {base_ckpt}...")
    base_out = export_base(base_ckpt)
    save_file(base_out, str(OUT_DIR / "base.safetensors"))
    base_bytes = sum(t.nbytes for t in base_out.values())
    print(f"  wrote base.safetensors ({base_bytes / 1e6:.1f} MB, {len(base_out)} tensors)")

    for task in ("entry_drafting", "platform_help"):
        adapter_ckpt = CKPT_DIR / f"{task}_adapter.safetensors"
        print(f"Exporting {task} LoRA adapter from {adapter_ckpt}...")
        lora_out = export_lora(adapter_ckpt)
        out_path = OUT_DIR / f"{task}_lora.safetensors"
        save_file(lora_out, str(out_path))
        lora_bytes = sum(t.nbytes for t in lora_out.values())
        print(f"  wrote {out_path.name} ({lora_bytes / 1e6:.2f} MB, {len(lora_out)} tensors)")

    print(f"\nDone. Output in {OUT_DIR} -- see ml/serve/README.md for the next step "
          f"(bundling these into the Next.js app).")


if __name__ == "__main__":
    main()
