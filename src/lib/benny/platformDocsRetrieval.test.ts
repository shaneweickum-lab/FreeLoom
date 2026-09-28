import { describe, expect, it } from "vitest";
import { buildRetrievedContext, retrieveRelevantDocs } from "./platformDocsRetrieval";
import { PLATFORM_DOC_CHUNKS } from "./platformDocs";

describe("platformDocs corpus", () => {
  it("has no duplicate chunk ids", () => {
    const ids = PLATFORM_DOC_CHUNKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every chunk has real, non-empty content", () => {
    for (const chunk of PLATFORM_DOC_CHUNKS) {
      expect(chunk.heading.trim().length).toBeGreaterThan(0);
      expect(chunk.text.trim().length).toBeGreaterThan(20);
    }
  });
});

describe("retrieveRelevantDocs", () => {
  it("retrieves the credits chunk for a credits question", () => {
    const results = retrieveRelevantDocs("How are credit values calculated?");
    expect(results[0]?.chunk.id).toBe("credits-how-calculated");
  });

  it("retrieves the household chunk for a guardian-invite question", () => {
    const results = retrieveRelevantDocs("Can I invite my husband to help manage the account?");
    expect(results[0]?.chunk.id).toBe("household-second-guardian");
  });

  it("retrieves the model-info chunk for a question about which AI model runs Benny", () => {
    const results = retrieveRelevantDocs("What AI model powers Benny?");
    expect(results[0]?.chunk.id).toBe("benny-ai-model");
  });

  it("returns nothing for a question with no real overlap with any doc", () => {
    expect(retrieveRelevantDocs("Tell me a joke about cats.")).toEqual([]);
    expect(retrieveRelevantDocs("What is the weather like today?")).toEqual([]);
  });

  it("returns nothing for empty/whitespace-only input", () => {
    expect(retrieveRelevantDocs("   ")).toEqual([]);
  });

  it("never returns more than 3 chunks", () => {
    // Loop through every doc's own heading+text as the "query" -- a chunk
    // matching itself perfectly is the best case for maximizing matches,
    // so this is the strongest test of the cap actually holding.
    for (const chunk of PLATFORM_DOC_CHUNKS) {
      const results = retrieveRelevantDocs(`${chunk.heading} ${chunk.text}`);
      expect(results.length).toBeLessThanOrEqual(3);
    }
  });

  it("ranks results highest-similarity first", () => {
    const results = retrieveRelevantDocs("How are credit values calculated?");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
    }
  });
});

describe("buildRetrievedContext", () => {
  it("returns undefined (not an empty string) when nothing was retrieved", () => {
    expect(buildRetrievedContext("Tell me a joke about cats.")).toBeUndefined();
  });

  it("formats retrieved chunks as a markdown-headed block", () => {
    const context = buildRetrievedContext("How are credit values calculated?");
    expect(context).toContain("## How credit values are calculated");
    expect(context).toContain("Carnegie unit convention");
  });
});
