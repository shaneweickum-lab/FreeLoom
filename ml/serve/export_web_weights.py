"""
Exports the trained base model + LoRA adapters into a portable, framework-
agnostic format that a plain (non-MLX) runtime can serve -- specifically, a
pure-TypeScript port running inside FreeLoom's own Vercel deployment, so
Benny no longer depends on a Mac staying on and tunneled to the internet
(see ml/serve/inference_server.py, which this replaces).

MLX-free by design (only needs numpy + safetensors).

v0.8 simplification: v0.7 and earlier trained native BitNet ternary weights
(model/bitlinear.py's weight_quant(), now superseded), so this file had to
dequantize each BitLinear projection's full-precision shadow weight into a
dense matrix before handing it to the TS runtime. v0.8's DenseLinear
(transformer_mlx.py) already IS a plain dense matrix -- nothing to
dequantize, just cast bf16 -> float32 (the TS runtime has no native bf16
support any more than plain numpy does) and copy through unchanged.

UNVERIFIED on real hardware: whether safetensors.numpy.load_file can even
read a bf16-dtype tensor at all (plain numpy has no native bfloat16 type;
this may need the `ml_dtypes` package's bfloat16 registered with numpy, or
MLX's own save path may already upcast on write) is genuinely untested --
this is new territory v0.7's ternary checkpoints never exercised (BitLinear
saved its full-precision *shadow* weights, not bf16 tensors). Confirm this
actually loads before trusting the rest of this script on a real v0.8
checkpoint.

Output layout (all in ml/serve/web_weights/, not gitignored):
    base.safetensors            -- token/pos embeddings, every LayerNorm's
                                    weight/bias, and each DenseLinear
                                    projection's weight, all as float32.
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
from config import BASE_CONFIG  # noqa: E402

CKPT_DIR = Path(__file__).parent.parent / "checkpoints"
OUT_DIR = Path(__file__).parent / "web_weights"

DENSE_PROJECTIONS = ("attn.qkv", "attn.out_proj", "mlp.fc_in", "mlp.fc_out")
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
    token_emb = _require(raw, "token_emb.weight").astype(np.float32)
    out: dict[str, np.ndarray] = {
        "token_emb.weight": token_emb,
        "pos_emb.weight": _require(raw, "pos_emb.weight").astype(np.float32),
        # v0.8's transformer_mlx.py ties these genuinely (references
        # self.token_emb.weight directly at the point of use, no second
        # attribute to diverge -- see that file's own doc comment for why
        # v0.7's aliasing approach didn't actually stay tied under MLX's
        # autograd). Only one real array exists in the checkpoint; exported
        # twice here under both keys purely so the TS runtime's existing
        # "lm_head_weight" key keeps working unchanged.
        "lm_head_weight": token_emb.copy(),
        "ln_f.weight": _require(raw, "ln_f.weight").astype(np.float32),
        "ln_f.bias": _require(raw, "ln_f.bias").astype(np.float32),
    }
    for i in range(BASE_CONFIG.n_layers):
        for norm in ("ln1", "ln2"):
            out[f"blocks.{i}.{norm}.weight"] = _require(raw, f"blocks.{i}.{norm}.weight").astype(np.float32)
            out[f"blocks.{i}.{norm}.bias"] = _require(raw, f"blocks.{i}.{norm}.bias").astype(np.float32)
        for proj in DENSE_PROJECTIONS:
            out[f"blocks.{i}.{proj}.weight"] = _require(raw, f"blocks.{i}.{proj}.weight").astype(np.float32)
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
