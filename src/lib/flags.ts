/** This codebase has no feature-flag system yet -- the established pattern
 * elsewhere is a bare presence/existence check (e.g. RESEND_API_KEY gating
 * whether an email actually sends). Two small named functions below, not a
 * generic framework -- still not enough flags to justify one. */

import { hasWeights } from "@/lib/benny/inference/weights";

/** Stage 4 SLM entry-drafting fallback (docs/slm-strategy.md Section 6/8).
 * On by definition once the entry_drafting adapter's weight files are
 * bundled with this deployment (src/lib/benny/inference/) -- inference now
 * runs in-process (see src/lib/pipeline/slmDraft.ts), no external server or
 * env var configuration needed. Missing weight files (the default until
 * ml/serve/export_web_weights.py's output is committed) means every call
 * site behaves exactly as it did before this feature existed. */
export function isSlmEntryDraftingEnabled(): boolean {
  return hasWeights("entry_drafting");
}

/** Benny assistant-mode chat backend, same reasoning as above but for the
 * platform_help adapter. Missing weight files means src/lib/benny/chat.ts
 * always returns its placeholder reply instead of running inference -- the
 * Settings toggle and chat UI are fully real and usable regardless,
 * per-user opt-in is independent of whether the model weights are bundled
 * yet. */
export function isSlmChatEnabled(): boolean {
  return hasWeights("platform_help");
}
