/**
 * Stage 4 fallback: when Stage 1-3 all miss, ask the entry-drafting SLM
 * adapter for a candidate instead of handing the parent a blank form. Per
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
import type { ClassifyResult, ExtractedSlots } from "@/lib/pipeline/classify";

export type DraftCandidate = {
  subjectArea: string;
  courseTitle: string;
  creditValue: number;
  rationale: string;
};

/** What the classify API route actually returns once Stage 4 is wired in --
 * every existing ClassifyResult shape, plus an optional draft candidate
 * that's only ever present on the NeedsHumanReview branch. Kept as an
 * augmentation rather than a change to ClassifyResult itself so
 * classify.ts (Stage 1) stays exactly as unaware of Stage 4 as its own
 * header comment already says every other caller should be. */
export type ClassifyResultWithDraft = ClassifyResult & { draftCandidate?: DraftCandidate | null };

// Mirrors ml/eval/validate_output.py's validate_draft() -- same rules, TS
// side, since a draft that fails this check needs to fall through to Stage
// 5 before it ever reaches the UI, not after a round-trip through Python.
// Keep these two in sync if either changes.
const MIN_CREDIT_VALUE = 0.05;
const MAX_CREDIT_VALUE = 1.0;
const MIN_RATIONALE_LEN = 20;
const MIN_COURSE_TITLE_LEN = 4;
const GENERIC_TITLE_PHRASES = new Set(["learning skills", "general studies", "misc activity", "activity"]);

/** docs/slm-strategy.md Section 7's first safeguard: "reject a draft that
 * doesn't have a valid subject_area, a plausible credit_value, or all
 * required fields; fall through to Stage 5 same as any other low-confidence
 * case." No classical-subject-area cross-check here yet -- that classifier
 * (Section 1/7) doesn't exist in this codebase yet either (see
 * ml/README.md's known gaps); wire that in here once it does. */
export function validateDraftCandidate(candidate: unknown): candidate is DraftCandidate {
  if (!candidate || typeof candidate !== "object") return false;
  const c = candidate as Record<string, unknown>;

  if (typeof c.subjectArea !== "string" || !c.subjectArea.trim()) return false;
  if (typeof c.courseTitle !== "string" || !c.courseTitle.trim()) return false;
  if (typeof c.rationale !== "string" || !c.rationale.trim()) return false;
  if (typeof c.creditValue !== "number" || Number.isNaN(c.creditValue)) return false;

  const courseTitle = c.courseTitle.trim();
  if (courseTitle.length < MIN_COURSE_TITLE_LEN) return false;
  if (GENERIC_TITLE_PHRASES.has(courseTitle.toLowerCase())) return false;

  if (c.rationale.trim().length < MIN_RATIONALE_LEN) return false;
  if (c.creditValue < MIN_CREDIT_VALUE || c.creditValue > MAX_CREDIT_VALUE) return false;

  return true;
}

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
    return validateDraftCandidate(candidate) ? candidate : null;
  } catch (err) {
    console.error("entry-drafting adapter call failed:", err);
    return null;
  }
}
