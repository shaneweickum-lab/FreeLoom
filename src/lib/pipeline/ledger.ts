/**
 * The per-subject credit ledger the left rail shows: one row per subject,
 * summing every entry_subject_tags row that landed under it. Routes through
 * sumCredits() (see credit-calculation.ts) rather than adding floats
 * directly, for the same reason that file exists -- naive float summation
 * drifts silently over enough rows, and this is exactly the kind of running
 * total that bug originally hit.
 */

import { sumCredits } from "@/lib/pipeline/credit-calculation";

export type LedgerTag = { subjectArea: string; creditValue: number };

export type SubjectLedgerRow = { subjectArea: string; creditHours: number };

/** Groups tags by subject and sums each group's credit safely. Order of the
 * returned rows follows each subject's first appearance in `tags`. */
export function computeSubjectLedger(tags: LedgerTag[]): SubjectLedgerRow[] {
  const orderedSubjects: string[] = [];
  const valuesBySubject = new Map<string, number[]>();

  for (const tag of tags) {
    if (!valuesBySubject.has(tag.subjectArea)) {
      orderedSubjects.push(tag.subjectArea);
      valuesBySubject.set(tag.subjectArea, []);
    }
    valuesBySubject.get(tag.subjectArea)!.push(tag.creditValue);
  }

  return orderedSubjects.map((subjectArea) => ({
    subjectArea,
    creditHours: sumCredits(valuesBySubject.get(subjectArea)!),
  }));
}
