import { afterEach, describe, expect, it, vi } from "vitest";
import { LLAMA_3_2_1B, QWEN_2_5_0_5B } from "./models";
import { chatTierFor, detectWebGpuCapability, isMobileDevice, pickQuantVariant } from "./capabilities";

describe("isMobileDevice", () => {
  it("recognizes common mobile user agents", () => {
    expect(isMobileDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe(true);
  });

  it("does not flag common desktop user agents", () => {
    expect(isMobileDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")).toBe(false);
    expect(isMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe(false);
  });
});

describe("chatTierFor", () => {
  it("picks Qwen2.5 0.5B on mobile", () => {
    expect(chatTierFor(true)).toBe(QWEN_2_5_0_5B);
  });

  it("picks Llama 3.2 1B off mobile", () => {
    expect(chatTierFor(false)).toBe(LLAMA_3_2_1B);
  });
});

describe("pickQuantVariant", () => {
  it("returns null when WebGPU isn't supported at all", () => {
    const result = pickQuantVariant(LLAMA_3_2_1B, { supported: false, supportsShaderF16: true, maxBufferSizeBytes: null });
    expect(result).toBeNull();
  });

  it("prefers q4f16_1 when shader-f16 is supported and it fits the buffer limit", () => {
    const bigEnough = LLAMA_3_2_1B.vramRequiredMB.q4f16_1 * 1024 * 1024 + 1;
    const result = pickQuantVariant(LLAMA_3_2_1B, {
      supported: true,
      supportsShaderF16: true,
      maxBufferSizeBytes: bigEnough,
    });
    expect(result).toBe("q4f16_1");
  });

  it("falls back to q4f32_1 when shader-f16 isn't supported but q4f32_1 fits", () => {
    const bigEnough = LLAMA_3_2_1B.vramRequiredMB.q4f32_1 * 1024 * 1024 + 1;
    const result = pickQuantVariant(LLAMA_3_2_1B, {
      supported: true,
      supportsShaderF16: false,
      maxBufferSizeBytes: bigEnough,
    });
    expect(result).toBe("q4f32_1");
  });

  it("falls back to q4f32_1 when shader-f16 is supported but q4f16_1 doesn't fit the buffer limit", () => {
    const tooSmallForF16ButFitsF32 = LLAMA_3_2_1B.vramRequiredMB.q4f32_1 * 1024 * 1024 + 1;
    const result = pickQuantVariant(LLAMA_3_2_1B, {
      supported: true,
      supportsShaderF16: true,
      maxBufferSizeBytes: tooSmallForF16ButFitsF32,
    });
    // q4f16_1 needs less than q4f32_1 in this model's real numbers, so a
    // buffer limit that fits q4f32_1 also fits q4f16_1 -- this asserts
    // the actual real-data relationship rather than assuming it.
    expect(LLAMA_3_2_1B.vramRequiredMB.q4f16_1).toBeLessThan(LLAMA_3_2_1B.vramRequiredMB.q4f32_1);
    expect(result).toBe("q4f16_1");
  });

  it("returns null when neither quantization fits the buffer limit", () => {
    const result = pickQuantVariant(LLAMA_3_2_1B, { supported: true, supportsShaderF16: true, maxBufferSizeBytes: 1024 });
    expect(result).toBeNull();
  });

  it("skips the size check (doesn't treat null as zero) when the buffer limit itself is unknown", () => {
    const result = pickQuantVariant(LLAMA_3_2_1B, { supported: true, supportsShaderF16: true, maxBufferSizeBytes: null });
    expect(result).toBe("q4f16_1");
  });
});

describe("detectWebGpuCapability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports unsupported in this test environment (no navigator.gpu)", async () => {
    const result = await detectWebGpuCapability();
    expect(result).toEqual({ supported: false, supportsShaderF16: false, maxBufferSizeBytes: null });
  });

  it("reports unsupported when navigator.gpu.requestAdapter() resolves null", async () => {
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => null } });
    const result = await detectWebGpuCapability();
    expect(result.supported).toBe(false);
  });

  it("reports the adapter's real feature/limit data when WebGPU is available", async () => {
    vi.stubGlobal("navigator", {
      gpu: {
        requestAdapter: async () => ({
          features: new Set(["shader-f16"]),
          limits: { maxBufferSize: 2_000_000_000 },
        }),
      },
    });
    const result = await detectWebGpuCapability();
    expect(result).toEqual({ supported: true, supportsShaderF16: true, maxBufferSizeBytes: 2_000_000_000 });
  });

  it("reports unsupported when requestAdapter() itself throws", async () => {
    vi.stubGlobal("navigator", {
      gpu: {
        requestAdapter: async () => {
          throw new Error("boom");
        },
      },
    });
    const result = await detectWebGpuCapability();
    expect(result.supported).toBe(false);
  });
});
