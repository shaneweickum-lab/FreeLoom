import numpy as np
import pytest

from sophia_math import clipped_update, sophia_step, update_first_moment, update_hessian_ema


def test_update_first_moment_matches_ema_formula():
    m = np.array([1.0, -2.0, 0.0])
    grad = np.array([2.0, 2.0, 5.0])
    beta1 = 0.9
    expected = beta1 * m + (1 - beta1) * grad
    assert np.allclose(update_first_moment(m, grad, beta1), expected)


def test_update_first_moment_converges_toward_grad_over_many_steps():
    grad = np.array([3.0, -4.0])
    m = np.zeros(2)
    for _ in range(500):
        m = update_first_moment(m, grad, beta1=0.9)
    assert np.allclose(m, grad, atol=1e-3)


def test_update_hessian_ema_matches_ema_formula():
    h = np.array([0.1, 0.2])
    estimate = np.array([1.0, 4.0])
    beta2 = 0.99
    expected = beta2 * h + (1 - beta2) * estimate
    assert np.allclose(update_hessian_ema(h, estimate, beta2), expected)


def test_clipped_update_stays_within_bounds_even_with_tiny_hessian():
    # A near-zero h with a large m is exactly the failure mode clipping
    # protects against -- without the clip, this ratio would be enormous.
    m = np.array([1e6, -1e6, 1e6])
    h = np.array([1e-20, 1e-20, 1e-20])
    update = clipped_update(m, h, rho=0.04)
    assert np.all(np.abs(update) <= 1.0)


def test_clipped_update_is_proportional_when_within_range():
    m = np.array([0.01])
    h = np.array([1.0])
    rho = 0.04
    expected = m / (rho * h)  # well within [-1, 1], so no clipping should occur
    update = clipped_update(m, h, rho)
    assert np.allclose(update, expected)
    assert np.all(np.abs(update) < 1.0)


def test_clipped_update_handles_all_zero_hessian_without_dividing_by_zero():
    m = np.array([5.0, -5.0, 0.0])
    h = np.zeros(3)
    update = clipped_update(m, h, rho=0.04, eps=1e-15)
    assert np.all(np.isfinite(update))
    assert np.all(np.abs(update) <= 1.0)


def test_sophia_step_applies_decoupled_weight_decay():
    param = np.array([2.0])
    grad = np.array([0.0])
    m = np.array([0.0])
    h = np.array([1.0])
    lr = 0.1
    weight_decay = 0.5
    new_param, _ = sophia_step(param, grad, m, h, lr, beta1=0.9, rho=0.04, weight_decay=weight_decay)
    # With zero gradient, m stays 0 and the clipped update is 0 -- the only
    # change to param should be decoupled weight decay: param*(1-lr*wd).
    expected = param * (1 - lr * weight_decay)
    assert np.allclose(new_param, expected)


def test_sophia_step_moves_param_opposite_the_gradient_direction():
    param = np.array([0.0])
    grad = np.array([1.0])  # positive gradient
    m = np.array([0.0])
    h = np.array([1.0])
    new_param, new_m = sophia_step(param, grad, m, h, lr=0.1, beta1=0.9, rho=0.04, weight_decay=0.0)
    assert new_param[0] < 0  # moved down, away from the positive gradient
    assert new_m[0] == pytest.approx(0.1)  # (1 - beta1) * grad, since m started at 0


def test_sophia_step_never_moves_a_single_parameter_by_more_than_lr():
    # The whole point of the clip -- a pathologically small/wrong Hessian
    # estimate still can't blow up a single step past the learning rate.
    param = np.array([0.0])
    grad = np.array([1e9])
    m = np.array([0.0])
    h = np.array([1e-30])
    lr = 0.01
    new_param, _ = sophia_step(param, grad, m, h, lr, weight_decay=0.0)
    assert abs(new_param[0]) <= lr + 1e-12
