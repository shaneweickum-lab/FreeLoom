import { describe, expect, it } from "vitest";
import { computeSubjectLedger } from "./ledger";

describe("computeSubjectLedger", () => {
  it("sums credit values grouped by subject", () => {
    const rows = computeSubjectLedger([
      { subjectArea: "Computer Science", creditValue: 0.5 },
      { subjectArea: "Engineering / Design", creditValue: 0.5 },
      { subjectArea: "Computer Science", creditValue: 0.25 },
    ]);
    expect(rows).toEqual([
      { subjectArea: "Computer Science", creditHours: 0.75 },
      { subjectArea: "Engineering / Design", creditHours: 0.5 },
    ]);
  });

  it("returns an empty list for no tags", () => {
    expect(computeSubjectLedger([])).toEqual([]);
  });

  it("doesn't drift on values that don't round-trip cleanly in binary floating point", () => {
    const tags = Array(10).fill({ subjectArea: "Music", creditValue: 0.1 });
    const rows = computeSubjectLedger(tags);
    expect(rows).toEqual([{ subjectArea: "Music", creditHours: 1 }]);
  });

  it("preserves first-appearance order of subjects", () => {
    const rows = computeSubjectLedger([
      { subjectArea: "B", creditValue: 1 },
      { subjectArea: "A", creditValue: 1 },
    ]);
    expect(rows.map((r) => r.subjectArea)).toEqual(["B", "A"]);
  });
});
