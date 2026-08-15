import { describe, expect, it } from "vitest";
import { parseEntriesCsv } from "./importEntries";

const HEADER = "date,subject,course_title,description,hours";

describe("parseEntriesCsv", () => {
  it("parses a well-formed row", () => {
    const csv = `${HEADER}\n2025-09-03,Mathematics,Algebra I,Worked through chapter 3 word problems,1.5`;
    const { rows, errors } = parseEntriesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subjectArea: "Mathematics",
      courseTitle: "Algebra I",
      description: "Worked through chapter 3 word problems",
      hours: 1.5,
    });
    expect(rows[0].date.startsWith("2025-09-03")).toBe(true);
  });

  it("defaults course_title to the subject when left blank", () => {
    const csv = `${HEADER}\n2025-09-03,Mathematics,,Worked through chapter 3,1`;
    const { rows } = parseEntriesCsv(csv);
    expect(rows[0].courseTitle).toBe("Mathematics");
  });

  it("handles a quoted description containing commas", () => {
    const csv = `${HEADER}\n2025-09-03,Science,Biology,"Read about cells, mitochondria, and DNA",2`;
    const { rows, errors } = parseEntriesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0].description).toBe("Read about cells, mitochondria, and DNA");
  });

  it("is case-insensitive and order-independent about column headers", () => {
    const csv = `Hours,Description,Subject,Date\n1.5,Practiced piano scales,Music,2025-09-03`;
    const { rows, errors } = parseEntriesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ subjectArea: "Music", hours: 1.5 });
  });

  it("reports a missing-column error and returns no rows when a required column is absent", () => {
    const csv = "date,subject,description\n2025-09-03,Music,Practiced piano";
    const { rows, errors } = parseEntriesCsv(csv);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("hours");
  });

  it("collects a per-row error for an unparseable date without dropping other good rows", () => {
    const csv = `${HEADER}\nnot-a-date,Music,Piano,Practiced scales,1\n2025-09-03,Math,Algebra,Chapter 3,1`;
    const { rows, errors } = parseEntriesCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].subjectArea).toBe("Math");
    expect(errors).toEqual([{ line: 2, message: 'Couldn\'t understand the date "not-a-date".' }]);
  });

  it("collects a per-row error for missing hours", () => {
    const csv = `${HEADER}\n2025-09-03,Music,Piano,Practiced scales,`;
    const { rows, errors } = parseEntriesCsv(csv);
    expect(rows).toEqual([]);
    expect(errors[0].message).toContain("valid number of hours");
  });

  it("collects a per-row error for zero or negative hours", () => {
    const csv = `${HEADER}\n2025-09-03,Music,Piano,Practiced scales,0\n2025-09-04,Music,Piano,Practiced scales,-1`;
    const { rows, errors } = parseEntriesCsv(csv);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it("collects a per-row error for a missing subject or description", () => {
    const csv = `${HEADER}\n2025-09-03,,Piano,,1`;
    const { rows, errors } = parseEntriesCsv(csv);
    expect(rows).toEqual([]);
    expect(errors[0].message).toBe("Missing a subject.");
  });

  it("returns a single error for empty input", () => {
    const { rows, errors } = parseEntriesCsv("");
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 0, message: "No data found." }]);
  });

  it("ignores blank lines between rows", () => {
    const csv = `${HEADER}\n\n2025-09-03,Music,Piano,Practiced scales,1\n\n`;
    const { rows, errors } = parseEntriesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });
});
