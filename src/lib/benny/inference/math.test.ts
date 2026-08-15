import { describe, expect, it } from "vitest";
import {
  activationQuantRoundTrip,
  addResidual,
  argmax,
  bitLinearWithLora,
  causalSelfAttentionStep,
  createLayerCache,
  gelu,
  layerNorm,
  linear,
  type LoraParams,
} from "./math";

describe("linear", () => {
  it("computes x @ W.T for a single row against an identity matrix", () => {
    const x = new Float32Array([1, 2]);
    const identity = new Float32Array([1, 0, 0, 1]); // [outF=2, inF=2]
    expect(Array.from(linear(x, 1, 2, identity, 2))).toEqual([1, 2]);
  });

  it("treats each row of a multi-row input independently", () => {
    const x = new Float32Array([1, 0, 0, 1]); // T=2, inF=2
    const swap = new Float32Array([0, 1, 1, 0]); // [outF=2, inF=2] -- swaps the two components
    expect(Array.from(linear(x, 2, 2, swap, 2))).toEqual([0, 1, 1, 0]);
  });

  it("supports a non-square weight matrix (projecting to a different output width)", () => {
    const x = new Float32Array([1, 1]);
    const W = new Float32Array([1, 1, 2, 2, 3, 3]); // [outF=3, inF=2]
    expect(Array.from(linear(x, 1, 2, W, 3))).toEqual([2, 4, 6]);
  });
});

describe("activationQuantRoundTrip", () => {
  it("round-trips a value that lands exactly on the int8 grid with no loss", () => {
    // rowMax=2 -> scale=127/2=63.5; 2*63.5=127 and -2*63.5=-127, both exact.
    const x = new Float32Array([2, -2]);
    const out = activationQuantRoundTrip(x, 1, 2);
    expect(out[0]).toBeCloseTo(2, 6);
    expect(out[1]).toBeCloseTo(-2, 6);
  });

  it("quantizes each row against its own max, not a shared/global one", () => {
    const x = new Float32Array([4, 0, 0, 1]); // row0 max=4, row1 max=1
    const out = activationQuantRoundTrip(x, 2, 2);
    // row0: 4 -> scale=127/4=31.75 -> round(4*31.75)=127 -> 127/31.75=4 exact
    expect(out[0]).toBeCloseTo(4, 6);
    expect(out[1]).toBeCloseTo(0, 6);
    // row1: 1 -> scale=127 -> round(1*127)=127 -> 127/127=1 exact
    expect(out[3]).toBeCloseTo(1, 6);
  });

  it("never produces a value further from the input than the int8 quantization step allows", () => {
    const x = new Float32Array([0.3, -0.7, 0.1]);
    const out = activationQuantRoundTrip(x, 1, 3);
    for (let i = 0; i < 3; i++) expect(Math.abs(out[i] - x[i])).toBeLessThan(0.02);
  });

  it("clamps rather than overflows for the maximal-magnitude element in a row", () => {
    // The element defining rowMax always quantizes to +/-127 (or -128 floor), never out of int8 range.
    const x = new Float32Array([5, -5, 2]);
    const out = activationQuantRoundTrip(x, 1, 3);
    expect(out[0]).toBeCloseTo(5, 4);
  });
});

describe("bitLinearWithLora", () => {
  const identity = new Float32Array([1, 0, 0, 1]);

  it("matches a plain quantized linear projection when no LoRA adapter is attached", () => {
    const x = new Float32Array([2, -2]);
    const out = bitLinearWithLora(x, 1, 2, identity, 2, null, 1.0);
    const expected = linear(activationQuantRoundTrip(x, 1, 2), 1, 2, identity, 2);
    expect(Array.from(out)).toEqual(Array.from(expected));
  });

  it("adds the LoRA path on top of the base path, scaled by loraScale", () => {
    const x = new Float32Array([2, -2]);
    const lora: LoraParams = {
      // A: [rank=1, inF=2], B: [outF=2, rank=1]
      a: new Float32Array([1, 0]),
      b: new Float32Array([1, 1]),
      rank: 1,
    };
    const withLora = bitLinearWithLora(x, 1, 2, identity, 2, lora, 2.0);
    const withoutLora = bitLinearWithLora(x, 1, 2, identity, 2, null, 2.0);
    // LoRA path: h = x @ A.T = [2] (only the first component of x, since A=[1,0]);
    // loraOut = h @ B.T = [2, 2]; scaled by loraScale=2 -> [4, 4] added on top.
    expect(withLora[0]).toBeCloseTo(withoutLora[0] + 4, 4);
    expect(withLora[1]).toBeCloseTo(withoutLora[1] + 4, 4);
  });

  it("the LoRA path uses the raw (unquantized) input, not the base path's quantized version", () => {
    // A value that quantizes lossily (rowMax isn't a clean divisor of 127)
    // still passes its exact raw value through the LoRA branch.
    const x = new Float32Array([0.31]);
    const baseWeight = new Float32Array([0]); // [outF=1, inF=1], zeroed so only LoRA contributes
    const lora: LoraParams = { a: new Float32Array([1]), b: new Float32Array([1]), rank: 1 };
    const out = bitLinearWithLora(x, 1, 1, baseWeight, 1, lora, 1.0);
    expect(out[0]).toBeCloseTo(0.31, 5);
  });
});

