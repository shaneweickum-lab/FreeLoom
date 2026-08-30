/**
 * The models Benny now runs on: Llama-3.2-1B-Instruct for desktop/tablet
 * (both assistant-mode chat and the background classify-pipeline drafting
 * WebLLM instance), Qwen2.5-0.5B-Instruct for chat specifically on mobile
 * -- see AGENTS.md/the architecture decision this batch implements for why
 * FreeLoom's own hand-trained BitNet model (src/lib/benny/inference/) is
 * dormant rather than deleted: this is a deliberate, temporary swap to a
 * stronger off-the-shelf model while better training infrastructure gets
 * built, not a permanent architectural direction.
 *
 * Every id/number below is read directly out of the installed
 * @mlc-ai/web-llm package's own prebuiltAppConfig (verified against
 * node_modules/@mlc-ai/web-llm/lib/index.js at the version this project
 * pins), not invented -- q4f16_1 is the standard 4-bit quantization (the
 * smaller download, needs the "shader-f16" WebGPU feature); q4f32_1 is the
 * fallback for a GPU that lacks shader-f16 support.
 *
 * ON "AUTO-REFRESH": @mlc-ai/web-llm ties its prebuilt model libraries to
 * the installed npm package version (see `modelVersion` in the package's
 * own config.ts) -- a model build cannot silently change out from under a
 * running app without a code change, by MLC's own design (an old runtime
 * and a new model lib aren't guaranteed compatible). So "the model stays
 * automatically refreshed" cannot mean "polls some registry in the
 * background" -- that isn't a real mechanism this library exposes, and
 * building a fake one would be actively misleading. What it DOES mean,
 * and what this file is the one place to change for: bump the
 * `@mlc-ai/web-llm` dependency and the ids/vram numbers below together in
 * a deploy, and every visitor gets the new model automatically on their
 * next page load -- no separate client-side update mechanism needed,
 * because a fresh deploy already ships a fresh bundle.
 */

export type QuantVariant = "q4f16_1" | "q4f32_1";

export type ModelTier = {
  /** model_id for each quantization this tier supports, in the exact
   * strings @mlc-ai/web-llm's prebuiltAppConfig.model_list expects. */
  modelIds: Record<QuantVariant, string>;
  /** ModelRecord.vram_required_MB for each quantization, straight from
   * prebuiltAppConfig -- used to pre-flight-check a device's reported
   * WebGPU buffer limit before ever attempting CreateMLCEngine(), rather
   * than finding out via a thrown device-lost error mid-load. */
  vramRequiredMB: Record<QuantVariant, number>;
  /** Human-readable label for Settings > About and any loading UI. */
  label: string;
};

/** Desktop/tablet tier -- both the assistant-mode chat instance and the
 * background classify-pipeline drafting instance run this on capable
 * devices. */
export const LLAMA_3_2_1B: ModelTier = {
  modelIds: {
    q4f16_1: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    q4f32_1: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
  },
  vramRequiredMB: {
    q4f16_1: 879.04,
    q4f32_1: 1128.82,
  },
  label: "Llama 3.2 1B",
};

/** Mobile tier -- chat only (see capabilities.ts's chatTierFor()). Notably
 * NOT smaller than Llama 3.2 1B in reported VRAM (944.62MB vs 879.04MB at
 * q4f16_1, per MLC's own numbers) despite having half the parameters --
 * the real win here is a smaller download, not a smaller runtime memory
 * footprint, so this tier exists for mobile data-cost reasons, not because
 * it definitively fits where Llama wouldn't. */
export const QWEN_2_5_0_5B: ModelTier = {
  modelIds: {
    q4f16_1: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    q4f32_1: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
  },
  vramRequiredMB: {
    q4f16_1: 944.62,
    q4f32_1: 1060.2,
  },
  label: "Qwen2.5 0.5B",
};
