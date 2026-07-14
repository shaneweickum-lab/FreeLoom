/**
 * The Loom's ledger.
 *
 * Every other part of the pipeline is allowed to guess, draft, and defer to a
 * parent's judgment — this file is the one place that isn't allowed to be
 * wrong. It turns a child's entries into the credit totals a transcript
 * ultimately reports, and it's written as pure, boring arithmetic on purpose.
 *
 * Known history: the previous implementation summed credit values as
 * floating-point numbers directly in a running total, and drifted low by
 * 0.5 cumulative credits starting in the second year — a classic case of
 * binary floating-point error (0.5, 1.25, etc. don't always round-trip
 * exactly) compounding silently across a long-running sum. The fix here is
 * structural, not a one-off patch: every credit value is converted to
 * integer hundredths before it's ever added to anything, all addition
 * happens in that integer space, and the only place a value becomes a
 * decimal again is the instant it's handed back to the caller. Integers
 * don't drift, so this class of bug can't recur here regardless of how
 * many years of entries get thrown at it.
 */

/** A single transcript-relevant fact: how many credits, earned in which year. */
export type CreditEntry = {
  creditValue: number;
  year: string;
};

/** One year's contribution plus the running total through the end of that year. */
export type YearlyCreditTotal = {
  year: string;
  yearCredits: number;
  cumulativeCredits: number;
};

const HUNDREDTHS = 100;

/** Converts a decimal credit value (e.g. 0.5, 1.25) into exact integer hundredths. */
function toHundredths(creditValue: number): number {
  return Math.round(creditValue * HUNDREDTHS);
}

/** Converts integer hundredths back into the decimal credit value callers expect. */
function fromHundredths(hundredths: number): number {
  return hundredths / HUNDREDTHS;
}

/**
 * Sums a flat list of credit values with no year grouping — the simplest
 * building block, and the one every other function here is built on top of.
 * Never sums the raw numbers directly; always routes through integer
 * hundredths first.
 */
export function sumCredits(creditValues: number[]): number {
  const totalHundredths = creditValues.reduce((sum, value) => sum + toHundredths(value), 0);
  return fromHundredths(totalHundredths);
}

/**
 * Groups entries by year (preserving the order years first appear in) and
 * returns each year's own credit total alongside the running cumulative
 * total through that year — the exact shape a transcript's "credits earned"
 * row needs. This is where the historical bug actually surfaced: the drift
 * was invisible within a single year and only became visible once a second
 * year's total got added to the first's.
 */
export function cumulativeCreditsByYear(entries: CreditEntry[]): YearlyCreditTotal[] {
  const orderedYears: string[] = [];
  const hundredthsByYear = new Map<string, number>();

  for (const entry of entries) {
    if (!hundredthsByYear.has(entry.year)) {
      orderedYears.push(entry.year);
      hundredthsByYear.set(entry.year, 0);
    }
    hundredthsByYear.set(entry.year, hundredthsByYear.get(entry.year)! + toHundredths(entry.creditValue));
  }

  let runningHundredths = 0;
  return orderedYears.map((year) => {
    const yearHundredths = hundredthsByYear.get(year)!;
    runningHundredths += yearHundredths;
    return {
      year,
      yearCredits: fromHundredths(yearHundredths),
      cumulativeCredits: fromHundredths(runningHundredths),
    };
  });
}
