import { describe, expect, it } from "vitest";
import { classifyWordDump } from "./classify";

describe("classifyWordDump", () => {
  it("matches a known game against the curated knowledge base", () => {
    const result = classifyWordDump({ rawWordDump: "Spent the afternoon building factories in Factorio" });
    expect(result.confident).toBe(true);
    if (!result.confident) throw new Error("expected a confident match");
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].subjectArea).toBe("Computer Science / Engineering");
    expect(result.tags[0].courseTitle).toBe("Applied Logic & Systems Design");
    expect(result.tags[0].confidence).toBe("high");
    expect(result.tags[0].source).toBe("knowledge_base");
  });

  it("falls back to a broader keyword cluster when no specific game/platform matches", () => {
    const result = classifyWordDump({ rawWordDump: "Read three chapters of a novel before bed" });
    expect(result.confident).toBe(true);
    if (!result.confident) throw new Error("expected a confident match");
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].subjectArea).toBe("Language Arts");
    expect(result.tags[0].confidence).toBe("medium");
    expect(result.tags[0].source).toBe("heuristic_cluster");
  });

  it("flags for human review instead of guessing when nothing matches", () => {
    const result = classifyWordDump({ rawWordDump: "Zzyzx quaplorp fribbet nonsense words" });
    expect(result.confident).toBe(false);
    if (result.confident) throw new Error("expected a needs-human-review result");
    expect(result.flagReason).toBeTruthy();
  });

  it("estimates credit value from minutes spent using the Carnegie-unit convention", () => {
    // 150 hours (9000 minutes) of engaged time is the standard convention's definition of 1.0 credit.
    const result = classifyWordDump({ rawWordDump: "Played Minecraft", timeSpentMinutes: 9000 });
    expect(result.confident).toBe(true);
    if (!result.confident) throw new Error("expected a confident match");
    expect(result.tags[0].creditValue).toBe(1);
  });

  it("uses the 180-hour lab-science rate instead of the 150-hour standard rate", () => {
    // "animal/wildlife/zoo" matches the Biology cluster (classify.ts) -- a
    // real lab-science subject area this app already produces, not a
    // hypothetical. 180 hours (10800 minutes) should land on exactly 1.0
    // credit here, where it would round to 0.75 at the standard rate.
    const result = classifyWordDump({ rawWordDump: "Visited the zoo and studied the animals", timeSpentMinutes: 10800 });
    expect(result.confident).toBe(true);
    if (!result.confident) throw new Error("expected a confident match");
    expect(result.tags[0].subjectArea).toBe("Biology");
    expect(result.tags[0].creditValue).toBe(1);
  });

  it("uses a small default credit value when no duration is given", () => {
    const result = classifyWordDump({ rawWordDump: "Played chess with a sibling" });
    expect(result.confident).toBe(true);
    if (!result.confident) throw new Error("expected a confident match");
    expect(result.tags[0].creditValue).toBe(0.25);
  });

  it("carries activity_type/source_platform/time_spent_minutes through as extracted slots regardless of match outcome", () => {
    const result = classifyWordDump({
      rawWordDump: "Zzyzx quaplorp fribbet nonsense words",
      activityType: "game",
      sourcePlatform: "Some Platform",
      timeSpentMinutes: 45,
    });
    expect(result.extractedSlots).toEqual({
      activity_type: "game",
      source_platform: "Some Platform",
      time_spent_minutes: 45,
    });
  });

  describe("multi-tag", () => {
    it("produces one tag per genuinely distinct subject when a word dump names more than one", () => {
      // "redstone" (Computer Science) and "Minecraft" (Engineering / Design)
      // are separate knowledge-base entries with different subjects -- a
      // real activity can legitimately span both.
      const result = classifyWordDump({
        rawWordDump: "Spent 2 hours building a redstone elevator in Minecraft",
      });
      expect(result.confident).toBe(true);
      if (!result.confident) throw new Error("expected a confident match");
      const subjects = result.tags.map((t) => t.subjectArea).sort();
      expect(subjects).toEqual(["Computer Science", "Engineering / Design"].sort());
    });

    it("deduplicates to one tag when two different matches share the same subject area", () => {
      // Minecraft and Stationeers are both "Engineering / Design" -- should
      // not double-credit the same subject from one word dump.
      const result = classifyWordDump({
        rawWordDump: "Played Minecraft and also Stationeers today",
      });
      expect(result.confident).toBe(true);
      if (!result.confident) throw new Error("expected a confident match");
      const engineeringTags = result.tags.filter((t) => t.subjectArea === "Engineering / Design");
      expect(engineeringTags).toHaveLength(1);
    });

    it("captures the exact matched phrase as quotedPhrase", () => {
      const result = classifyWordDump({ rawWordDump: "Spent the afternoon building factories in Factorio" });
      expect(result.confident).toBe(true);
      if (!result.confident) throw new Error("expected a confident match");
      expect(result.tags[0].quotedPhrase).toContain("Factorio");
    });
  });

  describe("supporting citations", () => {
    const gameBasedCitation = {
      id: "1",
      title: "Universal Strategy Game",
      category: "Digital & Game-Based",
      topic: "Applied Educational Research",
      primary_subject: "Computer Science & Technology",
      secondary_subject: null,
      summary: "A study of Minecraft as a game-based learning platform.",
      keywords: ["game-based learning minecraft"],
      source: "Some Journal (2020)",
      evidence_level: "Peer-Reviewed Journal Article",
      source_url: "https://doi.org/10.0/example",
      created_at: "2026-01-01T00:00:00Z",
    };

    it("attaches matching research citations to a knowledge-base tag when citations are passed in", () => {
      const result = classifyWordDump(
        { rawWordDump: "Spent 2 hours building things in Minecraft" },
        undefined,
        [gameBasedCitation]
      );
      expect(result.confident).toBe(true);
      if (!result.confident) throw new Error("expected a confident match");
      expect(result.tags[0].citations).toEqual([gameBasedCitation]);
    });

    it("attaches nothing when no citations are passed in", () => {
      const result = classifyWordDump({ rawWordDump: "Spent 2 hours building things in Minecraft" });
      expect(result.confident).toBe(true);
      if (!result.confident) throw new Error("expected a confident match");
      expect(result.tags[0].citations).toEqual([]);
    });

    it("attaches nothing when no citation matches the tag's subject or keyword", () => {
      const result = classifyWordDump({ rawWordDump: "Played chess with a sibling" }, undefined, [gameBasedCitation]);
      expect(result.confident).toBe(true);
      if (!result.confident) throw new Error("expected a confident match");
      expect(result.tags[0].citations).toEqual([]);
    });
  });

  describe("keyword-latching guard", () => {
    it("prefers a specific multi-word technical phrase over an incidental single-word match", () => {
      // "guitar" alone would match the Music cluster, but the activity
      // described is soldering, not playing music -- "circuit board" is a
      // more specific, technical signal and should win outright.
      const result = classifyWordDump({
        rawWordDump: "Spent an afternoon learning to solder a broken guitar pedal circuit board",
      });
      expect(result.confident).toBe(true);
      if (!result.confident) throw new Error("expected a confident match");
      const subjects = result.tags.map((t) => t.subjectArea);
      expect(subjects).toEqual(["Engineering / Design"]);
      expect(subjects).not.toContain("Music");
    });

    it("keeps both tags when two clusters match with equal specificity (genuine multi-subject case)", () => {
      const result = classifyWordDump({ rawWordDump: "Practiced piano and did some coding" });
      expect(result.confident).toBe(true);
      if (!result.confident) throw new Error("expected a confident match");
      const subjects = result.tags.map((t) => t.subjectArea).sort();
      expect(subjects).toEqual(["Computer Science", "Music"].sort());
    });
  });
});
