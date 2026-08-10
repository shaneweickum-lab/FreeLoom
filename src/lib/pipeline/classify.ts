/**
 * Stage 1 (classify) + a simplified Stage 3 (template draft), combined into
 * one v0 pass — exactly what the spec calls for: "ship with a simpler
 * rule-based/keyword-matching classifier... and plan to swap in the trained
 * GBT model once the commissioned seed dataset exists." No neural model, no
 * external API call, anywhere in this file.
 *
 * The interface below (classifyWordDump) is the seam that swap is meant to
 * happen behind — callers only ever see ClassifyResult, never the matching
 * strategy underneath it. When a trained classifier eventually replaces the
 * knowledge-base/keyword matching here, nothing outside this file should
 * need to change.
 */

import { findAllKnowledgeBaseMatches, KNOWLEDGE_BASE, type KnowledgeBaseEntry } from "@/lib/knowledgeBase";
import { extractQuotedPhrase, findKeywordMatch } from "@/lib/keywordMatch";
import { creditFromHours, guessIsLabScience } from "@/lib/pipeline/credit-calculation";

export type WordDumpInput = {
  rawWordDump: string;
  activityType?: string | null;
  sourcePlatform?: string | null;
  timeSpentMinutes?: number | null;
};

/** What Stage 1 pulled out of the raw text — the extracted_slots column, structured. */
export type ExtractedSlots = {
  activity_type: string | null;
  source_platform: string | null;
  time_spent_minutes: number | null;
};

/**
 * Which match actually produced this draft. "knowledge_base" (a specific,
 * hand-curated game/platform match) and "heuristic_cluster" (a generic
 * keyword match) both save as entries.source_stage = 'template' — the
 * distinction matters one layer up, at the API route: only a generic
 * cluster match is weak enough to be worth also trying Stage 2 retrieval,
 * and then Stage 3 fragment composition, against, since a knowledge-base
 * hit is already as good an answer as v0 produces. "retrieval" and
 * "fragment_composition" are both set by the route itself, never by this
 * file.
 */
export type DraftSource = "knowledge_base" | "heuristic_cluster" | "retrieval" | "fragment_composition";

/**
 * How sure the pipeline is about one subject tag, and why. "high"/"medium"
 * map to a direct knowledge-base hit vs. a broader keyword-cluster guess;
 * "low" is Stage 3's generic fragment fallback; "human" is a tag a parent
 * added themselves via the reasoning panel, which isn't a system estimate
 * at all and is labeled differently in the UI for exactly that reason.
 */
export type TagConfidence = "high" | "medium" | "low" | "human";

/** One subject tag drafted for an entry -- an entry can carry more than one
 * when the word dump genuinely names more than one distinct subject (e.g.
 * "redstone" and "Minecraft" are separate knowledge-base entries with
 * different subjects, and a word dump can mention both). */
export type SubjectTagDraft = {
  subjectArea: string;
  courseTitle: string;
  creditValue: number;
  reasoning: string;
  confidence: TagConfidence;
  /** The exact phrase in raw_word_dump that produced this tag, or null when
   * there isn't one (e.g. a retrieval match against a *different* past
   * entry's text, or Stage 3's generic fragment fallback). */
  quotedPhrase: string | null;
  source: DraftSource;
};

export type ConfidentDraft = {
  confident: true;
  tags: SubjectTagDraft[];
  extractedSlots: ExtractedSlots;
};

export type NeedsHumanReview = {
  confident: false;
  flagReason: string;
  extractedSlots: ExtractedSlots;
};

export type ClassifyResult = ConfidentDraft | NeedsHumanReview;

type HeuristicCluster = {
  keywords: string[];
  subjectArea: string;
  courseTitle: string;
};

/**
 * Broader keyword clusters, checked only when nothing in the curated
 * knowledge base (specific games/platforms) matches. Deliberately smaller
 * and more general than the knowledge base — these exist to catch common
 * activity types (reading, building, sports, music...) without pretending
 * to know anything specific about them.
 */
