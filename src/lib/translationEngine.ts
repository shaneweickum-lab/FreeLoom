import { findKnowledgeBaseMatch } from "./knowledgeBase";
import type { TranslateLogResponse } from "./types";

type HeuristicCluster = {
  keywords: string[];
  subjectArea: string;
  skills: string[];
  courseTitle: string;
};

/**
 * Fallback clusters for activities that aren't in the curated knowledge
 * base. Keeps unstructured, unlisted activities from falling through to a
 * meaningless "General Studies" label whenever a reasonable keyword match
 * exists. Also used as a grounding hint fed into the AI translation prompt.
 */
const HEURISTIC_CLUSTERS: HeuristicCluster[] = [
  {
    keywords: ["budget", "money", "sold", "selling", "business", "profit", "invest"],
    subjectArea: "Economics / Life Skills",
    skills: ["budgeting", "financial reasoning"],
    courseTitle: "Applied Personal Finance",
  },
  {
    keywords: ["measure", "recipe", "bake", "cook", "kitchen"],
    subjectArea: "Family & Consumer Science",
    skills: ["measurement", "sequencing"],
    courseTitle: "Applied Kitchen Science",
  },
  {
    keywords: ["build", "design", "construct", "engineer", "prototype"],
    subjectArea: "Engineering / Design",
    skills: ["spatial reasoning", "iterative design"],
    courseTitle: "Applied Design & Engineering",
  },
  {
    keywords: ["plant", "garden", "grow", "seed"],
    subjectArea: "Science",
    skills: ["plant biology", "observation"],
    courseTitle: "Applied Environmental Science",
  },
  {
    keywords: ["animal", "wildlife", "pet", "creature"],
    subjectArea: "Biology",
    skills: ["animal biology", "classification"],
    courseTitle: "Applied Biology & Animal Studies",
  },
  {
    keywords: ["write", "wrote", "story", "journal", "poem", "essay"],
    subjectArea: "Language Arts",
    skills: ["written expression", "narrative structure"],
    courseTitle: "Creative & Expository Writing",
  },
  {
    keywords: ["read", "book", "novel", "chapter"],
    subjectArea: "Language Arts",
    skills: ["reading comprehension", "vocabulary"],
    courseTitle: "Literature & Reading Comprehension",
  },
  {
    keywords: ["draw", "paint", "sketch", "art", "craft"],
    subjectArea: "Fine Arts",
    skills: ["visual composition", "fine motor skill"],
    courseTitle: "Studio Art",
  },
  {
    keywords: ["music", "instrument", "sing", "song", "band", "practice piano", "guitar"],
    subjectArea: "Music",
    skills: ["rhythm", "ear training"],
    courseTitle: "Applied Music Studies",
  },
  {
    keywords: ["history", "historical", "documentary", "museum"],
    subjectArea: "Social Studies",
    skills: ["historical analysis", "research"],
    courseTitle: "Applied History Studies",
  },
  {
    keywords: ["map", "travel", "country", "geography", "culture"],
    subjectArea: "Geography / World Cultures",
    skills: ["map literacy", "cultural awareness"],
    courseTitle: "World Geography & Cultures",
  },
  {
    keywords: ["run", "swim", "soccer", "basketball", "practice", "sport", "dance", "gymnastics"],
    subjectArea: "Physical Education",
    skills: ["physical conditioning", "goal-directed practice"],
    courseTitle: "Applied Physical Education",
  },
  {
    keywords: ["code", "program", "coding", "app", "website", "software"],
    subjectArea: "Computer Science",
    skills: ["programming logic", "debugging"],
    courseTitle: "Introduction to Programming",
  },
  {
    keywords: ["math", "count", "number", "calculate", "puzzle", "logic"],
    subjectArea: "Mathematics",
    skills: ["numerical reasoning", "logic"],
    courseTitle: "Applied Mathematical Reasoning",
  },
  {
    keywords: ["volunteer", "community", "helped", "charity"],
    subjectArea: "Civics / Social Studies",
    skills: ["civic engagement", "collaboration"],
    courseTitle: "Community Engagement & Civics",
  },
];

const DEFAULT_CLUSTER: HeuristicCluster = {
  keywords: [],
  subjectArea: "Independent Study",
  skills: ["self-direction", "real-world application"],
  courseTitle: "Independent Studies",
};

function findHeuristicCluster(description: string): HeuristicCluster {
  const normalized = description.toLowerCase();
  for (const cluster of HEURISTIC_CLUSTERS) {
    if (cluster.keywords.some((keyword) => normalized.includes(keyword))) {
      return cluster;
    }
  }
  return DEFAULT_CLUSTER;
}

/**
 * Homeschool documentation commonly treats ~120-150 hours of engaged
 * activity as one Carnegie credit hour. Falls back to a small single-session
 * estimate when the parent hasn't logged specific time.
 */
export function estimateCreditHours(timeSpentMinutes: number | null | undefined, base: number): number {
  if (!timeSpentMinutes || timeSpentMinutes <= 0) return base;
  const hours = timeSpentMinutes / 60;
  const raw = hours / 130;
  const rounded = Math.round(raw * 4) / 4;
  return Math.max(0.1, rounded);
}

/**
 * Local knowledge-base + keyword heuristic translation. Used as the sole
 * translation path when no ANTHROPIC_API_KEY is configured, and otherwise
 * passed into the AI prompt as a grounding hint to reduce hallucination.
 */
export function heuristicTranslate(
  description: string,
  timeSpentMinutes?: number | null
): TranslateLogResponse {
  const kbMatch = findKnowledgeBaseMatch(description);
  if (kbMatch) {
    return {
      course_title: kbMatch.courseTitle,
      subject_area: kbMatch.subjectArea,
      credit_hours: estimateCreditHours(timeSpentMinutes, kbMatch.baseCreditHours),
      rationale: kbMatch.rationale,
      source: "heuristic",
    };
  }

  const cluster = findHeuristicCluster(description);
  return {
    course_title: cluster.courseTitle,
    subject_area: cluster.subjectArea,
    credit_hours: estimateCreditHours(timeSpentMinutes, 0.1),
    rationale:
      cluster === DEFAULT_CLUSTER
        ? "No specific subject keywords were recognized, so this was logged as self-directed independent study. Edit the course title and subject area to better match what was learned."
        : `Matched to ${cluster.subjectArea.toLowerCase()} based on keywords in the activity description.`,
    source: "heuristic",
  };
}
