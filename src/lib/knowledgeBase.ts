import type { SupabaseClient } from "@supabase/supabase-js";
import { findKeywordMatch } from "@/lib/keywordMatch";

export type KnowledgeBaseEntry = {
  keywords: string[];
  courseTitle: string;
  subjectArea: string;
  skills: string[];
  baseCreditHours: number;
  rationale: string;
};

type KnowledgeBaseRow = {
  keywords: string[];
  course_title: string;
  subject_area: string;
  skills: string[];
  base_credit_hours: number;
  rationale: string;
};

/**
 * Grounding layer for well-known games, platforms, and family activities.
 * The translation engine matches free-text descriptions against these
 * keyword lists before falling back to generic heuristics or an LLM,
 * so common cases stay consistent instead of re-guessed every time.
 *
 * This array is now only the FALLBACK/seed set -- the real, growing
 * knowledge base lives in the `knowledge_base` table (see
 * getKnowledgeBase() below), so it can be expanded by loading research
 * straight into the database instead of requiring a code deploy for every
 * new entry. This array stays around as what a fresh install seeds from,
 * and as what classifyWordDump() falls back to if that table is ever
 * unreachable -- callers should never see a total loss of knowledge-base
 * matching just because one DB read failed.
 */
export const KNOWLEDGE_BASE: KnowledgeBaseEntry[] = [
  {
    keywords: ["factorio"],
    courseTitle: "Applied Logic & Systems Design",
    subjectArea: "Computer Science / Engineering",
    skills: ["systems thinking", "resource logistics", "boolean logic", "iterative optimization"],
    baseCreditHours: 0.5,
    rationale:
      "Factorio requires designing interlocking production systems and automating decisions with in-game circuit logic, directly paralleling systems design and boolean logic coursework.",
  },
  {
    keywords: ["redstone", "logic gate", "logic gates"],
    courseTitle: "Applied Digital Logic",
    subjectArea: "Computer Science",
    skills: ["boolean logic", "circuit design", "systematic debugging"],
    baseCreditHours: 0.5,
    rationale:
      "Building redstone circuits means wiring functional logic gates and switching networks in-game, a hands-on introduction to boolean logic and digital circuit design.",
  },
  {
    keywords: ["stationeers"],
    courseTitle: "Applied Systems Engineering & Life Support Design",
    subjectArea: "Engineering / Design",
    skills: ["systems thinking", "power and atmospheric management", "resource logistics"],
    baseCreditHours: 0.5,
    rationale:
      "Stationeers requires managing interdependent power, atmosphere, and industrial systems to keep a space colony alive, directly paralleling engineering systems design and applied physical science.",
  },
  {
    keywords: ["minecraft"],
    courseTitle: "Applied Design & Spatial Engineering",
    subjectArea: "Engineering / Design",
    skills: ["spatial reasoning", "resource management", "structural planning", "creative problem solving"],
    baseCreditHours: 0.5,
    rationale:
      "Minecraft play involves planning structures, managing finite resources, and iterating on designs, which maps to introductory engineering and spatial design skills.",
  },
  {
    keywords: ["poker", "card game", "blackjack"],
    courseTitle: "Introductory Statistics & Probability",
    subjectArea: "Mathematics",
    skills: ["probability", "statistics", "expected value reasoning", "risk assessment"],
    baseCreditHours: 0.25,
    rationale:
      "Card games built around betting require constant probability estimation and expected-value tradeoffs, core concepts in an introductory statistics course.",
  },
  {
    keywords: ["chess"],
    courseTitle: "Strategic Reasoning & Game Theory",
    subjectArea: "Mathematics / Logic",
    skills: ["strategic planning", "pattern recognition", "consequence forecasting"],
    baseCreditHours: 0.25,
    rationale:
      "Chess play develops multi-step strategic planning and pattern recognition, foundational to game theory and formal logic.",
  },
  {
    keywords: ["recess"],
    courseTitle: "Self-Directed Project Studies",
    subjectArea: "Independent Study",
    skills: ["self-direction", "goal setting", "project follow-through"],
    baseCreditHours: 0.25,
    rationale:
      "Structured self-directed activity on a guided platform demonstrates independent goal-setting and follow-through, credited as independent study time.",
  },
  {
    keywords: ["roblox studio", "game dev", "game design", "unity", "scratch coding", "scratch programming"],
    courseTitle: "Introduction to Programming & Game Design",
    subjectArea: "Computer Science",
    skills: ["programming logic", "iterative debugging", "user experience design"],
    baseCreditHours: 0.5,
    rationale:
      "Building playable games requires writing and debugging logic and designing for a player experience, core introductory programming skills.",
  },
  {
    keywords: ["animal crossing", "stardew valley"],
    courseTitle: "Personal Finance & Resource Economics",
    subjectArea: "Economics / Life Skills",
    skills: ["budgeting", "time management", "supply and demand reasoning"],
    baseCreditHours: 0.25,
    rationale:
      "Simulation games centered on earning, spending, and managing limited time build practical budgeting and economics intuition.",
  },
  {
    keywords: ["lego", "building blocks", "k'nex"],
    courseTitle: "Applied Engineering & Design",
    subjectArea: "Engineering / Design",
    skills: ["structural engineering", "fine motor skills", "spatial reasoning"],
    baseCreditHours: 0.25,
    rationale:
      "Constructive building play develops structural intuition and fine motor precision central to introductory engineering.",
  },
  {
    keywords: ["cooking", "baking", "recipe"],
    courseTitle: "Culinary Science & Applied Measurement",
    subjectArea: "Family & Consumer Science",
    skills: ["measurement", "fractions", "chemical reactions", "sequencing"],
    baseCreditHours: 0.25,
    rationale:
      "Cooking and baking require precise measurement, fraction conversion, and understanding of chemical reactions like leavening.",
  },
  {
    keywords: ["garden", "gardening", "planting"],
    courseTitle: "Environmental Science & Botany",
    subjectArea: "Science",
    skills: ["plant biology", "ecosystem observation", "hypothesis testing"],
    baseCreditHours: 0.25,
    rationale:
      "Hands-on gardening involves observing plant life cycles and testing growing conditions, core botany and environmental science skills.",
  },
  {
    keywords: ["dinosaur", "paleontology", "fossil"],
    courseTitle: "Earth Science & Paleontology",
    subjectArea: "Science",
    skills: ["earth science", "classification", "research skills"],
    baseCreditHours: 0.25,
    rationale:
      "Deep interest in dinosaurs and fossils builds research and classification skills central to earth science and paleontology.",
  },
];

