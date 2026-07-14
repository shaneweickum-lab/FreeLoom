"""
Core BitNet b1.58 quantization math, in plain numpy.

This is the piece of the architecture that's framework-agnostic and fully
verifiable without MLX or a GPU: the two quantization functions BitLinear is
built from, matching the formulas in the BitNet b1.58 paper (Ma et al. 2024)
and the "BitNet b1.58 Reloaded" small-scale follow-up.

Ported to MLX (mx.array instead of np.ndarray, plus a straight-through
estimator wired into the autograd graph for training) once this is running
on the actual M5 hardware -- the quantization math itself doesn't change,
only the array library and the addition of a backward pass.

Two quantizations, both applied at every BitLinear forward pass (not a
one-time post-training step):
  - Weights  -> ternary {-1, 0, +1}, absmean scaling (1.58 bits/weight).
  - Activations -> int8, absmax scaling, per token.
"""

import numpy as np

_EPS = 1e-5


def weight_quant(w: np.ndarray) -> tuple[np.ndarray, float]:
    """Ternary-quantizes a weight matrix.

    Returns (quantized_weights in {-1, 0, 1}, scale) such that
    quantized_weights * scale ~= w. Scale is a single scalar per tensor
    (absmean of the whole matrix), per the BitNet b1.58 paper.
    """
    scale = 1.0 / max(np.abs(w).mean(), _EPS)
    quantized = np.clip(np.round(w * scale), -1, 1)
    return quantized, scale


def activation_quant(x: np.ndarray, num_bits: int = 8) -> tuple[np.ndarray, np.ndarray]:
    """Per-row (per-token) absmax int8 quantization of activations.

    Returns (quantized int values, per-row scale) such that
    quantized / scale ~= x. x is expected shape (..., d_model); the scale is
    computed per leading-dim row so one large-magnitude token doesn't blow
    out the quantization range for every other token in the batch.
    """
    q_max = 2 ** (num_bits - 1) - 1
    row_max = np.abs(x).max(axis=-1, keepdims=True)
    scale = q_max / np.clip(row_max, _EPS, None)
    quantized = np.clip(np.round(x * scale), -q_max - 1, q_max)
    return quantized, scale


def bitlinear_forward(x: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Emulates one BitLinear layer's forward pass: quantize both operands,
    matmul in the quantized domain, then rescale back to the original range.

    This models inference-time BitLinear exactly. It also stands in for the
    forward half of training-time BitLinear -- the straight-through estimator
    that lets gradients flow through the round()/clip() steps only matters
    for the backward pass, which numpy has no autograd to demonstrate; that
    part is written directly in the MLX training code instead.
    """
    w_quant, w_scale = weight_quant(w)
    x_quant, x_scale = activation_quant(x)
    out_quant = x_quant @ w_quant.T
    return out_quant / (w_scale * x_scale)


def dequantize_error(x: np.ndarray, w: np.ndarray) -> float:
    """Relative error between the quantized BitLinear forward pass and a
    full-precision matmul, for sanity-checking a given weight/activation
    distribution's quantization behavior."""
    exact = x @ w.T
    approx = bitlinear_forward(x, w)
    return float(np.linalg.norm(approx - exact) / max(np.linalg.norm(exact), _EPS))
