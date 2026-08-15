/**
 * The "classical subject-area classifier" docs/slm-strategy.md Section 1
 * calls for: a closed, stable label set, classified by an embeddings +
 * lightweight-classifier approach rather than asking a generative model to
 * pick a label out of thin air. Built on exactly the hashed vectors
 * vectorize.ts already computes for Stage 2 retrieval -- no new corpus, no
 * training, no model. This is a nearest-prototype classifier: one
 * "prototype" vector per subject area, built by hashing that subject's own
 * known keywords (from the same KNOWLEDGE_BASE/HEURISTIC_CLUSTERS Stage 1
 * already uses), then classifying new text by cosine similarity against
 * every prototype.
 *
 * Section 7's actual use for this: cross-checking the entry-drafting SLM
 * adapter's drafted subject_area against this independent classical signal
 * (see agreesWithClassicalClassifier(), wired into slmDraft.ts) --
 * "if the entry-drafting adapter's subject guess substantially disagrees
 * with the independent classical prediction, flag for human review instead
 * of trusting the SLM silently."
 */

import { KNOWLEDGE_BASE } from "@/lib/knowledgeBase";
import { HEURISTIC_CLUSTERS } from "@/lib/pipeline/classify";
import { cosineSimilarity, vectorizeWordDump } from "@/lib/pipeline/vectorize";

/** Below this cosine similarity, the classical classifier doesn't have a
 * confident enough opinion to cross-check against at all -- a hashed,
 * keyword-built prototype vector is a coarse signal, and treating a weak
 * match as a real "classical prediction" would flag plausible SLM drafts
 * just because the word dump used different vocabulary than the keyword
 * lists this classifier's prototypes were built from. A starting point,
 * not empirically tuned against a labeled eval set (none exists yet) --
 * revisit once real accept/edit/reject data from Stage 5 is available. */
const MIN_CONFIDENT_SIMILARITY = 0.15;

/** Every word (>=4 chars, to skip generic short words the same way
 * research/matchCitations.ts's significantWords() does) two subject-area
 * strings have in common -- how "substantial disagreement" is decided,
 * since the SLM's free-text subject_area and this classifier's closed
 * label set are never guaranteed to be the exact same string even when
 * they mean the same subject ("Computer Science" vs. "Computer Science /
 * Engineering"). */
function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4)
  );
}

function sharesAnyWord(a: string, b: string): boolean {
  const wordsA = significantWords(a);
  for (const word of significantWords(b)) {
    if (wordsA.has(word)) return true;
  }
  return false;
}

/** One prototype per subject area, built once at module load (this data is
 * static) by concatenating every keyword every KNOWLEDGE_BASE entry or
 * HEURISTIC_CLUSTERS cluster with that subjectArea contributes -- the same
 * closed set of labels Stage 1 already produces, so a classical prediction
 * is directly comparable to what the rest of the pipeline calls that subject. */
function buildPrototypes(): Map<string, number[]> {
  const keywordsByLabel = new Map<string, string[]>();
  for (const { subjectArea, keywords } of [...KNOWLEDGE_BASE, ...HEURISTIC_CLUSTERS]) {
    const existing = keywordsByLabel.get(subjectArea) ?? [];
    existing.push(...keywords);
    keywordsByLabel.set(subjectArea, existing);
  }

  const prototypes = new Map<string, number[]>();
  for (const [label, keywords] of keywordsByLabel) {
    prototypes.set(label, vectorizeWordDump(keywords.join(" ")));
  }
  return prototypes;
}

const PROTOTYPES = buildPrototypes();

export type ClassicalSubjectPrediction = { label: string; similarity: number };

/** Nearest-prototype classification -- null only when `text` hashes to an
 * all-zero vector (e.g. empty/whitespace-only input, or entirely stopwords). */
export function classifySubjectArea(text: string): ClassicalSubjectPrediction | null {
  const vector = vectorizeWordDump(text);
  if (vector.every((v) => v === 0)) return null;

  let best: ClassicalSubjectPrediction | null = null;
  for (const [label, prototype] of PROTOTYPES) {
    const similarity = cosineSimilarity(vector, prototype);
    if (!best || similarity > best.similarity) best = { label, similarity };
  }
  return best;
}

/**
 * The actual Section 7 safeguard: true when the drafted subject area is
 * plausible enough to trust, false when it substantially disagrees with
 * this independent classical signal and should instead fall through to
 * Stage 5 human review (see callEntryDraftingAdapter() in slmDraft.ts).
 *
 * Deliberately permissive when the classical classifier itself has no
 * confident opinion (below MIN_CONFIDENT_SIMILARITY) -- "no classical
 * signal to compare against" is not the same as "disagreement," and this
 * safeguard should never be the reason a genuinely good draft gets
 * discarded just because its word dump used unfamiliar vocabulary.
 */
export function agreesWithClassicalClassifier(draftedSubjectArea: string, rawWordDump: string): boolean {
  const prediction = classifySubjectArea(rawWordDump);
  if (!prediction || prediction.similarity < MIN_CONFIDENT_SIMILARITY) return true;
  return sharesAnyWord(prediction.label, draftedSubjectArea);
}
