export const GRADE_POINTS: Record<string, number> = {
  "A+": 4,
  A: 4,
  "A-": 3.7,
  "B+": 3.3,
  B: 3,
  "B-": 2.7,
  "C+": 2.3,
  C: 2,
  "C-": 1.7,
  "D+": 1.3,
  D: 1,
  "D-": 0.7,
  F: 0,
};

export const GRADE_LEVELS = ["9", "10", "11", "12"] as const;

export type GradableCourse = {
  credit_hours: number;
  letter_grade: string | null;
  grade_level: string | null;
};

/** Returns null for ungraded/pass-fail courses — they count toward total credits but not GPA. */
export function gradePoints(letterGrade: string | null): number | null {
  if (!letterGrade) return null;
  return GRADE_POINTS[letterGrade.trim().toUpperCase()] ?? null;
}

export function computeGpa(courses: GradableCourse[]): { gpaCredits: number; gpaPoints: number; gpa: number | null } {
  let gpaCredits = 0;
  let gpaPoints = 0;
  for (const c of courses) {
    const points = gradePoints(c.letter_grade);
    if (points === null) continue;
    gpaCredits += c.credit_hours;
    gpaPoints += c.credit_hours * points;
  }
  return {
    gpaCredits: Math.round(gpaCredits * 100) / 100,
    gpaPoints: Math.round(gpaPoints * 100) / 100,
    gpa: gpaCredits > 0 ? Math.round((gpaPoints / gpaCredits) * 100) / 100 : null,
  };
}

/** Groups courses by HS grade level (9/10/11/12), with anything unset bucketed under "Other". */
export function groupByGradeLevel<T extends GradableCourse>(courses: T[]): { level: string; courses: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const c of courses) {
    const level = c.grade_level && GRADE_LEVELS.includes(c.grade_level as (typeof GRADE_LEVELS)[number]) ? c.grade_level : "Other";
    const bucket = buckets.get(level) ?? [];
    bucket.push(c);
    buckets.set(level, bucket);
  }
  const ordered: { level: string; courses: T[] }[] = [];
  for (const level of GRADE_LEVELS) {
    if (buckets.has(level)) ordered.push({ level, courses: buckets.get(level)! });
  }
  if (buckets.has("Other")) ordered.push({ level: "Other", courses: buckets.get("Other")! });
  return ordered;
}
