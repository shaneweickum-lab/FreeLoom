/**
 * Stage 2 (retrieve). Starts out with nothing to find — retrieval_cases
 * only gets a row the moment a real entry is accepted (see /log and
 * src/app/(app)/log/page.tsx's submitManualResolution/decide) — and grows
 * automatically from there with no separate authoring step, exactly as the
 * spec describes.
 *
 * Scope: per child only. A family's matches only ever come from their own
 * child's accepted history, never another family's — see the RLS on
 * retrieval_cases/entries, which match_retrieval_case relies on rather than
 * re-implementing that boundary here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { vectorizeWordDump } from "@/lib/pipeline/vectorize";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any>;

/** One subject tag as it was actually accepted -- the shape a retrieval
 * match hands back is exactly what a future similar word dump should draft
 * again. Plural now: an accepted entry can carry more than one subject
 * tag (see classify.ts), and a retrieval match reuses every one of them,
 * not just the first. */
export type AcceptedOutputSnapshot = {
  tags: { subjectArea: string; courseTitle: string; creditValue: number; reasoning: string }[];
};

export type RetrievalMatch = {
  entryId: string;
  snapshot: AcceptedOutputSnapshot;
  similarity: number;
};

const DEFAULT_MATCH_THRESHOLD = 0.75;

/** Finds the closest prior accepted entry for this child, if any clears the similarity threshold. */
export async function findRetrievalMatch(
  supabase: Supa,
  studentId: string,
  rawWordDump: string,
  matchThreshold: number = DEFAULT_MATCH_THRESHOLD
): Promise<RetrievalMatch | null> {
  const queryVector = vectorizeWordDump(rawWordDump);

  const { data, error } = await supabase.rpc("match_retrieval_case", {
    p_student_id: studentId,
    p_query_vector: queryVector,
    p_match_threshold: matchThreshold,
  });

  if (error) {
    console.error("match_retrieval_case RPC failed", error);
    return null;
  }
  const row = data?.[0] as { entry_id: string; accepted_output_snapshot: AcceptedOutputSnapshot; similarity: number } | undefined;
  if (!row) return null;

  return { entryId: row.entry_id, snapshot: row.accepted_output_snapshot, similarity: row.similarity };
}

/** Call once an entry is genuinely accepted — this is the only place retrieval_cases ever gets a new row. */
export async function recordRetrievalCase(
  supabase: Supa,
  entryId: string,
  rawWordDump: string,
  snapshot: AcceptedOutputSnapshot
): Promise<void> {
  const { error } = await supabase.from("retrieval_cases").insert({
    entry_id: entryId,
    word_dump_vector: vectorizeWordDump(rawWordDump),
    accepted_output_snapshot: snapshot,
  });
  if (error) console.error("Failed to record retrieval case", error);
}
