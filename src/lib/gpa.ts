import { GRADE_POINTS, type Course } from "./types";

export function totalCredits(courses: Course[]): number {
  return Math.round(courses.reduce((sum, c) => sum + c.creditHours, 0) * 100) / 100;
}

export function computeGpa(courses: Course[]): number {
  const credits = totalCredits(courses);
  if (credits === 0) return 0;
  const points = courses.reduce((sum, c) => sum + c.creditHours * GRADE_POINTS[c.grade], 0);
  return Math.round((points / credits) * 100) / 100;
}
