"""
Independent numpy reference for src/lib/benny/inference/'s TS port of the
transformer forward pass -- reads the exact same exported weights
(export_web_weights.py's output) and runs the same math, so the two
implementations can be compared token-for-token on identical input.

This exists because the TS port has to be trusted without ever running the
real MLX model side-by-side (MLX only runs on the Mac; the TS port only
really matters once deployed) -- this script is the thing that actually
proves the port is faithful, by giving both implementations the same
weights and checking they produce the same generated tokens. Worth
re-running after any change to either side, or after every retrain (a
config.py mismatch here is exactly the kind of bug run_web_port_check.mjs
compares against).

No MLX dependency (same reasoning as export_web_weights.py) -- only numpy,
safetensors, and the `tokenizers` Python package already in requirements.txt.

Usage:
    python3 verify_web_port.py --task entry_drafting --prompt "activity: fixed a bike chain\\n" --max-new-tokens 20
    python3 verify_web_port.py --task platform_help --prompt "question: how does this platform work?\\n" --max-new-tokens 20
"""

import argparse
import math
import sys
from pathlib import Path

import numpy as np
from safetensors.numpy import load_file
from tokenizers import Tokenizer

sys.path.insert(0, str(Path(__file__).parent.parent / "model"))
from config import BASE_CONFIG, LORA_ALPHA, LORA_RANK  # noqa: E402
from bitlinear import activation_quant  # noqa: E402

WEIGHTS_DIR = Path(__file__).parent.parent.parent / "src" / "lib" / "benny" / "inference" / "weights"
TOKENIZER_PATH = Path(__file__).parent.parent / "tokenizer" / "tokenizer.json"

LORA_SCALE = LORA_ALPHA / LORA_RANK
_erf = np.vectorize(math.erf)


def gelu(x: np.ndarray) -> np.ndarray:
    return x * 0.5 * (1 + _erf(x / math.sqrt(2)))


def layer_norm(x: np.ndarray, gamma: np.ndarray, beta: np.ndarray, eps: float = 1e-5) -> np.ndarray:
    mean = x.mean(axis=-1, keepdims=True)
    var = x.var(axis=-1, keepdims=True)
    return (x - mean) / np.sqrt(var + eps) * gamma + beta


def bitlinear_with_lora(x: np.ndarray, weight: np.ndarray, lora: dict | None) -> np.ndarray:
    x_quant_int, x_scale = activation_quant(x)
    x_quant = x_quant_int / x_scale
    out = x_quant @ weight.T
    if lora is not None:
        h = x @ lora["a"].T
        lora_out = h @ lora["b"].T
        out = out + LORA_SCALE * lora_out
    return out


def causal_self_attention(qkv: np.ndarray, n_heads: int, head_dim: int) -> np.ndarray:
    T, threeD = qkv.shape
    D = threeD // 3
    q, k, v = qkv[:, :D], qkv[:, D : 2 * D], qkv[:, 2 * D :]
    q = q.reshape(T, n_heads, head_dim).transpose(1, 0, 2)
    k = k.reshape(T, n_heads, head_dim).transpose(1, 0, 2)
    v = v.reshape(T, n_heads, head_dim).transpose(1, 0, 2)

    scale = 1.0 / math.sqrt(head_dim)
    scores = (q @ k.transpose(0, 2, 1)) * scale
    mask = np.triu(np.full((T, T), -np.inf, dtype=np.float32), k=1)
    scores = scores + mask
    scores = scores - scores.max(axis=-1, keepdims=True)
    weights = np.exp(scores)
    weights = weights / weights.sum(axis=-1, keepdims=True)
    out = weights @ v  # (n_heads, T, head_dim)
    return out.transpose(1, 0, 2).reshape(T, D)


def load_weights(task: str):
    base = load_file(str(WEIGHTS_DIR / "base.safetensors"))
    adapter = load_file(str(WEIGHTS_DIR / f"{task}_lora.safetensors"))
    return base, adapter


def lora_for(adapter: dict, i: int, group: str, proj: str) -> dict:
    return {"a": adapter[f"block{i}.{group}.{proj}.lora_a"], "b": adapter[f"block{i}.{group}.{proj}.lora_b"]}


def forward(token_ids: list[int], base: dict, adapter: dict) -> np.ndarray:
    T = len(token_ids)
    D = BASE_CONFIG.d_model
    positions = np.arange(T)
    x = base["token_emb.weight"][token_ids] + base["pos_emb.weight"][positions]

    for i in range(BASE_CONFIG.n_layers):
        ln1 = layer_norm(x, base[f"blocks.{i}.ln1.weight"], base[f"blocks.{i}.ln1.bias"])
        qkv = bitlinear_with_lora(ln1, base[f"blocks.{i}.attn.qkv.weight"], lora_for(adapter, i, "attn", "qkv"))
        attn_concat = causal_self_attention(qkv, BASE_CONFIG.n_heads, BASE_CONFIG.head_dim)
        attn_out = bitlinear_with_lora(
            attn_concat, base[f"blocks.{i}.attn.out_proj.weight"], lora_for(adapter, i, "attn", "out_proj")
        )
        x = x + attn_out

        ln2 = layer_norm(x, base[f"blocks.{i}.ln2.weight"], base[f"blocks.{i}.ln2.bias"])
        h = bitlinear_with_lora(ln2, base[f"blocks.{i}.mlp.fc_in.weight"], lora_for(adapter, i, "mlp", "fc_in"))
        activated = gelu(h)
        mlp_out = bitlinear_with_lora(
            activated, base[f"blocks.{i}.mlp.fc_out.weight"], lora_for(adapter, i, "mlp", "fc_out")
        )
        x = x + mlp_out

    x = layer_norm(x, base["ln_f.weight"], base["ln_f.bias"])
    return x @ base["token_emb.weight"].T


# Greedy decoding can fall into a stable repetition loop on some prompts --
# confirmed real (not a bug in either implementation) by this script
# reproducing the exact same stuck token as src/lib/benny/inference/model.ts's
# generate() despite this one recomputing from scratch every step with no
# KV cache at all. Mirrored in that file and ml/serve/inference_server.py --
# keep all three in sync.
MAX_CONSECUTIVE_REPEATS = 3


def generate(prompt_ids: list[int], max_new_tokens: int, base: dict, adapter: dict, eos_id: int) -> list[int]:
    ids = list(prompt_ids)
    generated = []
    last_token = None
    repeat_count = 0
    for _ in range(max_new_tokens):
        logits = forward(ids, base, adapter)
        next_id = int(np.argmax(logits[-1]))
        if next_id == last_token:
            repeat_count += 1
            if repeat_count >= MAX_CONSECUTIVE_REPEATS:
                break
        else:
            last_token = next_id
            repeat_count = 1
        generated.append(next_id)
        ids.append(next_id)
        if next_id == eos_id:
            break
    return generated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=["entry_drafting", "platform_help"], required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--max-new-tokens", type=int, default=20)
    args = parser.parse_args()

    tokenizer = Tokenizer.from_file(str(TOKENIZER_PATH))
    bos_id = tokenizer.token_to_id("<bos>")
    eos_id = tokenizer.token_to_id("<eos>")

    base, adapter = load_weights(args.task)
    prompt_ids = [bos_id] + tokenizer.encode(args.prompt).ids
    generated_ids = generate(prompt_ids, args.max_new_tokens, base, adapter, eos_id)

    print("generated_ids:", generated_ids)
    print("decoded:", tokenizer.decode(generated_ids, skip_special_tokens=False))


if __name__ == "__main__":
    main()
