import { describe, expect, it } from "vitest";
import { classifyWordDump } from "./classify";

describe("classifyWordDump", () => {
  it("matches a known game against the curated knowledge base", () => {
    const result = classifyWordDump({ rawWordDump: "Spent the afternoon building factories in Factorio" });
    expect(result.confident).toBe(true);
    if (!result.confident) throw new Error("expected a confident match");
    expect(result.subjectArea).toBe("Computer Science / Engineering");
    expect(result.courseTitle).toBe("Applied Logic & Systems Design");
  });

  it("falls back to a broader keyword cluster when no specific game/platform matches", () => {
    const result = classifyWordDump({ rawWordDump: "Read three chapters of a novel before bed" });
    expect(result.confident).toBe(true);
    if (!result.confident) throw new Error("expected a confident match");
    expect(result.subjectArea).toBe("Language Arts");
  });

  it("flags for human review instead of guessing when nothing matches", () => {
    const result = classifyWordDump({ rawWordDump: "Zzyzx quaplorp fribbet nonsense words" });
    expect(result.confident).toBe(false);
    if (result.confident) throw new Error("expected a needs-human-review result");
    expect(result.flagReason).toBeTruthy();
  });

  it("estimates credit value from minutes spent using the Carnegie-unit convention", () => {
    // 130 hours (7800 minutes) of engaged time is the convention's definition of 1.0 credit.
    const result = classifyWordDump({ rawWordDump: "Played Minecraft", timeSpentMinutes: 7800 });
    expect(result.confident).toBe(true);
    if (!result.confident) throw new Error("expected a confident match");
    expect(result.creditValue).toBe(1);
  });

  it("uses a small default credit value when no duration is given", () => {
    const result = classifyWordDump({ rawWordDump: "Played chess with a sibling" });
    expect(result.confident).toBe(true);
    if (!result.confident) throw new Error("expected a confident match");
    expect(result.creditValue).toBe(0.25);
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
});
