/**
 * Numeric building blocks for the TS port of ml/model/transformer_mlx.py's
 * forward pass. Everything here operates on flat, row-major Float32Arrays
 * ([T, D] stored as a single array of length T*D, row t at offset t*D) --
 * no matrix class, this model is small enough that plain typed-array loops
 * are simple and fast enough without one.
 *
 * Every function here is inference-only and has no MLX/gradient equivalent
 * to stay in sync with beyond the forward-pass formulas themselves (see
 * each function's reference back to the Python it mirrors).
 */

import { LAYER_NORM_EPS } from "./config";

export interface LoraParams {
  /** [rank, inFeatures] */
  a: Float32Array;
  /** [outFeatures, rank] */
  b: Float32Array;
  rank: number;
}

/** y = x @ W.T, x: [T, inF], W: [outF, inF] (nn.Linear's weight layout), y: [T, outF]. */
export function linear(x: Float32Array, T: number, inF: number, W: Float32Array, outF: number): Float32Array {
  const y = new Float32Array(T * outF);
  for (let t = 0; t < T; t++) {
    const xOff = t * inF;
    const yOff = t * outF;
    for (let o = 0; o < outF; o++) {
      const wOff = o * inF;
      let sum = 0;
      for (let i = 0; i < inF; i++) sum += x[xOff + i] * W[wOff + i];
      y[yOff + o] = sum;
    }
  }
  return y;
}

function add(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i];
  return out;
}

/** Mirrors bitlinear.py's activation_quant() + its own dequantization --
 * BitLinear's forward always rescales back to float range, per-row (per-
 * token) absmax int8 round-trip, so this returns a float approximation of
 * x, not raw int8 codes. */
export function activationQuantRoundTrip(x: Float32Array, T: number, D: number): Float32Array {
  const EPS = 1e-5;
  const Q_MAX = 127;
  const out = new Float32Array(T * D);
  for (let t = 0; t < T; t++) {
    const off = t * D;
    let rowMax = 0;
    for (let i = 0; i < D; i++) {
      const v = Math.abs(x[off + i]);
      if (v > rowMax) rowMax = v;
    }
    rowMax = Math.max(rowMax, EPS);
    const scale = Q_MAX / rowMax;
    for (let i = 0; i < D; i++) {
      let q = Math.round(x[off + i] * scale);
      if (q > Q_MAX) q = Q_MAX;
      if (q < -Q_MAX - 1) q = -Q_MAX - 1;
      out[off + i] = q / scale;
    }
  }
  return out;
}

/** Mirrors lora.py's LoRALinear.__call__ composed with a BitLinear base:
 * base_out(x_q) + scale*(x @ A.T @ B.T) -- the LoRA path deliberately uses
 * the RAW x, not the activation-quantized version the base path uses (see
 * lora.py: `h = x`, not `h = base's quantized x`). `weight` here is
 * export_web_weights.py's precomputed dense dequantized ternary weight --
 * a fixed matrix at inference time, so no weight quantization needs
 * reimplementing here at all (see that script's module docstring). */
export function bitLinearWithLora(
  x: Float32Array,
  T: number,
  inF: number,
  weight: Float32Array,
  outF: number,
  lora: LoraParams | null,
  loraScale: number,
): Float32Array {
  const xQuant = activationQuantRoundTrip(x, T, inF);
  const out = linear(xQuant, T, inF, weight, outF);
  if (lora) {
    const h = linear(x, T, inF, lora.a, lora.rank);
    const loraOut = linear(h, T, lora.rank, lora.b, outF);
    for (let i = 0; i < out.length; i++) out[i] += loraScale * loraOut[i];
  }
  return out;
}

/** Standard LayerNorm (population variance, learned affine), matching
 * MLX's nn.LayerNorm default eps. */
export function layerNorm(x: Float32Array, T: number, D: number, gamma: Float32Array, beta: Float32Array): Float32Array {
  const out = new Float32Array(T * D);
  for (let t = 0; t < T; t++) {
    const off = t * D;
    let mean = 0;
    for (let i = 0; i < D; i++) mean += x[off + i];
    mean /= D;
    let variance = 0;
    for (let i = 0; i < D; i++) {
      const d = x[off + i] - mean;
      variance += d * d;
    }
    variance /= D;
    const invStd = 1 / Math.sqrt(variance + LAYER_NORM_EPS);
    for (let i = 0; i < D; i++) {
      out[off + i] = (x[off + i] - mean) * invStd * gamma[i] + beta[i];
    }
  }
  return out;
}

