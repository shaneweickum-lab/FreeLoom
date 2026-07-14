/**
 * Stage 2's raw material: turns a word dump into a fixed-size numeric
 * vector so Postgres/pgvector can do a cosine-similarity search over it.
 *
 * This is deliberately NOT a neural embedding — no model, no external call,
 * nothing to train. It's the classical "hashing trick" (feature hashing)
 * that pre-dates neural embeddings entirely: every token gets hashed
 * straight into one of a fixed number of buckets, so the vector's size
 * never depends on vocabulary size or needing a pre-built corpus. Term
 * frequencies get sublinear (1 + log(tf)) scaling — the standard
 * information-retrieval trick that keeps one repeated word from dominating
 * a short word dump — and the whole vector is L2-normalized at the end so
 * cosine similarity behaves sensibly.
 */

export const VECTOR_DIMENSIONS = 512;

const STOPWORDS = new Set([
  "a", "an", "and", "the", "to", "of", "in", "on", "for", "with", "at", "by",
  "is", "was", "were", "are", "be", "been", "it", "its", "this", "that",
  "he", "she", "they", "we", "i", "his", "her", "their", "our", "my",
  "as", "or", "but", "so", "then", "than", "into", "about", "up", "out",
]);

/** FNV-1a: simple, fast, well-distributed 32-bit string hash. */
function fnv1aHash(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Hashes a word dump into a fixed VECTOR_DIMENSIONS-length, L2-normalized vector. */
export function vectorizeWordDump(text: string): number[] {
  const counts = new Array(VECTOR_DIMENSIONS).fill(0);
  for (const token of tokenize(text)) {
    const bucket = fnv1aHash(token) % VECTOR_DIMENSIONS;
    counts[bucket] += 1;
  }

  const weighted = counts.map((count) => (count > 0 ? 1 + Math.log(count) : 0));
  const norm = Math.sqrt(weighted.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return weighted;
  return weighted.map((value) => value / norm);
}

/** Cosine similarity between two equal-length vectors — used by tests and anywhere JS needs it outside Postgres. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