describe("layerNorm", () => {
  it("normalizes a row to zero mean and unit variance before applying gamma/beta", () => {
    const x = new Float32Array([1, 2, 3, 4]);
    const gamma = new Float32Array([1, 1, 1, 1]);
    const beta = new Float32Array([0, 0, 0, 0]);
    const out = layerNorm(x, 1, 4, gamma, beta);
    // mean=2.5, variance=1.25 -> invStd ~= 1/sqrt(1.25)
    const invStd = 1 / Math.sqrt(1.25);
    expect(out[0]).toBeCloseTo((1 - 2.5) * invStd, 4);
    expect(out[3]).toBeCloseTo((4 - 2.5) * invStd, 4);
  });

  it("applies the learned affine (gamma scale, beta shift) after normalizing", () => {
    const x = new Float32Array([1, 2, 3, 4]);
    const gamma = new Float32Array([2, 2, 2, 2]);
    const beta = new Float32Array([10, 10, 10, 10]);
    const withAffine = layerNorm(x, 1, 4, gamma, beta);
    const withoutAffine = layerNorm(x, 1, 4, new Float32Array([1, 1, 1, 1]), new Float32Array([0, 0, 0, 0]));
    for (let i = 0; i < 4; i++) expect(withAffine[i]).toBeCloseTo(withoutAffine[i] * 2 + 10, 4);
  });

  it("normalizes each row independently", () => {
    const x = new Float32Array([1, 1, 5, 5]); // row0: zero variance, row1: also zero variance but different mean
    const gamma = new Float32Array([1, 1]);
    const beta = new Float32Array([0, 0]);
    const out = layerNorm(x, 2, 2, gamma, beta);
    // Zero-variance rows normalize to 0 (up to the epsilon in invStd).
    expect(out[0]).toBeCloseTo(0, 3);
    expect(out[2]).toBeCloseTo(0, 3);
  });
});

describe("gelu", () => {
  it("is exactly 0 at 0", () => {
    expect(gelu(new Float32Array([0]))[0]).toBeCloseTo(0, 6);
  });

  it("approaches the identity for large positive inputs", () => {
    const out = gelu(new Float32Array([5]));
    expect(out[0]).toBeCloseTo(5, 3);
  });

  it("approaches 0 for large negative inputs", () => {
    const out = gelu(new Float32Array([-5]));
    expect(out[0]).toBeCloseTo(0, 3);
  });

  it("is exactly half its input at 0 by definition, so a small input is roughly half itself", () => {
    // gelu(x) = x * Phi(x); Phi(0) = 0.5.
    const out = gelu(new Float32Array([0.0001]));
    expect(out[0]).toBeCloseTo(0.0001 * 0.5, 5);
  });
});

describe("addResidual", () => {
  it("adds two vectors elementwise", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([10, 20, 30]);
    expect(Array.from(addResidual(a, b))).toEqual([11, 22, 33]);
  });
});

describe("argmax", () => {
  it("returns the index of the largest value", () => {
    expect(argmax(new Float32Array([1, 5, 3]))).toBe(1);
  });

  it("returns the first index on a tie", () => {
    expect(argmax(new Float32Array([2, 2, 1]))).toBe(0);
  });

  it("handles negative values correctly", () => {
    expect(argmax(new Float32Array([-5, -1, -3]))).toBe(1);
  });
});

describe("createLayerCache + causalSelfAttentionStep", () => {
  // Identity Q/K/V projections (3 stacked [D,D] identity blocks) so each
  // token's own quantized input passes straight through as its q/k/v --
  // makes the expected attention output computable by hand.
  const D = 2;
  const identityQkvWeight = new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]); // [3*D=6, D=2]

  it("for a single cached position, attention output is exactly that position's own value vector", () => {
    const cache = createLayerCache(4, D);
    // [2, -2] round-trips exactly through int8 quantization (see math tests above).
    const out = causalSelfAttentionStep(new Float32Array([2, -2]), D, 1, D, identityQkvWeight, null, 1.0, cache);
    expect(out[0]).toBeCloseTo(2, 4);
    expect(out[1]).toBeCloseTo(-2, 4);
    expect(cache.length).toBe(1);
  });

  it("attends most strongly to the position whose key best matches the new query", () => {
    const cache = createLayerCache(4, D);
    causalSelfAttentionStep(new Float32Array([2, -2]), D, 1, D, identityQkvWeight, null, 1.0, cache);
    // Second token's query is nearly orthogonal to the first token's key but
    // exactly matches its own -- softmax should overwhelmingly favor itself.
    const out = causalSelfAttentionStep(new Float32Array([0, 4]), D, 1, D, identityQkvWeight, null, 1.0, cache);
    expect(out[0]).toBeCloseTo(0, 2);
    expect(out[1]).toBeCloseTo(4, 2);
    expect(cache.length).toBe(2);
  });

  it("extends the cache by exactly one position per call", () => {
    const cache = createLayerCache(4, D);
    expect(cache.length).toBe(0);
    causalSelfAttentionStep(new Float32Array([1, 0]), D, 1, D, identityQkvWeight, null, 1.0, cache);
    expect(cache.length).toBe(1);
    causalSelfAttentionStep(new Float32Array([0, 1]), D, 1, D, identityQkvWeight, null, 1.0, cache);
    expect(cache.length).toBe(2);
  });
});
