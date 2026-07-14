import { matchesAnyKeyword } from "@/lib/keywordMatch";

export type DiscoverySuggestion = {
  subjectArea: string;
  description: string;
};

type DiscoveryMapEntry = {
  keywords: string[];
  suggestions: DiscoverySuggestion[];
};

/**
 * Maps a child's stated hobbies/interests to candidate subject and skill
 * tracks a parent may not have thought to document. Suggestions are a
 * starting point the parent accepts, edits, or ignores.
 */
const DISCOVERY_MAP: DiscoveryMapEntry[] = [
  {
    keywords: ["dinosaur", "fossil", "paleontology"],
    suggestions: [
      { subjectArea: "Earth Science", description: "Fossil formation, geologic time, and paleontology research skills." },
      { subjectArea: "Fine Arts", description: "Drawing and sculpting dinosaurs builds observational art and fine motor skill." },
    ],
  },
  {
    keywords: ["animal", "animals", "wildlife", "zoo", "aquarium", "pet", "pets"],
    suggestions: [
      { subjectArea: "Biology", description: "Animal anatomy, behavior, and habitat classification." },
      { subjectArea: "Life Skills", description: "Responsibility and care routines from pet ownership." },
    ],
  },
  {
    keywords: ["space", "astronomy", "planets", "rocket"],
    suggestions: [
      { subjectArea: "Astronomy / Physics", description: "Orbital mechanics, the solar system, and basic physics of flight." },
    ],
  },
  {
    keywords: ["drawing", "art", "painting", "sketch"],
    suggestions: [
      { subjectArea: "Fine Arts", description: "Visual composition, color theory, and fine motor development." },
    ],
  },
  {
    keywords: ["music", "instrument", "singing", "band"],
    suggestions: [
      { subjectArea: "Music", description: "Rhythm, music theory, and ear training through practice and performance." },
    ],
  },
  {
    keywords: ["reading", "books", "novels", "stories"],
    suggestions: [
      { subjectArea: "Language Arts", description: "Reading comprehension, vocabulary growth, and literary analysis." },
    ],
  },
  {
    keywords: ["writing", "journaling", "poetry"],
    suggestions: [
      { subjectArea: "Language Arts", description: "Creative and expository writing, narrative structure, and voice." },
    ],
  },
  {
    keywords: ["building", "lego", "construction", "engineering"],
    suggestions: [
      { subjectArea: "Engineering / Design", description: "Structural design, spatial reasoning, and iterative prototyping." },
    ],
  },
  {
    keywords: ["redstone", "circuit", "circuits", "logic gate", "logic gates"],
    suggestions: [
      { subjectArea: "Computer Science", description: "Redstone and circuit-building mechanics teach boolean logic and digital circuit design." },
      { subjectArea: "Engineering / Design", description: "Building functional in-game circuits develops iterative systems design and troubleshooting skills." },
    ],
  },
  {
    keywords: ["stationeers"],
    suggestions: [
      { subjectArea: "Engineering / Design", description: "Managing power, atmosphere, and industrial systems in a space-colony survival sim builds real systems-engineering thinking." },
      { subjectArea: "Astronomy / Physics", description: "Atmospheric composition and life-support mechanics introduce practical physics and chemistry concepts." },
    ],
  },
  {
    keywords: ["cooking", "baking"],
    suggestions: [
      { subjectArea: "Family & Consumer Science", description: "Measurement, fractions, and kitchen chemistry." },
    ],
  },
  {
    keywords: ["gaming", "video games", "gamer"],
    suggestions: [
      { subjectArea: "Computer Science", description: "Systems thinking and problem solving through strategy and simulation games." },
    ],
  },
  {
    keywords: ["sports", "soccer", "basketball", "swim", "dance", "gymnastics"],
    suggestions: [
      { subjectArea: "Physical Education", description: "Physical conditioning, teamwork, and goal-directed practice." },
    ],
  },
  {
    keywords: ["history", "historical", "documentaries"],
    suggestions: [
      { subjectArea: "Social Studies", description: "Historical analysis and cause-and-effect reasoning about past events." },
    ],
  },
  {
    keywords: ["travel", "geography", "maps", "culture"],
    suggestions: [
      { subjectArea: "Geography / World Cultures", description: "Map literacy and cross-cultural awareness." },
    ],
  },
  {
    keywords: ["money", "business", "entrepreneur", "selling"],
    suggestions: [
      { subjectArea: "Economics / Life Skills", description: "Budgeting, supply and demand, and basic entrepreneurship." },
    ],
  },
];

export function findDiscoverySuggestions(hobbies: string): DiscoverySuggestion[] {
  const matches: DiscoverySuggestion[] = [];
  const seenSubjects = new Set<string>();
  for (const entry of DISCOVERY_MAP) {
    if (matchesAnyKeyword(hobbies, entry.keywords)) {
      for (const suggestion of entry.suggestions) {
        if (!seenSubjects.has(suggestion.subjectArea)) {
          seenSubjects.add(suggestion.subjectArea);
          matches.push(suggestion);
        }
      }
    }
  }
  return matches;
}
