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
