import { describe, expect, it } from "vitest";
import { matchesAnyKeyword, matchesKeyword } from "./keywordMatch";

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
