/** This codebase has no feature-flag system yet -- the established pattern
 * elsewhere is a bare `process.env.X` presence check (e.g. RESEND_API_KEY
 * gating whether an email actually sends). This is the first named flag,
 * kept as one small function rather than a generic framework until a
 * second flag actually needs one. */

/** Stage 4 SLM entry-drafting fallback (docs/slm-strategy.md Section 6/8).
 * On by definition once SLM_ENTRY_DRAFTING_URL is configured -- there's
 * nothing useful to toggle independently of "is there an endpoint to call."
 * Unset (the default in every environment today, since no such endpoint
 * exists yet) means every call site behaves exactly as it did before this
 * feature existed. */
export function isSlmEntryDraftingEnabled(): boolean {
  return !!process.env.SLM_ENTRY_DRAFTING_URL;
}
