"""
MLX wiring for Sophia-G (see sophia_math.py for the paper citation and the
core update-rule math, which is what's actually verified in this sandbox --
this file only translates that already-tested arithmetic into an
mlx.optimizers.Optimizer subclass and the mlx.core array calls that plumbing
needs).

NOTE: authored without access to Apple Silicon/MLX in this sandbox (same
caveat as train_base.py's mx.compile usage) -- this class has never actually
run. Verify it on the M5 (a short --tiny-scale run first, same as any other
change to the training loop) before trusting it for a real multi-day run.

Two update paths, matching the reference Sophia implementation (not a single
`apply_single` the way plain SGD/Adam work):
  - update(model, grads): every step, moves each parameter using whatever
    Hessian estimate `h` is currently stored -- this is the normal
    optimizer.update() call in a training loop, same call site AdamW used.
  - update_hessian(hessian_estimate): every k steps only (the paper's own
    k=10 default), folds a freshly computed Hessian diagonal estimate into
    the EMA that update()'s steps read from. The estimate itself needs its
    own extra forward/backward pass on resampled labels (Gauss-Newton-
    Bartlett -- see train_base.py's gnb_hessian_estimate()), which is why
    this can't just happen inside apply_single() like a normal optimizer
    step: apply_single() only ever sees one gradient array, with no way to
    trigger a second forward pass of its own.
"""

import mlx.core as mx
from mlx.optimizers import Optimizer
from mlx.utils import tree_map

from sophia_math import DEFAULT_EPS


def _is_param_state(node) -> bool:
    """tree_map's is_leaf predicate for walking self.state: state's own
    natural leaves are the per-parameter {"m": ..., "h": ...} dicts this
    optimizer's init_single() creates, not the raw arrays one level down --
    without this, tree_map would try to recurse into and rebuild those
    dicts as if they were more nested structure to descend through."""
    return isinstance(node, dict) and "h" in node and "m" in node


class SophiaG(Optimizer):
    """Sophia-G (sophia_math.py has the full paper citation + reasoning).

    betas=(0.965, 0.99): the paper's own defaults for LM pretraining
    (beta1 for the gradient EMA, beta2 for the Hessian EMA) -- deliberately
    not reusing AdamW's usual (0.9, 0.999), since Sophia's beta2 governs an
    EMA that's only refreshed every hessian_update_interval steps, not
    every step, so it needs to be read differently than an ordinary
    every-step second-moment EMA would be.
    rho=0.04: the clipping-threshold hyperparameter (sophia_math.py's
    clipped_update()) -- the paper's own default for its LM pretraining runs.
    weight_decay=0.1: decoupled weight decay, applied the same way AdamW's
    is -- the paper's own default for pretraining-scale runs.
    """

    def __init__(
        self,
        learning_rate,
        betas: tuple[float, float] = (0.965, 0.99),
        rho: float = 0.04,
        eps: float = DEFAULT_EPS,
        weight_decay: float = 0.1,
    ):
        super().__init__()
        self.learning_rate = learning_rate
        self.betas = betas
        self.rho = rho
        self.eps = eps
        self.weight_decay = weight_decay

    def init_single(self, parameter: mx.array, state: dict):
        state["m"] = mx.zeros_like(parameter)
        state["h"] = mx.zeros_like(parameter)

    def apply_single(self, gradient: mx.array, parameter: mx.array, state: dict):
        beta1, _ = self.betas
        lr = self.learning_rate

        m = beta1 * state["m"] + (1 - beta1) * gradient
        state["m"] = m

        denom = mx.maximum(self.rho * state["h"], self.eps)
        update = mx.clip(m / denom, -1.0, 1.0)

        decayed = parameter * (1 - lr * self.weight_decay)
        return decayed - lr * update

    def update_hessian(self, hessian_estimate):
        """Call every hessian_update_interval steps (train_base.py's
        training loop), NOT every step -- see this module's docstring.
        hessian_estimate must be a pytree matching the model's own
        parameter tree (e.g. the output of gnb_hessian_estimate()), one
        squared-gradient array per parameter, same shapes init_single()
        was called with.

        Mutates each per-parameter state dict in place (state_leaf["h"] =
        ...) rather than reassigning self.state wholesale -- the same
        convention apply_single() above already relies on. mx.compile's
        train_step (train_base.py) closes over self.state by reference at
        compile time; rebuilding a new tree and reassigning self.state
        here would silently detach it from that already-compiled
        reference instead of actually updating what train_step reads.
        tree_map's return value is discarded on purpose -- this call is
        for its side effect (walking hessian_estimate and self.state in
        parallel), not for a new tree."""
        _, beta2 = self.betas

        def fold_into_ema(estimate_leaf, state_leaf):
            state_leaf["h"] = beta2 * state_leaf["h"] + (1 - beta2) * estimate_leaf
            return None

        tree_map(fold_into_ema, hessian_estimate, self.state, is_leaf=_is_param_state)
