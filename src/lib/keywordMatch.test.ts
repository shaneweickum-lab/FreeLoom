import { describe, expect, it } from "vitest";
import { extractQuotedPhrase, findKeywordMatch, matchesAnyKeyword, matchesKeyword } from "./keywordMatch";

describe("matchesKeyword", () => {
  it("matches a keyword as a whole word", () => {
    expect(matchesKeyword("we got a new pet hamster", "pet")).toBe(true);
  });

  it("does not match a keyword that only appears as a substring of another word", () => {
    expect(matchesKeyword("she built a puppet theater", "pet")).toBe(false);
    expect(matchesKeyword("we laid out a carpet", "pet")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesKeyword("Played MINECRAFT all day", "minecraft")).toBe(true);
  });

  it("matches multi-word phrases", () => {
    expect(matchesKeyword("we played a card game after dinner", "card game")).toBe(true);
  });
});

describe("matchesAnyKeyword", () => {
  it("returns true if any keyword matches", () => {
    expect(matchesAnyKeyword("built redstone circuits in minecraft", ["stationeers", "redstone"])).toBe(true);
  });

  it("returns false if no keyword matches", () => {
    expect(matchesAnyKeyword("read a book about sharks", ["stationeers", "redstone"])).toBe(false);
  });
});

describe("findKeywordMatch", () => {
  it("returns which keyword matched and where", () => {
    const match = findKeywordMatch("built redstone circuits in minecraft", ["stationeers", "redstone"]);
    expect(match).not.toBeNull();
    expect(match?.keyword.toLowerCase()).toBe("redstone");
    expect(match?.index).toBe("built ".length);
  });

  it("returns null when nothing matches", () => {
    expect(findKeywordMatch("read a book about sharks", ["stationeers", "redstone"])).toBeNull();
  });

  it("preserves the original casing of the matched text", () => {
    const match = findKeywordMatch("Played MINECRAFT all day", ["minecraft"]);
    expect(match?.keyword).toBe("MINECRAFT");
  });
});

describe("extractQuotedPhrase", () => {
  it("returns a readable snippet around the match, trimmed to word boundaries", () => {
    const text = "Spent like 2 hours today building a redstone elevator in Minecraft";
    const match = findKeywordMatch(text, ["redstone"])!;
    const snippet = extractQuotedPhrase(text, match);
    expect(snippet).toContain("redstone");
    expect(snippet.length).toBeLessThan(text.length);
  });

  it("doesn't prefix/suffix an ellipsis when the match is at the very start/end", () => {
    const text = "redstone";
    const match = findKeywordMatch(text, ["redstone"])!;
    expect(extractQuotedPhrase(text, match)).toBe("redstone");
  });
});
