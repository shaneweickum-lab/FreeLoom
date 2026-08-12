import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResearchCitation } from "@/lib/types";
import { matchesKeyword } from "@/lib/keywordMatch";

/**
 * Fetches every row of `research_citations` for keyword-matching against
 * drafted subject tags (see findSupportingCitations below). An explicit
 * .range() is required here -- PostgREST's default response cap is 1000
 * rows, which would otherwise silently truncate this ~5,000-row table to
 * an arbitrary first slice instead of throwing, the same silent-partial-
 * data trap getKnowledgeBase() doesn't have to worry about at that table's
 * much smaller size.
 */
export async function getResearchCitations(supabase: SupabaseClient): Promise<ResearchCitation[]> {
  const { data, error } = await supabase
    .from("research_citations")
    .select("id, title, category, topic, primary_subject, secondary_subject, summary, keywords, source, evidence_level, source_url, created_at")
    .range(0, 9999);
  if (error) throw error;
  return (data as ResearchCitation[]) ?? [];
}

/**
 * Words too short or too generic to mean anything on their own -- matching
 * on these would return citations for nearly every tag regardless of
 * actual topic, the same false-positive risk matchesKeyword's word-boundary
 * check already guards against for single embedded letters.
 */
function significantWords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 4)
    )
  );
}

/**
 * Finds research citations that back up a drafted subject tag -- evidence a
 * parent can point to for why an activity counts as real coursework, not
 * just this pipeline's own say-so. Deliberately keyword matching, the same
 * mechanism (and the same v0 "no neural model" reasoning) as classify.ts's
 * own knowledge-base/heuristic-cluster matching, not a semantic/embedding
 * search -- citations and activities are curated from very different
 * vocabularies (research literature vs. a kid's specific game/hobby), so
 * matching on the tag's own subject area plus whatever literal keyword
 * triggered it is a more honest signal than pretending to rank by
 * relevance by inventing a similarity score neither dataset supports yet.
 *
 * `matchedKeyword` is optional -- a retrieval-stage tag (Stage 2) has no
 * fresh literal phrase from *this* word dump to match on, only whatever a
 * past accepted entry's tag already carried.
 */
export function findSupportingCitations(
  tag: { subjectArea: string; matchedKeyword?: string | null },
  citations: ResearchCitation[],
  limit = 2
): ResearchCitation[] {
  const signals = [
    ...significantWords(tag.subjectArea),
    ...(tag.matchedKeyword ? significantWords(tag.matchedKeyword) : []),
  ];
  if (signals.length === 0 || citations.length === 0) return [];

  const scored = citations
    .map((citation) => {
      const blob = [
        citation.title,
        citation.summary,
        citation.keywords.join(" "),
        citation.category,
        citation.topic,
        citation.primary_subject,
        citation.secondary_subject ?? "",
      ].join(" ");
      const score = signals.filter((word) => matchesKeyword(blob, word)).length;
      return { citation, score };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.citation);
}
