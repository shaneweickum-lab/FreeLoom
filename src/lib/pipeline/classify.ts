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

import { findKnowledgeBaseMatch } from "@/lib/knowledgeBase";

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

export type ConfidentDraft = {
  confident: true;
  subjectArea: string;
  courseTitle: string;
  creditValue: number;
  reasoning: string;
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
  { keywords: ["build", "design", "construct", "engineer", "prototype", "lego"], subjectArea: "Engineering / Design", courseTitle: "Applied Design & Engineering" },
  { keywords: ["plant", "garden", "grow", "seed"], subjectArea: "Science", courseTitle: "Applied Environmental Science" },
  { keywords: ["animal", "wildlife", "pet", "creature"], subjectArea: "Biology", courseTitle: "Applied Biology & Animal Studies" },
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

function findHeuristicCluster(description: string): HeuristicCluster | null {
  const normalized = description.toLowerCase();
  return HEURISTIC_CLUSTERS.find((cluster) => cluster.keywords.some((keyword) => normalized.includes(keyword))) ?? null;
}

/**
 * Homeschool documentation commonly treats ~120-150 engaged hours as one
 * Carnegie credit hour. Falls back to a small single-session estimate when
 * no duration was given rather than guessing something larger.
 */
function estimateCreditValue(timeSpentMinutes: number | null | undefined, base: number): number {
  if (!timeSpentMinutes || timeSpentMinutes <= 0) return base;
  const hours = timeSpentMinutes / 60;
  const rounded = Math.round((hours / 130) * 4) / 4;
  return Math.max(0.1, rounded);
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
export function classifyWordDump(input: WordDumpInput): ClassifyResult {
  const extractedSlots: ExtractedSlots = {
    activity_type: input.activityType ?? null,
    source_platform: input.sourcePlatform ?? null,
    time_spent_minutes: input.timeSpentMinutes ?? null,
  };

  const kbMatch = findKnowledgeBaseMatch(input.rawWordDump);
  if (kbMatch) {
    return {
      confident: true,
      subjectArea: kbMatch.subjectArea,
      courseTitle: kbMatch.courseTitle,
      creditValue: estimateCreditValue(input.timeSpentMinutes, kbMatch.baseCreditHours),
      reasoning: kbMatch.rationale,
      extractedSlots,
    };
  }

  const cluster = findHeuristicCluster(input.rawWordDump);
  if (cluster) {
    return {
      confident: true,
      subjectArea: cluster.subjectArea,
      courseTitle: cluster.courseTitle,
      creditValue: estimateCreditValue(input.timeSpentMinutes, 0.1),
      reasoning: `Matched to ${cluster.subjectArea.toLowerCase()} based on keywords in the activity description.`,
      extractedSlots,
    };
  }

  return {
    confident: false,
    flagReason: "No knowledge-base entry or keyword cluster matched this description.",
    extractedSlots,
  };
}
