/**
 * Client-side WebLLM engine orchestration -- the one place a loaded model
 * instance actually gets created and handed out. Two named roles:
 *
 * - "chat": Benny assistant-mode chat panel.
 * - "pipeline": the background classify-pipeline drafting call (Stage 4).
 *
 * By design, per the architecture decision behind this batch, these are
 * two SEPARATE concurrently-loaded engine instances, not one shared
 * engine -- accepted knowingly as a real GPU-memory/OOM risk on modest
 * devices, which is why loadEngine() below falls back to sharing whichever
 * engine DID load successfully rather than leaving a role with nothing.
 *
 * Nothing in this file can be exercised by this project's test suite:
 * there is no WebGPU device in Node/CI. Every decision that CAN be pure
 * (device capability -> which model variant, mobile -> which tier) lives
 * in capabilities.ts instead and is tested there. This file is the thin,
 * necessarily-untested layer that calls the real WebLLM API -- verify it
 * in an actual browser, not by trusting that it compiles.
 */

import { CreateMLCEngine, type InitProgressCallback, type MLCEngine } from "@mlc-ai/web-llm";
import { detectWebGpuCapability, pickQuantVariant } from "./capabilities";
import type { ModelTier } from "./models";

export type BennyEngineRole = "chat" | "pipeline";

export type BennyEngineResult =
  | { engine: MLCEngine; sharedFallback: boolean }
  | { engine: null; reason: "unsupported-device" | "load-failed" };

/** Caches the RESULT (not just a successfully-loaded engine) per role, so
 * an "unsupported-device" or "load-failed" outcome is remembered too --
 * without this, a role that failed once would re-probe WebGPU and retry
 * a doomed CreateMLCEngine() call on every single caller for the rest of
 * the page session. Call resetBennyEngine() (e.g. from a UI "Retry"
 * button) to deliberately allow another attempt. */
const engineResults = new Map<BennyEngineRole, Promise<BennyEngineResult>>();

async function loadEngine(
  role: BennyEngineRole,
  tier: ModelTier,
  onProgress?: InitProgressCallback
): Promise<BennyEngineResult> {
  const capability = await detectWebGpuCapability();
  const variant = pickQuantVariant(tier, capability);
  if (!variant) return { engine: null, reason: "unsupported-device" };

  const modelId = tier.modelIds[variant];

  try {
    const engine = await CreateMLCEngine(modelId, { initProgressCallback: onProgress });
    return { engine, sharedFallback: false };
  } catch (err) {
    console.error(`Benny (${role}) failed to load ${modelId}:`, err);

    // The real case this branch exists for: loading a SECOND concurrent
    // instance is what's actually expected to OOM on a modest device (see
    // this file's header comment). If some OTHER role already has a
    // working engine loaded, share it instead of leaving this role with
    // nothing -- sharing a stronger tier than a role strictly needed
    // (chat falling back to the pipeline instance's Llama) degrades
    // fine; the reverse (pipeline sharing chat's Qwen) is a weaker
    // drafting model than intended but still better than no draft at all.
    for (const [otherRole, otherResult] of engineResults) {
      if (otherRole === role) continue;
      const resolved = await otherResult;
      if (resolved.engine) return { engine: resolved.engine, sharedFallback: true };
    }

    return { engine: null, reason: "load-failed" };
  }
}

/**
 * Returns (loading if necessary) the engine for `role`. Safe to call
 * repeatedly and concurrently -- a second caller while the first load is
 * still in flight gets the same in-progress promise rather than starting
 * a second CreateMLCEngine() race for the same role.
 */
export function getBennyEngine(
  role: BennyEngineRole,
  tier: ModelTier,
  onProgress?: InitProgressCallback
): Promise<BennyEngineResult> {
  const cached = engineResults.get(role);
  if (cached) return cached;

  const promise = loadEngine(role, tier, onProgress);
  engineResults.set(role, promise);
  return promise;
}

/** Clears a role's cached outcome so the next getBennyEngine() call
 * genuinely retries instead of replaying a remembered failure -- does
 * NOT unload an already-successfully-loaded engine for that role (there's
 * nothing wrong with it); only useful after an "unsupported-device" or
 * "load-failed" result a user has explicitly asked to retry. */
export function resetBennyEngine(role: BennyEngineRole): void {
  engineResults.delete(role);
}

/** Releases every loaded engine's WebGPU resources. Call on sign-out or
 * when Benny is disabled -- not casually, since reloading afterward means
 * a full re-init (though not a re-download; the model weights stay
 * cached by the browser's own Cache API regardless of this). */
export async function unloadAllBennyEngines(): Promise<void> {
  const results = await Promise.all(engineResults.values());
  engineResults.clear();
  const engines = new Set(results.map((r) => r.engine).filter((e): e is MLCEngine => e !== null));
  await Promise.all([...engines].map((engine) => engine.unload().catch((err) => console.error("Benny engine unload failed:", err))));
}
