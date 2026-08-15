import { describe, expect, it } from "vitest";
import { computeGpa, gradePoints, groupByGradeLevel } from "./gpa";

describe("gradePoints", () => {
  it("maps a known letter grade to its point value", () => {
    expect(gradePoints("A")).toBe(4);
    expect(gradePoints("B-")).toBe(2.7);
    expect(gradePoints("F")).toBe(0);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(gradePoints(" a+ ")).toBe(4);
    expect(gradePoints("c")).toBe(2);
  });

  it("returns null for an unrecognized grade string", () => {
    expect(gradePoints("Pass")).toBeNull();
  });

  it("returns null for no grade at all (ungraded/pass-fail course)", () => {
    expect(gradePoints(null)).toBeNull();
  });
});

describe("computeGpa", () => {
  it("computes weighted GPA across multiple graded courses", () => {
    const result = computeGpa([
      { credit_hours: 1, letter_grade: "A", grade_level: "9" },
      { credit_hours: 0.5, letter_grade: "B", grade_level: "9" },
    ]);
    // (1*4 + 0.5*3) / 1.5 = 3.6667 -> rounds to 3.67
    expect(result.gpaCredits).toBe(1.5);
    expect(result.gpaPoints).toBe(5.5);
    expect(result.gpa).toBe(3.67);
  });

  it("excludes ungraded courses from GPA credits/points but the caller still has their raw credit_hours", () => {
    const result = computeGpa([
      { credit_hours: 1, letter_grade: "A", grade_level: "9" },
      { credit_hours: 1, letter_grade: null, grade_level: "9" },
    ]);
    expect(result.gpaCredits).toBe(1);
    expect(result.gpaPoints).toBe(4);
    expect(result.gpa).toBe(4);
  });

  it("returns a null gpa (not 0 or NaN) when there are no graded courses at all", () => {
    const result = computeGpa([{ credit_hours: 1, letter_grade: null, grade_level: "9" }]);
    expect(result.gpa).toBeNull();
    expect(result.gpaCredits).toBe(0);
    expect(result.gpaPoints).toBe(0);
  });

  it("returns a null gpa for an empty course list", () => {
    expect(computeGpa([]).gpa).toBeNull();
  });

  it("rounds gpaCredits/gpaPoints/gpa to 2 decimal places", () => {
    const result = computeGpa([{ credit_hours: 1 / 3, letter_grade: "A", grade_level: "9" }]);
    expect(result.gpaCredits).toBe(0.33);
    expect(result.gpaPoints).toBe(1.33);
  });
});

describe("groupByGradeLevel", () => {
  it("groups courses under their grade level", () => {
    const groups = groupByGradeLevel([
      { credit_hours: 1, letter_grade: "A", grade_level: "10" },
      { credit_hours: 1, letter_grade: "B", grade_level: "9" },
      { credit_hours: 1, letter_grade: "A", grade_level: "9" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.level)).toEqual(["9", "10"]);
    expect(groups[0].courses).toHaveLength(2);
  });

  it("orders groups 9/10/11/12, with Other last regardless of input order", () => {
    const groups = groupByGradeLevel([
      { credit_hours: 1, letter_grade: "A", grade_level: null },
      { credit_hours: 1, letter_grade: "A", grade_level: "12" },
      { credit_hours: 1, letter_grade: "A", grade_level: "9" },
    ]);
    expect(groups.map((g) => g.level)).toEqual(["9", "12", "Other"]);
  });

  it("buckets a missing or unrecognized grade_level under Other", () => {
    const groups = groupByGradeLevel([
      { credit_hours: 1, letter_grade: "A", grade_level: null },
      { credit_hours: 1, letter_grade: "A", grade_level: "kindergarten" },
    ]);
    expect(groups).toEqual([{ level: "Other", courses: expect.any(Array) }]);
    expect(groups[0].courses).toHaveLength(2);
  });

  it("omits grade levels with no courses instead of returning empty buckets", () => {
    const groups = groupByGradeLevel([{ credit_hours: 1, letter_grade: "A", grade_level: "11" }]);
    expect(groups).toEqual([{ level: "11", courses: expect.any(Array) }]);
  });
});
