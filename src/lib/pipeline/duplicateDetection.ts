/**
 * Warns a parent before they accidentally double-log the same activity --
 * reuses vectorizeWordDump()/cosineSimilarity() (already built for Stage 2
 * retrieval) rather than adding a second comparison scheme just for this.
 *
 * Deliberately scoped to the SAME CALENDAR DAY only. A parent logging
 * "practiced piano scales" on Monday and again on Wednesday is completely
 * normal -- recurring activities are the common case, not a mistake. The
 * real risk this catches is a double-click, a page refresh mid-submit, or
 * genuinely forgetting a session was already logged a few minutes ago --
 * all same-day, same-wording problems. Comparing against every entry ever
 * logged (not just today's) would flag ordinary recurring practice as a
 * "duplicate" constantly and train parents to ignore the warning.
 */

import { cosineSimilarity, vectorizeWordDump } from "@/lib/pipeline/vectorize";

export type RecentEntryForDuplicateCheck = { id: string; raw_word_dump: string; created_at: string };

/** Above this cosine similarity, two same-day word dumps are close enough
 * in wording that it's worth asking rather than silently logging both --
 * deliberately high: two genuinely different activities in the same
 * subject ("practiced piano scales" vs. "practiced violin scales") should
 * never trigger this. A starting point, not tuned against real
 * accept/decline data yet -- there isn't any until this ships. */
const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;

export type LikelyDuplicate = { entry: RecentEntryForDuplicateCheck; similarity: number };

function isSameCalendarDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * Null when nothing logged today is a close enough match. Picks the single
 * closest match rather than every match over the threshold -- a parent
 * only needs one example to recognize "oh, I already logged this."
 */
export function findLikelyDuplicate(
  rawWordDump: string,
  recentEntries: RecentEntryForDuplicateCheck[],
  now: Date = new Date()
): LikelyDuplicate | null {
  const vector = vectorizeWordDump(rawWordDump);
  if (vector.every((v) => v === 0)) return null;

  const nowIso = now.toISOString();
  let best: LikelyDuplicate | null = null;
  for (const entry of recentEntries) {
    if (!isSameCalendarDay(entry.created_at, nowIso)) continue;
    const similarity = cosineSimilarity(vector, vectorizeWordDump(entry.raw_word_dump));
    if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { entry, similarity };
    }
  }
  return best;
}
