import { describe, expect, it } from "vitest";
import { findLikelyDuplicate, type RecentEntryForDuplicateCheck } from "./duplicateDetection";

const TODAY = new Date("2026-08-15T18:00:00.000Z");
const EARLIER_TODAY = "2026-08-15T14:00:00.000Z";
const YESTERDAY = "2026-08-14T18:00:00.000Z";

function entry(id: string, rawWordDump: string, createdAt: string): RecentEntryForDuplicateCheck {
  return { id, raw_word_dump: rawWordDump, created_at: createdAt };
}

describe("findLikelyDuplicate", () => {
  it("flags a near-identical word dump logged earlier the same day", () => {
    const recent = [entry("1", "Read a chapter of The Hobbit out loud", EARLIER_TODAY)];
    const result = findLikelyDuplicate("Read a chapter of The Hobbit out loud with mom", recent, TODAY);
    expect(result?.entry.id).toBe("1");
    expect(result!.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it("does not flag a different activity in the same subject", () => {
    const recent = [entry("1", "Practiced piano scales for thirty minutes", EARLIER_TODAY)];
    const result = findLikelyDuplicate("Practiced violin scales for thirty minutes", recent, TODAY);
    expect(result).toBeNull();
  });

  it("does not flag a completely unrelated entry", () => {
    const recent = [entry("1", "Worked through algebra word problems from the textbook", EARLIER_TODAY)];
    const result = findLikelyDuplicate("Went on a nature hike and identified local birds", recent, TODAY);
    expect(result).toBeNull();
  });

  it("ignores a near-identical entry from a previous day", () => {
    const recent = [entry("1", "Read a chapter of The Hobbit out loud", YESTERDAY)];
    const result = findLikelyDuplicate("Read a chapter of The Hobbit out loud with mom", recent, TODAY);
    expect(result).toBeNull();
  });

  it("returns null for empty/whitespace-only input", () => {
    const recent = [entry("1", "Read a chapter of The Hobbit out loud", EARLIER_TODAY)];
    expect(findLikelyDuplicate("   ", recent, TODAY)).toBeNull();
  });

  it("returns null with no recent entries at all", () => {
    expect(findLikelyDuplicate("Read a chapter of The Hobbit out loud", [], TODAY)).toBeNull();
  });

  it("picks the closest match when more than one entry is over the threshold", () => {
    const recent = [
      entry("exact", "Read a chapter of The Hobbit out loud with mom", EARLIER_TODAY),
      entry("close", "Read a chapter of The Hobbit out loud", EARLIER_TODAY),
    ];
    const result = findLikelyDuplicate("Read a chapter of The Hobbit out loud with mom", recent, TODAY);
    expect(result?.entry.id).toBe("exact");
    expect(result!.similarity).toBeCloseTo(1);
  });
});
