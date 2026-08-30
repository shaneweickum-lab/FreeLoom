import { describe, expect, it } from "vitest";
import { buildBennySystemPrompt } from "./chatPrompt";

describe("buildBennySystemPrompt", () => {
  it("returns the base prompt when there's no extra context", () => {
    const prompt = buildBennySystemPrompt();
    expect(prompt).toContain("You are Benny");
    expect(prompt).not.toContain("Relevant FreeLoom documentation");
  });

  it("appends retrieved documentation context when provided", () => {
    const prompt = buildBennySystemPrompt("Credits are calculated using the Carnegie unit convention.");
    expect(prompt).toContain("You are Benny");
    expect(prompt).toContain("Relevant FreeLoom documentation for this question:");
    expect(prompt).toContain("Credits are calculated using the Carnegie unit convention.");
  });
});
