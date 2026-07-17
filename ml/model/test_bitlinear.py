import numpy as np
import pytest

from bitlinear import activation_quant, bitlinear_forward, dequantize_error, weight_quant


def test_weight_quant_is_ternary():
    rng = np.random.default_rng(0)
    w = rng.normal(size=(64, 32))
    quantized, scale = weight_quant(w)
    assert set(np.unique(quantized).tolist()) <= {-1.0, 0.0, 1.0}
    assert scale > 0


def test_weight_quant_scale_matches_absmean_formula():
    w = np.array([[1.0, -2.0, 0.0, 4.0]])
    expected_scale = 1.0 / (np.abs(w).mean())
    _, scale = weight_quant(w)
    assert scale == pytest.approx(expected_scale)


def test_weight_quant_preserves_sign_for_large_magnitudes():
    w = np.array([[10.0, -10.0, 0.001, -0.001]])
    quantized, _ = weight_quant(w)
    assert quantized[0, 0] == 1.0
    assert quantized[0, 1] == -1.0


def test_weight_quant_handles_all_zero_matrix():
    w = np.zeros((4, 4))
    quantized, scale = weight_quant(w)
    assert np.all(quantized == 0.0)
    assert np.isfinite(scale)


def test_activation_quant_int8_range():
    rng = np.random.default_rng(1)
    x = rng.normal(scale=5.0, size=(8, 16))
    quantized, scale = activation_quant(x, num_bits=8)
    assert quantized.max() <= 127
    assert quantized.min() >= -128
    assert scale.shape == (8, 1)


def test_activation_quant_per_row_scale_independence():
    x = np.array([[1.0, 2.0, 3.0], [100.0, 200.0, 300.0]])
    quantized, scale = activation_quant(x)
    assert scale[0, 0] != scale[1, 0]
    dequantized = quantized / scale
    assert dequantized == pytest.approx(x, rel=0.05)


def test_activation_quant_handles_zero_row():
    x = np.zeros((2, 4))
    quantized, scale = activation_quant(x)
    assert np.all(quantized == 0.0)
    assert np.isfinite(scale).all()


def test_bitlinear_forward_shape():
    rng = np.random.default_rng(2)
    x = rng.normal(size=(5, 16))
    w = rng.normal(size=(32, 16))
    out = bitlinear_forward(x, w)
    assert out.shape == (5, 32)


def test_bitlinear_forward_approximates_full_precision_matmul():
    rng = np.random.default_rng(3)
    x = rng.normal(size=(20, 64))
    w = rng.normal(size=(48, 64))
    error = dequantize_error(x, w)
    # Ternary weight quantization is lossy by design; this just guards
    # against a broken implementation (e.g. wrong scale, transposed axes)
    # producing wildly divergent output, not against expected quantization
    # noise itself.
    assert error < 0.6


def test_bitlinear_forward_deterministic():
    rng = np.random.default_rng(4)
    x = rng.normal(size=(3, 8))
    w = rng.normal(size=(6, 8))
    out1 = bitlinear_forward(x, w)
    out2 = bitlinear_forward(x, w)
    np.testing.assert_array_equal(out1, out2)
