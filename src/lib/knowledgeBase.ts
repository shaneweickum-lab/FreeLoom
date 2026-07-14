import { matchesAnyKeyword } from "@/lib/keywordMatch";

export type KnowledgeBaseEntry = {
  keywords: string[];
  courseTitle: string;
  subjectArea: string;
  skills: string[];
  baseCreditHours: number;
  rationale: string;
};

/**
 * Grounding layer for well-known games, platforms, and family activities.
 * The translation engine matches free-text descriptions against these
 * keyword lists before falling back to generic heuristics or an LLM,
 * so common cases stay consistent instead of re-guessed every time.
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

export function findKnowledgeBaseMatch(description: string): KnowledgeBaseEntry | null {
  for (const entry of KNOWLEDGE_BASE) {
    if (matchesAnyKeyword(description, entry.keywords)) {
      return entry;
    }
  }
  return null;
}
