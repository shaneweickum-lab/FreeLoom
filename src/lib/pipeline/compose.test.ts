import { describe, expect, it } from "vitest";
import { selectComposition, type CompositionRule, type Fragment } from "./compose";

const RULES: CompositionRule[] = [
  { id: "r1", condition: { subject_area: "Language Arts", activity_type: "book" }, fragment_sequence: ["opening", "connection", "evaluation"] },
  { id: "r2", condition: { subject_area: "*", activity_type: "*" }, fragment_sequence: ["opening", "connection", "evaluation"] },
];

const FRAGMENTS: Fragment[] = [
  { id: "f1", subject_tag: "Language Arts", skill_tag: null, rhetorical_function: "opening", text: "Independent reading of age-appropriate material." },
  { id: "f2", subject_tag: "Language Arts", skill_tag: null, rhetorical_function: "connection", text: "Builds vocabulary and comprehension." },
  { id: "f3", subject_tag: "Language Arts", skill_tag: null, rhetorical_function: "evaluation", text: "Credit-bearing Language Arts coursework." },
  { id: "f4", subject_tag: "*", skill_tag: null, rhetorical_function: "opening", text: "A self-directed learning activity." },
  { id: "f5", subject_tag: "*", skill_tag: null, rhetorical_function: "connection", text: "Develops practical, hands-on skills." },
  { id: "f6", subject_tag: "*", skill_tag: null, rhetorical_function: "evaluation", text: "Recognized as credit-bearing coursework." },
];

describe("selectComposition", () => {
  it("prefers the more specific rule when both a specific and a wildcard rule match", () => {
    const result = selectComposition(RULES, FRAGMENTS, { subjectArea: "Language Arts", activityType: "book" });
    expect(result).not.toBeNull();
    expect(result!.reasoning).toContain("Independent reading");
    expect(result!.reasoning).toContain("vocabulary");
    expect(result!.courseTitle).toBe("Applied Language Arts Studies");
  });

  it("falls back to the wildcard rule and wildcard fragments for an unmodeled subject", () => {
    const result = selectComposition(RULES, FRAGMENTS, { subjectArea: "Astronomy", activityType: "project" });
    expect(result).not.toBeNull();
    expect(result!.reasoning).toBe(
      "A self-directed learning activity. Develops practical, hands-on skills. Recognized as credit-bearing coursework."
    );
    expect(result!.courseTitle).toBe("Applied Astronomy Studies");
  });

  it("returns null when no rule matches at all", () => {
    const result = selectComposition([], FRAGMENTS, { subjectArea: "Astronomy", activityType: "project" });
    expect(result).toBeNull();
  });

  it("returns null rather than a partial result when a matching rule needs a fragment that doesn't exist", () => {
    const incompleteFragments = FRAGMENTS.filter((f) => f.rhetorical_function !== "evaluation");
    const result = selectComposition(RULES, incompleteFragments, { subjectArea: "Language Arts", activityType: "book" });
    expect(result).toBeNull();
  });
});
