/**
 * A family's chosen schooling structure (full year / semester / trimester /
 * quarter) plus the actual date-ranged sessions built on top of it (e.g.
 * "Fall Semester 2026: Aug 15 - Dec 20"). One structure/session list per
 * account (school_profiles.schooling_structure + the academic_sessions
 * table), not per student -- most homeschool families run one shared
 * calendar for every student in the house even when each student's pace
 * differs.
 *
 * findOrCreateClass() (src/app/(app)/log/page.tsx) uses findCurrentSession()
 * below to decide which open session a newly logged activity's class
 * belongs to -- that's what makes entries in the same subject category
 * accumulate into one class record per session instead of one permanent
 * record for all time.
 */

export type SchoolingStructure = "full_year" | "semester" | "trimester" | "quarter";

export const SCHOOLING_STRUCTURE_OPTIONS: { value: SchoolingStructure; label: string }[] = [
  { value: "full_year", label: "Full year" },
  { value: "semester", label: "Semester" },
  { value: "trimester", label: "Trimester" },
  { value: "quarter", label: "Quarter" },
];

export type AcademicSession = {
  id: string;
  user_id: string;
  label: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  created_at: string;
};

/**
 * Finds the session whose [start_date, end_date] (inclusive) contains `on`
 * (a YYYY-MM-DD calendar date, defaulting to today). Plain string
 * comparison is intentional and correct here -- YYYY-MM-DD sorts
 * lexicographically in exactly calendar order, so this avoids every
 * timezone/Date-parsing pitfall a `new Date(...)` comparison would
 * introduce for what's fundamentally a calendar-date question, not a
 * moment-in-time one.
 *
 * Returns null when no session covers that date -- no sessions set up yet,
 * or a real gap between two sessions. Callers should treat that as "not
 * session-scoped" (the pre-existing, permanent-class behavior), not an
 * error: session-scoping is opt-in by actually building out a schedule, not
 * a requirement to use the app at all.
 *
 * If sessions overlap (a data-entry mistake this app doesn't prevent at the
 * DB level), the first match in `sessions`' own order wins -- deterministic,
 * simple, and callers control apparent priority via query order.
 */
export function findCurrentSession(sessions: AcademicSession[], on?: string): AcademicSession | null {
  const targetDate = on ?? new Date().toISOString().slice(0, 10);
  return sessions.find((session) => session.start_date <= targetDate && targetDate <= session.end_date) ?? null;
}

const MS_PER_DAY = 86_400_000;

/** Parses a YYYY-MM-DD string as a UTC-midnight timestamp -- plain
 * `new Date(dateStr)` parsing is timezone-dependent for date-only strings
 * in some engines, and this only ever needs calendar-day arithmetic, not a
 * real moment in time. */
function parseDateUTC(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatDateUTC(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addUTCDays(dateStr: string, days: number): string {
  return formatDateUTC(parseDateUTC(dateStr) + days * MS_PER_DAY);
}

/** Number of calendar days spanned by [startDate, endDate], both inclusive
 * -- e.g. the same day both ways is a 1-day span. */
function inclusiveDaySpan(startDate: string, endDate: string): number {
  return Math.round((parseDateUTC(endDate) - parseDateUTC(startDate)) / MS_PER_DAY) + 1;
}

/** Base label per sub-session, in the order they occur across the year --
 * the calendar year of each session's own start date gets appended
 * afterward, so these stay singular ("Quarter 1", not "Quarter 1 Fall"). */
const STRUCTURE_SESSION_LABELS: Record<SchoolingStructure, string[]> = {
  full_year: ["Full Year"],
  semester: ["Fall Semester", "Spring Semester"],
  trimester: ["Trimester 1", "Trimester 2", "Trimester 3"],
  quarter: ["Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4"],
};

export type ProposedSession = { label: string; start_date: string; end_date: string };

/**
 * Splits [yearStartDate, yearEndDate] into contiguous, non-overlapping
 * date ranges matching `structure` (1 for full_year, 2 for semester, 3 for
 * trimester, 4 for quarter) -- a starting point a parent then reviews,
 * edits, or discards, not a final answer (see AcademicTab.tsx's proposal
 * preview). Splits proportionally by calendar day so a 366-day year
 * divides as evenly as integer days allow; the last chunk absorbs any
 * remainder. Returns [] if the range is invalid (end before start).
 */
export function generateProposedSessions(
  structure: SchoolingStructure,
  yearStartDate: string,
  yearEndDate: string
): ProposedSession[] {
  if (yearEndDate < yearStartDate) return [];
  const labels = STRUCTURE_SESSION_LABELS[structure];
  const n = labels.length;
  const totalDays = inclusiveDaySpan(yearStartDate, yearEndDate);

  const sessions: ProposedSession[] = [];
  for (let i = 0; i < n; i++) {
    const startOffset = Math.floor((i * totalDays) / n);
    const endOffset = Math.floor(((i + 1) * totalDays) / n) - 1;
    const start_date = addUTCDays(yearStartDate, startOffset);
    const end_date = addUTCDays(yearStartDate, endOffset);
    sessions.push({ label: `${labels[i]} ${start_date.slice(0, 4)}`, start_date, end_date });
  }
  return sessions;
}