export type KnowledgeBaseMatch = { entry: KnowledgeBaseEntry; matchedKeyword: string; matchIndex: number };

/**
 * Every knowledge-base entry whose keywords appear in the description, not
 * just the first -- "redstone" and "minecraft" are separate entries with
 * different subjects, and a word dump can genuinely mention both, which is
 * exactly the multi-tag case (one activity, more than one real subject).
 *
 * `entries` defaults to the built-in KNOWLEDGE_BASE array so every existing
 * call site (tests included) keeps working unchanged; real classification
 * requests pass the DB-backed set from getKnowledgeBase() instead.
 */
export function findAllKnowledgeBaseMatches(description: string, entries: KnowledgeBaseEntry[] = KNOWLEDGE_BASE): KnowledgeBaseMatch[] {
  const matches: KnowledgeBaseMatch[] = [];
  for (const entry of entries) {
    const match = findKeywordMatch(description, entry.keywords);
    if (match) matches.push({ entry, matchedKeyword: match.keyword, matchIndex: match.index });
  }
  return matches;
}

export function findKnowledgeBaseMatch(description: string, entries: KnowledgeBaseEntry[] = KNOWLEDGE_BASE): KnowledgeBaseEntry | null {
  return findAllKnowledgeBaseMatches(description, entries)[0]?.entry ?? null;
}

/**
 * Fetches the live, growing knowledge base from the `knowledge_base` table
 * -- this is the actual source of truth at runtime; KNOWLEDGE_BASE above is
 * only what a fresh install seeds that table with. Throws on a DB error
 * rather than swallowing it, so callers (classify route) can decide how to
 * degrade -- see that route's try/catch, which falls back to KNOWLEDGE_BASE
 * rather than failing the whole classify request over one bad read.
 */
export async function getKnowledgeBase(supabase: SupabaseClient): Promise<KnowledgeBaseEntry[]> {
  const { data, error } = await supabase
    .from("knowledge_base")
    .select("keywords, course_title, subject_area, skills, base_credit_hours, rationale");
  if (error) throw error;
  return ((data as KnowledgeBaseRow[]) ?? []).map((row) => ({
    keywords: row.keywords,
    courseTitle: row.course_title,
    subjectArea: row.subject_area,
    skills: row.skills,
    baseCreditHours: row.base_credit_hours,
    rationale: row.rationale,
  }));
}
