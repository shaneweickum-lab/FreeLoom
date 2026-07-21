/** This codebase has no feature-flag system yet -- the established pattern
 * elsewhere is a bare `process.env.X` presence check (e.g. RESEND_API_KEY
 * gating whether an email actually sends). Two small named functions below,
 * not a generic framework -- still not enough flags to justify one. */

/** Stage 4 SLM entry-drafting fallback (docs/slm-strategy.md Section 6/8).
 * On by definition once SLM_ENTRY_DRAFTING_URL is configured -- there's
 * nothing useful to toggle independently of "is there an endpoint to call."
 * Unset (the default in every environment today, since no such endpoint
 * exists yet) means every call site behaves exactly as it did before this
 * feature existed. */
export function isSlmEntryDraftingEnabled(): boolean {
  return !!process.env.SLM_ENTRY_DRAFTING_URL;
}

/** Benny assistant-mode chat backend. On by definition once SLM_CHAT_URL is
 * configured, same reasoning as above. Unset (every environment today, since
 * no such endpoint exists yet) means src/lib/benny/chat.ts always returns
 * its placeholder reply instead of calling out anywhere -- the Settings
 * toggle and chat UI are fully real and usable regardless, per-user opt-in
 * is independent of whether a real model is listening yet. */
export function isSlmChatEnabled(): boolean {
  return !!process.env.SLM_CHAT_URL;
}
