/// <reference types="@webgpu/types" />
/**
 * Device capability detection for WebLLM -- kept separate from engine.ts
 * so the actual decision logic (which quantization fits, which tier to
 * use) is plain, synchronous, and unit-testable, with only the raw
 * browser probing (detectWebGpuCapability) needing a real browser to
 * exercise. That split matters here specifically: nothing in this whole
 * WebLLM subsystem can be verified end-to-end in a Node/CI environment --
 * there's no WebGPU device to load a real model against -- so keeping the
 * actual decisions pure is what makes any of this testable at all.
 */

import { LLAMA_3_2_1B, QWEN_2_5_0_5B, type ModelTier, type QuantVariant } from "./models";

export type WebGpuCapability = {
  supported: boolean;
  /** Needed to pick q4f16_1 over q4f32_1 -- absent (false) on some mobile
   * GPUs and older/software WebGPU implementations. */
  supportsShaderF16: boolean;
  /** From the adapter's reported limits (maxBufferSize), when available.
   * Null when WebGPU itself isn't supported at all -- distinct from "0",
   * which would incorrectly read as "definitely too small for anything." */
  maxBufferSizeBytes: number | null;
};

const UNSUPPORTED: WebGpuCapability = { supported: false, supportsShaderF16: false, maxBufferSizeBytes: null };

/** The one function in this file that needs a real browser -- `navigator`
 * doesn't exist in Node/vitest, and even in a browser, WebGPU may not.
 * Every other function here takes a WebGpuCapability as a plain argument
 * instead of calling this itself, specifically so they stay testable
 * without mocking global browser APIs. */
export async function detectWebGpuCapability(): Promise<WebGpuCapability> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return UNSUPPORTED;

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return UNSUPPORTED;

    return {
      supported: true,
      supportsShaderF16: adapter.features.has("shader-f16"),
      maxBufferSizeBytes: adapter.limits.maxBufferSize,
    };
  } catch (err) {
    console.error("WebGPU capability detection failed:", err);
    return UNSUPPORTED;
  }
}

/** Common mobile-device signal strings across iOS/iPadOS/Android --
 * intentionally a heuristic (there is no reliable, universal "is this a
 * phone" browser API), used only to choose a smaller default model, never
 * for anything security- or correctness-sensitive. A misdetection in
 * either direction just means a device gets the other tier's model --
 * never a broken app. */
const MOBILE_USER_AGENT_PATTERN = /Android|iPhone|iPad|iPod|Mobile/i;

export function isMobileDevice(userAgent: string): boolean {
  return MOBILE_USER_AGENT_PATTERN.test(userAgent);
}

/** Which model tier chat should use -- Qwen on mobile (smaller download),
 * Llama everywhere else. The background classify-pipeline instance always
 * uses Llama regardless of device, since it never runs on mobile at all
 * (see engine.ts). */
export function chatTierFor(isMobile: boolean): ModelTier {
  return isMobile ? QWEN_2_5_0_5B : LLAMA_3_2_1B;
}

/**
 * Picks the best quantization this device can actually run, or null if
 * neither fits. Prefers q4f16_1 (smaller download) whenever the adapter
 * supports shader-f16 AND its reported buffer limit covers that
 * quantization's VRAM requirement; falls back to q4f32_1 on the same
 * limit check; null means this tier genuinely won't run on this device
 * (caller should treat that the same as "WebGPU unsupported" -- disable
 * the feature, don't attempt to load anyway and surface a crash).
 *
 * `maxBufferSizeBytes: null` (WebGPU probing itself failed/unsupported)
 * skips the size check entirely rather than treating null as "unlimited"
 * or "zero" -- callers should already have short-circuited on
 * `capability.supported === false` before this ever runs.
 */
export function pickQuantVariant(tier: ModelTier, capability: WebGpuCapability): QuantVariant | null {
  if (!capability.supported) return null;

  const fitsBuffer = (variant: QuantVariant): boolean => {
    if (capability.maxBufferSizeBytes === null) return true;
    const requiredBytes = tier.vramRequiredMB[variant] * 1024 * 1024;
    return requiredBytes <= capability.maxBufferSizeBytes;
  };

  if (capability.supportsShaderF16 && fitsBuffer("q4f16_1")) return "q4f16_1";
  if (fitsBuffer("q4f32_1")) return "q4f32_1";
  return null;
}
