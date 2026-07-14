import { describe, expect, it } from "vitest";
import { findDiscoverySuggestions } from "./discoveryMap";

describe("findDiscoverySuggestions", () => {
  it("suggests Biology for a zoo/aquarium interest without implying pet ownership", () => {
    const suggestions = findDiscoverySuggestions("loves to go to the zoo and the aquarium");
    const subjects = suggestions.map((s) => s.subjectArea);
    expect(subjects).toContain("Biology");
    expect(subjects).not.toContain("Life Skills");
  });

  it("suggests Life Skills alongside Biology when a pet is actually mentioned", () => {
    const suggestions = findDiscoverySuggestions("takes care of our pet rabbit every day");
    const subjects = suggestions.map((s) => s.subjectArea);
    expect(subjects).toContain("Biology");
    expect(subjects).toContain("Life Skills");
  });

  it("matches Stationeers/Redstone interests to Computer Science/Engineering/Astronomy, not an unrelated cluster", () => {
    const suggestions = findDiscoverySuggestions("plays Stationeers and Minecraft, building redstone circuits");
    const subjects = suggestions.map((s) => s.subjectArea);
    expect(subjects).toContain("Computer Science");
    expect(subjects).toContain("Engineering / Design");
    expect(subjects).toContain("Astronomy / Physics");
    expect(subjects).not.toContain("Life Skills");
  });
});
