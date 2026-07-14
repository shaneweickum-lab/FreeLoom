import { describe, expect, it } from "vitest";
import { sumCredits, cumulativeCreditsByYear } from "./credit-calculation";

describe("sumCredits", () => {
  it("adds a flat list of credit values", () => {
    expect(sumCredits([0.5, 0.5, 1, 1.25])).toBe(3.25);
  });

  it("returns 0 for an empty list", () => {
    expect(sumCredits([])).toBe(0);
  });

  it("doesn't drift on values that don't round-trip cleanly in binary floating point", () => {
    // 0.1 + 0.2 famously isn't 0.3 in raw IEEE-754 doubles. Ten entries of
    // 0.1 credit summed the naive way (values.reduce((a, b) => a + b, 0))
    // land on 0.9999999999999999, not 1 -- exactly the kind of silent drift
    // that produced the original half-credit bug. Routing through integer
    // hundredths must give the exact answer instead.
    const tenthCredits = Array(10).fill(0.1);
    expect(sumCredits(tenthCredits)).toBe(1);
  });
});

describe("cumulativeCreditsByYear", () => {
  it("returns an empty list for no entries", () => {
    expect(cumulativeCreditsByYear([])).toEqual([]);
  });

  it("carries a running cumulative total forward across years", () => {
    const result = cumulativeCreditsByYear([
      { year: "9", creditValue: 1 },
      { year: "9", creditValue: 0.5 },
      { year: "9", creditValue: 0.5 },
      { year: "10", creditValue: 0.5 },
      { year: "10", creditValue: 0.5 },
      { year: "10", creditValue: 1 },
    ]);

    expect(result).toEqual([
      { year: "9", yearCredits: 2, cumulativeCredits: 2 },
      { year: "10", yearCredits: 2, cumulativeCredits: 4 },
    ]);
  });

  it("does not undercount by 0.5 once a second year of half-credit courses accumulates (the original bug)", () => {
    // The bug this guards against: cumulative credits through year 2 came
    // out 0.5 low once several half-credit entries had been summed across
    // more than one year's boundary. Three half-credit courses per year for
    // three years should cumulative to exactly 1.5, 3.0, 4.5 -- not
    // 1.5, 2.5, 4.0 or any other drifted variant.
    const result = cumulativeCreditsByYear([
      { year: "9", creditValue: 0.5 },
      { year: "9", creditValue: 0.5 },
      { year: "9", creditValue: 0.5 },
      { year: "10", creditValue: 0.5 },
      { year: "10", creditValue: 0.5 },
      { year: "10", creditValue: 0.5 },
      { year: "11", creditValue: 0.5 },
      { year: "11", creditValue: 0.5 },
      { year: "11", creditValue: 0.5 },
    ]);

    expect(result.map((r) => r.cumulativeCredits)).toEqual([1.5, 3, 4.5]);
  });

  it("groups by first-appearance order even when entries arrive interleaved across years", () => {
    const result = cumulativeCreditsByYear([
      { year: "10", creditValue: 1 },
      { year: "9", creditValue: 1 },
      { year: "10", creditValue: 1 },
      { year: "9", creditValue: 1 },
    ]);

    expect(result.map((r) => r.year)).toEqual(["10", "9"]);
    expect(result).toEqual([
      { year: "10", yearCredits: 2, cumulativeCredits: 2 },
      { year: "9", yearCredits: 2, cumulativeCredits: 4 },
    ]);
  });
});
