import { describe, expect, it } from "vitest";
import { findSupportingCitations } from "./matchCitations";
import type { ResearchCitation } from "@/lib/types";

function citation(overrides: Partial<ResearchCitation>): ResearchCitation {
  return {
    id: "1",
    title: "Untitled",
    category: "Core Pedagogy",
    topic: "Applied Educational Research",
    primary_subject: "Social Studies",
    secondary_subject: null,
    summary: "",
    keywords: [],
    source: "Some Journal (2020)",
    evidence_level: "Peer-Reviewed Journal Article",
    source_url: "https://doi.org/10.0/example",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("findSupportingCitations", () => {
  it("matches a citation whose keywords contain the drafted tag's literal keyword", () => {
    const gameBased = citation({
      title: "Universal Strategy Game",
      keywords: ["game-based learning minecraft"],
      category: "Digital & Game-Based",
    });
    const unrelated = citation({ title: "Forest School Outcomes", keywords: ["forest school"] });

    const result = findSupportingCitations(
      { subjectArea: "Engineering / Design", matchedKeyword: "minecraft" },
      [gameBased, unrelated]
    );

    expect(result).toEqual([gameBased]);
  });

  it("matches on subject-area words when no literal keyword is available (retrieval-stage tags)", () => {
    const match = citation({ primary_subject: "Computer Science & Technology", title: "Informal Gaming Literacy" });
    const unrelated = citation({ primary_subject: "Social Studies", title: "Forest School Outcomes" });

    const result = findSupportingCitations({ subjectArea: "Computer Science" }, [match, unrelated]);

    expect(result).toEqual([match]);
  });

  it("returns nothing when no citation shares any significant word", () => {
    const result = findSupportingCitations(
      { subjectArea: "Music", matchedKeyword: "piano" },
      [citation({ title: "Forest School Outcomes", primary_subject: "Science" })]
    );
    expect(result).toEqual([]);
  });

  it("ranks citations matching more signal words above single-word matches", () => {
    const strongMatch = citation({
      title: "Self-Directed Education and Autonomous Learning Outcomes",
      primary_subject: "Social Studies",
    });
    const weakMatch = citation({ title: "A Study of Learning", primary_subject: "Social Studies" });

    const result = findSupportingCitations(
      { subjectArea: "Social Studies", matchedKeyword: "self-directed education" },
      [weakMatch, strongMatch],
      2
    );

    expect(result[0]).toBe(strongMatch);
  });

  it("caps results at the requested limit", () => {
    const citations = Array.from({ length: 5 }, (_, i) =>
      citation({ id: String(i), title: "Chess Strategy in Education", primary_subject: "Mathematics / Logic" })
    );
    const result = findSupportingCitations({ subjectArea: "Mathematics / Logic", matchedKeyword: "chess" }, citations, 2);
    expect(result).toHaveLength(2);
  });

  it("returns nothing when the tag has no citations to search", () => {
    expect(findSupportingCitations({ subjectArea: "Music" }, [])).toEqual([]);
  });
});
