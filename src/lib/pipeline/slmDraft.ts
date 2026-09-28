/**
 * Stage 4 fallback: when Stage 1-3 all miss, ask the entry-drafting adapter
 * for a candidate instead of handing the parent a blank form. Per
 * docs/slm-strategy.md Section 6/8: feature-flagged, never overrides a
 * confident Stage 1-3 result (only ever called from the branch where none
 * of them matched), and never bypasses Stage 5 -- the candidate only ever
 * pre-fills the same manual-resolution form a parent already reviews/edits/
 * accepts (src/app/(app)/log/page.tsx), it never gets written to `entries`
 * on its own.
 *
 * Runs in-process (src/lib/benny/inference/) rather than calling out to an
 * external server -- MLX (what the model was trained with) is Apple
 * Silicon-only and can't run in this app's own Vercel/Node runtime, but
 * inference-only forward passes don't need MLX at all, so
 * ml/serve/export_web_weights.py bakes the trained weights into a portable
 * format a plain TS port can run directly. See that directory's README for
 * how the weight files get bundled here. isSlmEntryDraftingEnabled() is
 * false (and this always resolves to null, identical to "Stage 1-3 found
 * nothing") until those files are actually present.
 */

import { isSlmEntryDraftingEnabled } from "@/lib/flags";
import { draftEntry } from "@/lib/benny/inference/model";
import { agreesWithClassicalClassifier } from "@/lib/pipeline/subjectClassifier";
import { validateDraftCandidate, type DraftCandidate } from "@/lib/pipeline/draftValidation";
import type { ExtractedSlots } from "@/lib/pipeline/classify";

export { validateDraftCandidate };
export type { DraftCandidate, ClassifyResultWithDraft } from "@/lib/pipeline/draftValidation";

/** Runs the entry-drafting adapter in-process, if its weight files are
 * bundled with this deployment. Best-effort: not-yet-bundled, an unparseable
 * generation, or an out-of-range result all resolve to null, identical to
 * Stage 1-3 finding nothing -- the caller falls through to today's blank
 * Stage 5 form either way, never a broken UI over this being unavailable.
 *
 * `extractedSlots` is accepted for contract compatibility with this
 * function's existing callers, but (same as the model was actually trained)
 * only rawWordDump feeds the prompt -- see model.ts's draftEntry().
 */
export async function callEntryDraftingAdapter(input: {
  rawWordDump: string;
  extractedSlots: ExtractedSlots;
}): Promise<DraftCandidate | null> {
  if (!isSlmEntryDraftingEnabled()) return null;

  try {
    const result = draftEntry(input.rawWordDump);
    if (!result) return null;
    const candidate: DraftCandidate = {
      subjectArea: result.subjectArea,
      courseTitle: result.courseTitle,
      creditValue: result.creditValue,
      rationale: result.rationale,
    };
    if (!validateDraftCandidate(candidate)) return null;
    // Section 7's second safeguard: an independent classical signal has to
    // agree the subject is at least plausible before this draft is trusted
    // -- a substantial disagreement flags for human review the same way a
    // shape-validation failure does, rather than trusting the SLM silently.
    if (!agreesWithClassicalClassifier(candidate.subjectArea, input.rawWordDump)) return null;
    return candidate;
  } catch (err) {
    console.error("entry-drafting adapter call failed:", err);
    return null;
  }
}
