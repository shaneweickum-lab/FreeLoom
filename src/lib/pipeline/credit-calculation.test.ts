import { describe, expect, it } from "vitest";
import { sumCredits, cumulativeCreditsByYear, creditFromHours, guessIsLabScience } from "./credit-calculation";

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

describe("guessIsLabScience", () => {
  it("flags conventional lab-science subjects", () => {
    expect(guessIsLabScience("Biology")).toBe(true);
    expect(guessIsLabScience("Chemistry")).toBe(true);
    expect(guessIsLabScience("Physics")).toBe(true);
    expect(guessIsLabScience("AP Environmental Science")).toBe(true);
  });

  it("does not flag non-lab-science subjects, including a bare 'Science'", () => {
    expect(guessIsLabScience("Mathematics")).toBe(false);
    expect(guessIsLabScience("Language Arts")).toBe(false);
    expect(guessIsLabScience("Science")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(guessIsLabScience("BIOLOGY")).toBe(true);
    expect(guessIsLabScience("biology")).toBe(true);
  });
});

describe("creditFromHours", () => {
  it("converts 150 hours (the standard rate) into exactly 1.0 credit", () => {
    expect(creditFromHours(150 * 60, false, 0.25)).toBe(1);
  });

  it("converts 180 hours (the lab-science rate) into exactly 1.0 credit, unlike the standard rate", () => {
    expect(creditFromHours(180 * 60, true, 0.25)).toBe(1);
    // The same 180 hours at the standard 150hr/credit rate is 1.2, not 1 --
    // confirms the lab-science flag actually changes which divisor is used, not just the input.
    expect(creditFromHours(180 * 60, false, 0.25)).toBe(1.2);
  });

  it("rounds to the nearest hundredth of a credit, not a coarser quarter-credit grid", () => {
    // 100 standard hours is 0.6667 credits -- should round to 0.67, not jump to the
    // nearest quarter credit (0.75). Fine-grained rounding is the whole point of this
    // function: a parent should see their logged hours move the number every time,
    // not wait to cross a big fixed increment.
    expect(creditFromHours(100 * 60, false, 0.25)).toBe(0.67);
    // 172.5 standard hours is 1.15 credits exactly.
    expect(creditFromHours(172.5 * 60, false, 0.25)).toBe(1.15);
  });

  it("shows real, small progress for a single short session instead of a big invisible dead zone", () => {
    // The motivating real case: 240 minutes (4 hours) at the standard rate is
    // 0.0267 credits -- rounds to 0.03. The old quarter-credit rounding (with a 0.1
    // floor) would have shown 0.1 here, the same number a parent would keep seeing
    // for anything up to 15 hours logged in this subject -- weeks of apparently no
    // progress at a typical few-hours-a-week pace.
    expect(creditFromHours(240, false, 0.25)).toBe(0.03);
  });

  it("falls back to the given default when no time was logged", () => {
    expect(creditFromHours(null, false, 0.25)).toBe(0.25);
    expect(creditFromHours(undefined, true, 0.5)).toBe(0.5);
    expect(creditFromHours(0, false, 0.1)).toBe(0.1);
  });

  it("never returns below the 0.01 floor even for a very short logged duration", () => {
    // 5 minutes is a real (if tiny) logged duration, not "no time given" --
    // the rounded Carnegie-hours math alone would floor to 0 credit here;
    // the 0.01 floor is what keeps a genuinely-logged activity from scoring
    // as literally worthless, without wiping out this function's own
    // hundredths precision the way the old 0.1 floor did.
    expect(creditFromHours(5, false, 0.25)).toBe(0.01);
  });
});
