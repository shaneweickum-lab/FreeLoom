import { describe, expect, it } from "vitest";
import { VECTOR_DIMENSIONS, cosineSimilarity, vectorizeWordDump } from "./vectorize";

describe("vectorizeWordDump", () => {
  it("returns a fixed-length vector regardless of input length", () => {
    expect(vectorizeWordDump("a").length).toBe(VECTOR_DIMENSIONS);
    expect(vectorizeWordDump("Spent the whole afternoon building automated factories in Factorio").length).toBe(
      VECTOR_DIMENSIONS
    );
  });

  it("is deterministic — same text always hashes to the same vector", () => {
    const text = "Read three chapters of a mystery novel before bed";
    expect(vectorizeWordDump(text)).toEqual(vectorizeWordDump(text));
  });

  it("returns an all-zero vector for text with nothing but stopwords", () => {
    const vector = vectorizeWordDump("the a an of to");
    expect(vector.every((v) => v === 0)).toBe(true);
  });

  it("L2-normalizes non-empty vectors to unit length", () => {
    const vector = vectorizeWordDump("Built an elaborate marble run out of cardboard and tape");
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});

describe("cosineSimilarity", () => {
  it("rates near-identical descriptions of the same activity as more similar than an unrelated one", () => {
    const a = vectorizeWordDump("Played Minecraft for an hour building a castle");
    const b = vectorizeWordDump("Spent an hour playing Minecraft, built a small castle");
    const unrelated = vectorizeWordDump("Baked chocolate chip cookies with grandma");

    const similarToItself = cosineSimilarity(a, b);
    const similarToUnrelated = cosineSimilarity(a, unrelated);
    expect(similarToItself).toBeGreaterThan(similarToUnrelated);
  });

  it("returns 1 for a vector compared to itself", () => {
    const vector = vectorizeWordDump("Practiced piano scales for thirty minutes");
    expect(cosineSimilarity(vector, vector)).toBeCloseTo(1, 5);
  });

  it("returns 0 when either vector is all zero", () => {
    const zero = vectorizeWordDump("the a an");
    const nonZero = vectorizeWordDump("Went for a bike ride");
    expect(cosineSimilarity(zero, nonZero)).toBe(0);
  });
});
