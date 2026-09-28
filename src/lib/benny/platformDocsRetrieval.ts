/**
 * RAG retrieval over platformDocs.ts's chunks, for Benny assistant-mode
 * chat -- reuses the exact same hashed-vector approach
 * (vectorizeWordDump/cosineSimilarity) already built for Stage 2
 * retrieval, rather than adding a second embedding scheme or an external
 * vector-store dependency for what's a genuinely small, static corpus.
 * Chunk vectors are computed once at module load (the corpus is static
 * data, not DB-backed), same pattern as subjectClassifier.ts's
 * buildPrototypes().
 */

import { cosineSimilarity, vectorizeWordDump } from "@/lib/pipeline/vectorize";
import { PLATFORM_DOC_CHUNKS, type PlatformDocChunk } from "./platformDocs";

/** Below this cosine similarity, no chunk is a confident enough match to
 * be worth injecting as "relevant documentation" -- a hashed, keyword-
 * built chunk vector is a coarse signal, and forcing an unrelated chunk
 * into the prompt on a low-confidence guess risks the model treating
 * clearly irrelevant text as authoritative just because it was labeled
 * documentation. A starting point, not tuned against real chat logs,
 * since none exist yet -- see subjectClassifier.ts's own
 * MIN_CONFIDENT_SIMILARITY for the same reasoning applied to Stage 4. */
const MIN_CONFIDENT_SIMILARITY = 0.15;

const MAX_CHUNKS = 3;

const CHUNK_VECTORS: { chunk: PlatformDocChunk; vector: number[] }[] = PLATFORM_DOC_CHUNKS.map((chunk) => ({
  chunk,
  vector: vectorizeWordDump(`${chunk.heading} ${chunk.text}`),
}));

export type RetrievedDoc = { chunk: PlatformDocChunk; similarity: number };

/** Returns up to MAX_CHUNKS chunks whose similarity to `query` clears
 * MIN_CONFIDENT_SIMILARITY, ranked highest first -- empty when nothing
 * clears the bar (e.g. a question with no real overlap with any doc, or
 * an empty/stopword-only query), which callers should treat as "no
 * grounding context available" rather than forcing in a weak match. */
export function retrieveRelevantDocs(query: string): RetrievedDoc[] {
  const queryVector = vectorizeWordDump(query);
  if (queryVector.every((v) => v === 0)) return [];

  return CHUNK_VECTORS.map(({ chunk, vector }) => ({ chunk, similarity: cosineSimilarity(queryVector, vector) }))
    .filter((result) => result.similarity >= MIN_CONFIDENT_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_CHUNKS);
}

/** Formats retrieved chunks into the plain-text block chatPrompt.ts's
 * buildBennySystemPrompt() injects into the system prompt -- undefined
 * (not an empty string) when nothing was retrieved, so the caller can
 * skip the "Relevant FreeLoom documentation" section entirely rather
 * than showing it empty. */
export function buildRetrievedContext(query: string): string | undefined {
  const results = retrieveRelevantDocs(query);
  if (results.length === 0) return undefined;
  return results.map(({ chunk }) => `## ${chunk.heading}\n${chunk.text}`).join("\n\n");
}