const HEURISTIC_CLUSTERS: HeuristicCluster[] = [
  { keywords: ["budget", "money", "sold", "selling", "business", "profit", "invest"], subjectArea: "Economics / Life Skills", courseTitle: "Applied Personal Finance" },
  { keywords: ["measure", "recipe", "bake", "cook", "kitchen"], subjectArea: "Family & Consumer Science", courseTitle: "Applied Kitchen Science" },
  {
    keywords: [
      "build",
      "design",
      "construct",
      "engineer",
      "prototype",
      "lego",
      "solder",
      "soldering",
      "circuit board",
      "circuit boards",
      "breadboard",
      "electronics",
      "wiring",
      "resistor",
      "capacitor",
      "multimeter",
    ],
    subjectArea: "Engineering / Design",
    courseTitle: "Applied Design & Engineering",
  },
  { keywords: ["plant", "garden", "grow", "seed"], subjectArea: "Science", courseTitle: "Applied Environmental Science" },
  { keywords: ["animal", "animals", "wildlife", "zoo", "aquarium", "pet", "pets", "creature"], subjectArea: "Biology", courseTitle: "Applied Biology & Animal Studies" },
  { keywords: ["write", "wrote", "story", "journal", "poem", "essay"], subjectArea: "Language Arts", courseTitle: "Creative & Expository Writing" },
  { keywords: ["read", "book", "novel", "chapter"], subjectArea: "Language Arts", courseTitle: "Literature & Reading Comprehension" },
  { keywords: ["draw", "paint", "sketch", "art", "craft"], subjectArea: "Fine Arts", courseTitle: "Studio Art" },
  { keywords: ["music", "instrument", "sing", "song", "band", "piano", "guitar"], subjectArea: "Music", courseTitle: "Applied Music Studies" },
  { keywords: ["history", "historical", "documentary", "museum"], subjectArea: "Social Studies", courseTitle: "Applied History Studies" },
  { keywords: ["map", "travel", "country", "geography", "culture"], subjectArea: "Geography / World Cultures", courseTitle: "World Geography & Cultures" },
  { keywords: ["run", "swim", "soccer", "basketball", "practice", "sport", "dance", "gymnastics"], subjectArea: "Physical Education", courseTitle: "Applied Physical Education" },
  { keywords: ["code", "program", "coding", "app", "website", "software"], subjectArea: "Computer Science", courseTitle: "Introduction to Programming" },
  { keywords: ["math", "count", "number", "calculate", "puzzle", "logic"], subjectArea: "Mathematics", courseTitle: "Applied Mathematical Reasoning" },
  { keywords: ["volunteer", "community", "helped", "charity"], subjectArea: "Civics / Social Studies", courseTitle: "Community Engagement & Civics" },
];

type HeuristicClusterMatch = { cluster: HeuristicCluster; matchedKeyword: string; matchIndex: number };

/**
 * findKeywordMatch returns the first of a cluster's keywords that matches,
 * in array-declaration order -- not necessarily the most specific one
 * present in the text. A cluster listing both "solder" and "circuit board"
 * would report "solder" just because it comes first in the array, even
 * when "circuit board" (a stronger signal) also appears. Checking every
 * keyword and keeping the one with the most words avoids that ordering
 * trap, and is what preferMostSpecificClusterMatch below relies on to
 * weigh clusters against each other fairly.
 */
function findMostSpecificKeywordMatch(description: string, keywords: string[]) {
  let best: { keyword: string; index: number } | null = null;
  for (const keyword of keywords) {
    const match = findKeywordMatch(description, [keyword]);
    if (!match) continue;
    const bestSpecificity = best?.keyword.trim().split(/\s+/).length ?? -1;
    if (match.keyword.trim().split(/\s+/).length > bestSpecificity) best = match;
  }
  return best;
}

function findAllHeuristicClusters(description: string): HeuristicClusterMatch[] {
  const matches: HeuristicClusterMatch[] = [];
  for (const cluster of HEURISTIC_CLUSTERS) {
    const match = findMostSpecificKeywordMatch(description, cluster.keywords);
    if (match) matches.push({ cluster, matchedKeyword: match.keyword, matchIndex: match.index });
  }
  return matches;
}

