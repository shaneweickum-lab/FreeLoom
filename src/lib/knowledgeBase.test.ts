import { describe, expect, it } from "vitest";
import {
  findAllKnowledgeBaseMatches,
  findKnowledgeBaseMatch,
  getKnowledgeBase,
  KNOWLEDGE_BASE,
  type KnowledgeBaseEntry,
} from "./knowledgeBase";

describe("findKnowledgeBaseMatch", () => {
  it("matches a known game keyword against the built-in seed set", () => {
    const match = findKnowledgeBaseMatch("Spent the afternoon in Minecraft building a castle");
    expect(match?.courseTitle).toBe("Applied Design & Spatial Engineering");
  });

  it("returns null when nothing in the description matches any entry", () => {
    expect(findKnowledgeBaseMatch("Went to the park and looked at clouds")).toBeNull();
  });

  it("only matches whole words, not a keyword embedded inside another word", () => {
    // "chess" shouldn't match inside "chessboard-shaped" style false positives --
    // use a custom entries list to isolate the behavior from the real seed set.
    const entries: KnowledgeBaseEntry[] = [
      { keywords: ["art"], courseTitle: "Studio Art", subjectArea: "Fine Arts", skills: [], baseCreditHours: 0.25, rationale: "" },
    ];
    expect(findKnowledgeBaseMatch("She started her homework", entries)).toBeNull();
  });

  it("uses a caller-supplied entries list instead of the built-in default when given one", () => {
    const entries: KnowledgeBaseEntry[] = [
      {
        keywords: ["beekeeping"],
        courseTitle: "Applied Apiary Science",
        subjectArea: "Science",
        skills: ["animal husbandry"],
        baseCreditHours: 0.25,
        rationale: "Beekeeping teaches applied biology and animal care.",
      },
    ];
    expect(findKnowledgeBaseMatch("Checked on the beekeeping hives today", entries)?.courseTitle).toBe(
      "Applied Apiary Science"
    );
    // Not in the real KNOWLEDGE_BASE, so the default (no entries passed) should miss it.
    expect(findKnowledgeBaseMatch("Checked on the beekeeping hives today")).toBeNull();
  });
});

describe("findAllKnowledgeBaseMatches", () => {
  it("returns every distinct entry the description matches, not just the first", () => {
    const matches = findAllKnowledgeBaseMatches("Built a redstone elevator in Minecraft today");
    const titles = matches.map((m) => m.entry.courseTitle).sort();
    expect(titles).toEqual(["Applied Design & Spatial Engineering", "Applied Digital Logic"].sort());
  });

  it("reports which keyword matched and where", () => {
    const [match] = findAllKnowledgeBaseMatches("Played a long game of chess with dad");
    expect(match.matchedKeyword.toLowerCase()).toBe("chess");
    expect(match.matchIndex).toBeGreaterThanOrEqual(0);
  });

  it("returns an empty array when nothing matches", () => {
    expect(findAllKnowledgeBaseMatches("Took a nap")).toEqual([]);
  });
});

describe("KNOWLEDGE_BASE (built-in seed set)", () => {
  it("every entry has at least one keyword and a positive credit value", () => {
    for (const entry of KNOWLEDGE_BASE) {
      expect(entry.keywords.length).toBeGreaterThan(0);
      expect(entry.baseCreditHours).toBeGreaterThan(0);
      expect(entry.courseTitle).toBeTruthy();
      expect(entry.subjectArea).toBeTruthy();
    }
  });
});

describe("getKnowledgeBase", () => {
  function fakeSupabase(result: { data: unknown; error: unknown }) {
    return {
      from: () => ({
        select: () => Promise.resolve(result),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("maps DB rows (snake_case) to the KnowledgeBaseEntry shape (camelCase)", async () => {
    const supabase = fakeSupabase({
      data: [
        {
          keywords: ["beekeeping"],
          course_title: "Applied Apiary Science",
          subject_area: "Science",
          skills: ["animal husbandry"],
          base_credit_hours: 0.25,
          rationale: "Beekeeping teaches applied biology.",
        },
      ],
      error: null,
    });
    const result = await getKnowledgeBase(supabase);
    expect(result).toEqual([
      {
        keywords: ["beekeeping"],
        courseTitle: "Applied Apiary Science",
        subjectArea: "Science",
        skills: ["animal husbandry"],
        baseCreditHours: 0.25,
        rationale: "Beekeeping teaches applied biology.",
      },
    ]);
  });

  it("returns an empty array (not null/undefined) when the table has no rows", async () => {
    const supabase = fakeSupabase({ data: [], error: null });
    expect(await getKnowledgeBase(supabase)).toEqual([]);
  });

  it("throws on a DB error, leaving it to the caller to decide how to degrade", async () => {
    const supabase = fakeSupabase({ data: null, error: { message: "connection reset" } });
    await expect(getKnowledgeBase(supabase)).rejects.toBeTruthy();
  });
});
