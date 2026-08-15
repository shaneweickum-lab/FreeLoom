/**
 * Parses a pasted/uploaded CSV of historical records so a family switching
 * from a spreadsheet mid-year doesn't have to retype every past entry by
 * hand. Deliberately a hand-rolled minimal parser (quoted-field handling
 * only, no embedded newlines inside a field) rather than a dependency --
 * matches the house preference elsewhere in this pipeline for small,
 * fully-owned parsers over pulling in a library for something this bounded.
 *
 * Expected columns (header row required, case-insensitive): date, subject,
 * course_title (optional), description, hours.
 */

export type ImportedEntryRow = {
  /** ISO date-time string (midnight UTC on the given calendar day). */
  date: string;
  subjectArea: string;
  courseTitle: string;
  description: string;
  hours: number;
};

export type ImportRowError = { line: number; message: string };

export type ParsedImport = { rows: ImportedEntryRow[]; errors: ImportRowError[] };

const REQUIRED_HEADERS = ["date", "subject", "description", "hours"] as const;

/** Splits one CSV line into fields, honoring double-quoted fields (so a
 * description copy-pasted from a spreadsheet can contain commas) and a
 * doubled `""` as an escaped quote inside one. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * Parses the whole CSV text. Rows that fail validation are collected as
 * errors (with their original line number, 1-indexed to match what a
 * parent sees if they open the file in a spreadsheet app) rather than
 * aborting the whole import -- one bad row shouldn't block the other 200
 * good ones from a family's actual spreadsheet.
 */
export function parseEntriesCsv(text: string): ParsedImport {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, message: "No data found." }] };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !header.includes(h));
  if (missingHeaders.length > 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: `Missing required column(s): ${missingHeaders.join(", ")}.` }],
    };
  }

  const dateIdx = header.indexOf("date");
  const subjectIdx = header.indexOf("subject");
  const courseTitleIdx = header.indexOf("course_title");
  const descriptionIdx = header.indexOf("description");
  const hoursIdx = header.indexOf("hours");

  const rows: ImportedEntryRow[] = [];
  const errors: ImportRowError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const fields = splitCsvLine(lines[i]);

    const rawDate = fields[dateIdx] ?? "";
    const subjectArea = fields[subjectIdx] ?? "";
    const courseTitle = (courseTitleIdx >= 0 ? fields[courseTitleIdx] : "") || subjectArea;
    const description = fields[descriptionIdx] ?? "";
    const rawHours = fields[hoursIdx] ?? "";

    if (!subjectArea) {
      errors.push({ line: lineNumber, message: "Missing a subject." });
      continue;
    }
    if (!description) {
      errors.push({ line: lineNumber, message: "Missing a description." });
      continue;
    }

    const parsedDate = new Date(rawDate);
    if (!rawDate || Number.isNaN(parsedDate.getTime())) {
      errors.push({ line: lineNumber, message: `Couldn't understand the date "${rawDate}".` });
      continue;
    }

    const hours = Number(rawHours);
    if (!rawHours || !Number.isFinite(hours) || hours <= 0) {
      errors.push({ line: lineNumber, message: `"${rawHours}" isn't a valid number of hours.` });
      continue;
    }

    rows.push({ date: parsedDate.toISOString(), subjectArea, courseTitle, description, hours });
  }

  return { rows, errors };
}