/**
 * Guards against keyword-latching: a generic single word (e.g. "guitar",
 * which fires on any mention of the instrument, including as an object
 * being repaired rather than played) is much weaker evidence of a subject
 * than a longer, domain-specific phrase (e.g. "circuit board") matching
 * elsewhere in the same description -- this is exactly how a description
 * of soldering a guitar pedal's circuit board got tagged as Music instead
 * of Engineering. When cluster matches disagree on subject, keep only the
 * most specific (most words) match(es) rather than tagging both -- a
 * one-word match loses to a multi-word one. When every match is equally
 * specific (e.g. two single common words, as in "practiced piano and did
 * some coding"), there's no basis to prefer one over the other, so all are
 * kept -- that's a genuine multi-subject case, not a collision.
 */
function preferMostSpecificClusterMatch(matches: HeuristicClusterMatch[]): HeuristicClusterMatch[] {
  if (matches.length <= 1) return matches;
  const specificity = (match: HeuristicClusterMatch) => match.matchedKeyword.trim().split(/\s+/).length;
  const maxSpecificity = Math.max(...matches.map(specificity));
  if (matches.every((match) => specificity(match) === maxSpecificity)) return matches;
  return matches.filter((match) => specificity(match) === maxSpecificity);
}

/**
 * Keeps only the first match per subject area. Two different knowledge-base
 * entries (or heuristic clusters) can share a subject -- Minecraft and
 * Stationeers are both "Engineering / Design" -- and a word dump mentioning
 * both shouldn't produce two tags double-crediting the same subject. Real
 * multi-tag cases are distinct subjects (e.g. "redstone" -> Computer
 * Science, "Minecraft" -> Engineering / Design in the same sentence).
 */
function dedupeBySubject<T>(matches: T[], getSubjectArea: (match: T) => string): T[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const subjectArea = getSubjectArea(match);
    if (seen.has(subjectArea)) return false;
    seen.add(subjectArea);
    return true;
  });
}

/**
 * The whole of Stage 1+3 v0: try the curated knowledge base first (specific
 * games/platforms/activities with a hand-written rationale), then the
 * broader keyword clusters (a general subject match with no specific
 * rationale to draw on), and only give up — flagging for Stage 5 human
 * resolution — when neither matches anything in the description at all.
 * No silent guessing: a low-confidence draft that LOOKS like a real answer
 * is worse than an honest "needs your input."
 */
export function classifyWordDump(input: WordDumpInput, kbEntries: KnowledgeBaseEntry[] = KNOWLEDGE_BASE): ClassifyResult {
  const extractedSlots: ExtractedSlots = {
    activity_type: input.activityType ?? null,
    source_platform: input.sourcePlatform ?? null,
    time_spent_minutes: input.timeSpentMinutes ?? null,
  };

  const kbMatches = dedupeBySubject(
    findAllKnowledgeBaseMatches(input.rawWordDump, kbEntries),
    (m) => m.entry.subjectArea
  );
  if (kbMatches.length > 0) {
    return {
      confident: true,
      tags: kbMatches.map(({ entry, matchedKeyword, matchIndex }) => ({
        subjectArea: entry.subjectArea,
        courseTitle: entry.courseTitle,
        creditValue: creditFromHours(input.timeSpentMinutes, guessIsLabScience(entry.subjectArea), entry.baseCreditHours),
        reasoning: entry.rationale,
        confidence: "high",
        quotedPhrase: extractQuotedPhrase(input.rawWordDump, { keyword: matchedKeyword, index: matchIndex }),
        source: "knowledge_base",
      })),
      extractedSlots,
    };
  }

  const clusterMatches = preferMostSpecificClusterMatch(
    dedupeBySubject(findAllHeuristicClusters(input.rawWordDump), (m) => m.cluster.subjectArea)
  );
  if (clusterMatches.length > 0) {
    return {
      confident: true,
      tags: clusterMatches.map(({ cluster, matchedKeyword, matchIndex }) => ({
        subjectArea: cluster.subjectArea,
        courseTitle: cluster.courseTitle,
        creditValue: creditFromHours(input.timeSpentMinutes, guessIsLabScience(cluster.subjectArea), 0.1),
        reasoning: `Matched to ${cluster.subjectArea.toLowerCase()} based on keywords in the activity description.`,
        confidence: "medium",
        quotedPhrase: extractQuotedPhrase(input.rawWordDump, { keyword: matchedKeyword, index: matchIndex }),
        source: "heuristic_cluster",
      })),
      extractedSlots,
    };
  }

  return {
    confident: false,
    flagReason: "No knowledge-base entry or keyword cluster matched this description.",
    extractedSlots,
  };
}
