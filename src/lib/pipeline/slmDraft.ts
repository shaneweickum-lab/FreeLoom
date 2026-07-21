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
 * IMPORTANT constraint this file works around: the trained model only runs
 * via MLX, which is Apple Silicon/Metal-only -- it cannot execute inside
 * this app's own Vercel/Node runtime (confirmed: ml/README.md's own
 * "Mac-only (MLX/Apple Silicon)" column). So this doesn't call MLX
 * directly; it calls out to SLM_ENTRY_DRAFTING_URL, a small HTTP inference
 * endpoint that doesn't exist yet -- nothing currently listens there. Once
 * something is actually serving this exact contract (see
 * callEntryDraftingAdapter's request/response shape below) and the env var
 * points at it, this feature works end-to-end with no further TS changes.
 * Until then, isSlmEntryDraftingEnabled() is false and this always resolves
 * to null -- identical to today's "Stage 1-3 found nothing" behavior.
 */

import { isSlmEntryDraftingEnabled } from "@/lib/flags";
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

const REQUEST_TIMEOUT_MS = 5000;

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

/** Calls the entry-drafting adapter's inference endpoint, if configured.
 * Best-effort: not-configured, a network error, a timeout, or a malformed/
 * invalid response all resolve to null, identical to Stage 1-3 finding
 * nothing -- the caller falls through to today's blank Stage 5 form either
 * way, never a broken UI over this being unavailable.
 *
 * Request contract (POST {SLM_ENTRY_DRAFTING_URL}/entry-draft):
 *   { raw_word_dump: string, extracted_slots: ExtractedSlots }
 * Expected response (whatever's listening should return this shape):
 *   { subject_area: string, course_title: string, credit_value: number, rationale: string }
 */
export async function callEntryDraftingAdapter(input: {
  rawWordDump: string;
  extractedSlots: ExtractedSlots;
}): Promise<DraftCandidate | null> {
  if (!isSlmEntryDraftingEnabled()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${process.env.SLM_ENTRY_DRAFTING_URL}/entry-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_word_dump: input.rawWordDump, extracted_slots: input.extractedSlots }),
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const data = await res.json();
    const candidate: DraftCandidate = {
      subjectArea: data.subject_area,
      courseTitle: data.course_title,
      creditValue: Number(data.credit_value),
      rationale: data.rationale,
    };
    return validateDraftCandidate(candidate) ? candidate : null;
  } catch (err) {
    console.error("entry-drafting adapter call failed:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
