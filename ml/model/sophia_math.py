"""
Core Sophia-G update-rule math, in plain numpy.

Sophia ("Sophia: A Scalable Stochastic Second-order Optimizer for Language
Model Pre-training", Liu, Zhang, Basu, Chen, Ma, Liang, Ma & Wang, 2023,
https://arxiv.org/abs/2305.14342) replaces AdamW's "divide by an EMA of
squared gradients" with "divide by a clipped estimate of the diagonal
Hessian" -- a cheap second-order signal that, per the paper, converges in
roughly half the steps AdamW needs at the same model/data scale, with a
per-step compute overhead the paper reports as ~5% (the extra Hessian
estimate only needs recomputing every k steps, not every step).

This module is the framework-agnostic piece: the actual arithmetic of one
optimizer step, verifiable here with plain numpy the same way bitlinear.py
verifies BitNet's quantization math without needing MLX or a GPU. Ported to
MLX (mx.array instead of np.ndarray, wired into an mlx.optimizers.Optimizer
subclass) in sophia.py once this is running on the actual M5 hardware -- the
arithmetic itself doesn't change, only the array library.

Two moving parts, both diagonal (one scalar per parameter, no cross-terms):
  - m: an EMA of the gradient (same as AdamW's first moment).
  - h: an EMA of a diagonal Hessian *estimate* -- not computed every step
    (each estimate needs its own extra forward/backward pass, so this
    module doesn't compute the estimate itself; see sophia.py's
    docstring and train_base.py's gnb_hessian_estimate() for how the
    estimate fed into update_hessian_ema() is actually produced).

The update itself (per parameter, per step):
    update = clip(m / max(rho * h, eps), -1, 1)
    param  = param * (1 - lr * weight_decay) - lr * update

The clip to [-1, 1] before scaling by the learning rate is what makes
Sophia robust to a misestimated or stale Hessian -- even if h is wildly
wrong for some parameter, the worst a single step can move that parameter
is exactly `lr`, the same bound AdamW gives you for free from its own
gradient-magnitude normalization. Unclipped, a too-small h would blow the
update up arbitrarily; clipping turns Sophia into something like a
per-parameter trust-region method instead.
"""

import numpy as np

DEFAULT_EPS = 1e-15


def update_first_moment(m: np.ndarray, grad: np.ndarray, beta1: float) -> np.ndarray:
    """EMA of the gradient -- identical in form to AdamW's first moment."""
    return beta1 * m + (1 - beta1) * grad


def update_hessian_ema(h: np.ndarray, hessian_estimate: np.ndarray, beta2: float) -> np.ndarray:
    """EMA of a diagonal Hessian estimate. Deliberately a *separate* function
    from update_first_moment/sophia_step -- callers only invoke this every
    k steps (the paper's own k=10 default), not every step, since each
    hessian_estimate needs its own extra forward/backward pass to produce
    (see this module's docstring)."""
    return beta2 * h + (1 - beta2) * hessian_estimate


def clipped_update(m: np.ndarray, h: np.ndarray, rho: float, eps: float = DEFAULT_EPS) -> np.ndarray:
    """The pre-learning-rate update direction: m / max(rho*h, eps), clipped
    elementwise to [-1, 1]. Split out from sophia_step() below so the
    clipping behavior itself (the part that makes Sophia robust to a bad
    Hessian estimate) is independently testable."""
    denom = np.maximum(rho * h, eps)
    return np.clip(m / denom, -1.0, 1.0)


def sophia_step(
    param: np.ndarray,
    grad: np.ndarray,
    m: np.ndarray,
    h: np.ndarray,
    lr: float,
    beta1: float = 0.965,
    rho: float = 0.04,
    eps: float = DEFAULT_EPS,
    weight_decay: float = 0.1,
) -> tuple[np.ndarray, np.ndarray]:
    """One full Sophia step for a single parameter tensor, given its current
    Hessian EMA `h` (already updated by update_hessian_ema on whatever cadence
    the caller uses -- this function never updates `h` itself, only reads it).

    Returns (new_param, new_m). h is not returned -- it isn't touched here.

    Decoupled weight decay (param *= (1 - lr*weight_decay) before the main
    update), same convention as AdamW, applied here rather than folded into
    the gradient -- matches the reference Sophia implementation and keeps
    weight decay's effect independent of the Hessian-based step scaling.
    """
    new_m = update_first_moment(m, grad, beta1)
    update = clipped_update(new_m, h, rho, eps)
    decayed_param = param * (1 - lr * weight_decay)
    new_param = decayed_param - lr * update
    return new_param, new_m
