import { describe, expect, it } from "vitest";
import { composeChatPrompt } from "./chatPrompt";

describe("composeChatPrompt", () => {
  it("returns the message unchanged when there's no extra context", () => {
    expect(composeChatPrompt("How are credits calculated?")).toBe("How are credits calculated?");
  });

  it("prepends retrieved documentation context when provided", () => {
    const prompt = composeChatPrompt(
      "How are credits calculated?",
      "Credits are calculated using the Carnegie unit convention."
    );
    expect(prompt).toContain("Relevant FreeLoom documentation:");
    expect(prompt).toContain("Credits are calculated using the Carnegie unit convention.");
    expect(prompt).toContain("Question: How are credits calculated?");
  });
});
