/**
 * Stage 4's shape/range validation (docs/slm-strategy.md Section 7's first
 * safeguard) -- pulled out of slmDraft.ts into its own module specifically
 * so it has NO dependency on src/lib/benny/inference/ (which reads bundled
 * weight files off disk via node:fs, and so can only ever run server-side).
 * Both the dormant server-side path (slmDraft.ts, re-exports from here)
 * and the live client-side WebLLM path (webllmDraft.ts) validate a
 * drafted candidate through this exact same function -- "same guardrails,
 * different generator" only holds if there's truly one shared
 * implementation, not two copies that can drift.
 */

import type { ClassifyResult } from "@/lib/pipeline/classify";

export type DraftCandidate = {
  subjectArea: string;
  courseTitle: string;
  creditValue: number;
  rationale: string;
};

/** What the classify API route returns once Stage 4 pre-fills a candidate
 * -- every existing ClassifyResult shape, plus an optional draft candidate
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
 * case." Shape/range only -- the second safeguard (cross-checking the
 * drafted subject_area against the classical classifier) is a separate,
 * independent check; see agreesWithClassicalClassifier() in
 * pipeline/subjectClassifier.ts, called from each generator-specific
 * caller (slmDraft.ts, webllmDraft.ts) rather than folded into this
 * function, since Section 7 treats them as two distinct signals, not one
 * combined validity check. */
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