// Abramowitz & Stegun 7.1.26 -- max absolute error ~1.5e-7, at the noise
// floor of float32 precision, so effectively exact for this model's weights.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

/** Exact (erf-based) GELU -- matches MLX's default nn.gelu(), not the
 * tanh/sigmoid approximations (nn.gelu_approx / nn.gelu_fast_approx). */
export function gelu(x: Float32Array): Float32Array {
  const invSqrt2 = 1 / Math.SQRT2;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    out[i] = v * 0.5 * (1 + erf(v * invSqrt2));
  }
  return out;
}

export function addResidual(x: Float32Array, delta: Float32Array): Float32Array {
  return add(x, delta);
}

/**
 * Per-layer KV cache for incremental (one-token-at-a-time) decoding.
 *
 * transformer_mlx.py's own generate() (and inference_server.py's copy of
 * it) recomputes attention over the *entire* sequence from scratch on every
 * single generation step -- cheap on MLX's GPU, but this runtime has no
 * such acceleration, and recomputing a growing O(T) prefix at every one of
 * up to 200 steps is O(T^2) total work in plain JS -- far too slow for a
 * serverless function (rough math put it in the hundreds of seconds).
 *
 * The fix is the standard one every real transformer-serving stack uses:
 * cache each layer's key/value projections as they're computed once, and
 * only ever run the *new* token through each layer, attending against the
 * cached keys/values from every earlier position. This is mathematically
 * identical to the full recompute (causal attention only ever looks
 * backward anyway) -- it changes nothing about the output, only how much
 * redundant work it takes to produce it.
 */
export interface LayerCache {
  k: Float32Array; // [maxSeqLen, D]
  v: Float32Array; // [maxSeqLen, D]
  length: number;
}

export function createLayerCache(maxSeqLen: number, D: number): LayerCache {
  return { k: new Float32Array(maxSeqLen * D), v: new Float32Array(maxSeqLen * D), length: 0 };
}

/** Runs one new token's already-ln1-normalized hidden state (length D)
 * through causal self-attention against everything cached so far (which
 * this call also extends by one position), returning the pre-out_proj
 * concatenated-heads output (length D). */
export function causalSelfAttentionStep(
  normedRow: Float32Array,
  D: number,
  nHeads: number,
  headDim: number,
  qkvWeight: Float32Array,
  qkvLora: LoraParams | null,
  loraScale: number,
  cache: LayerCache,
): Float32Array {
  const qkv = bitLinearWithLora(normedRow, 1, D, qkvWeight, 3 * D, qkvLora, loraScale);
  const q = qkv.subarray(0, D);
  const k = qkv.subarray(D, 2 * D);
  const v = qkv.subarray(2 * D, 3 * D);

  const pos = cache.length;
  cache.k.set(k, pos * D);
  cache.v.set(v, pos * D);
  cache.length += 1;
  const T = cache.length;

  const scale = 1 / Math.sqrt(headDim);
  const out = new Float32Array(D);
  const scores = new Float32Array(T);

  for (let h = 0; h < nHeads; h++) {
    const base = h * headDim;
    let maxScore = -Infinity;
    for (let tj = 0; tj < T; tj++) {
      const kOff = tj * D + base;
      let dot = 0;
      for (let d = 0; d < headDim; d++) dot += q[base + d] * cache.k[kOff + d];
      dot *= scale;
      scores[tj] = dot;
      if (dot > maxScore) maxScore = dot;
    }
    let sumExp = 0;
    for (let tj = 0; tj < T; tj++) {
      const e = Math.exp(scores[tj] - maxScore);
      scores[tj] = e;
      sumExp += e;
    }
    for (let d = 0; d < headDim; d++) {
      let acc = 0;
      for (let tj = 0; tj < T; tj++) acc += scores[tj] * cache.v[tj * D + base + d];
      out[base + d] = acc / sumExp;
    }
  }
  return out;
}

export function argmax(x: Float32Array): number {
  let best = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < x.length; i++) {
    if (x[i] > bestVal) {
      bestVal = x[i];
      best = i;
    }
  }
  return best;
}
