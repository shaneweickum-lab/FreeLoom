"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { computeGpa, totalCredits } from "@/lib/gpa";
import { generateTranscriptPdf } from "@/lib/pdf";
import { encodeShareData } from "@/lib/share";
import { LETTER_GRADES, type Course, type LetterGrade } from "@/lib/types";

export default function TranscriptPage() {
  const { data, setData, hydrated } = useStore();
  const [copied, setCopied] = useState(false);

  if (!hydrated) return null;

  const { student, courses } = data;
  const gpa = computeGpa(courses);
  const credits = totalCredits(courses);

  function updateCourse(id: string, patch: Partial<Course>) {
    setData((prev) => ({
      ...prev,
      courses: prev.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }

  function removeCourse(id: string) {
    setData((prev) => ({
      ...prev,
      courses: prev.courses.filter((c) => c.id !== id),
      logEntries: prev.logEntries.map((e) =>
        e.courseId === id ? { ...e, acceptedIntoTranscript: false, courseId: null } : e
      ),
    }));
  }

  async function copyShareLink() {
    const encoded = encodeShareData({ student, courses });
    const url = `${window.location.origin}/share?d=${encoded}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between flex-wrap gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold mb-1">Transcript</h1>
          <p className="text-muted text-sm">
            Courses accepted from your Learning Log, with credit hours and GPA calculated
            automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => generateTranscriptPdf(student, courses)} className="btn-primary" disabled={courses.length === 0}>
            Download PDF
          </button>
          <button onClick={copyShareLink} className="btn-secondary" disabled={courses.length === 0}>
            {copied ? "Link copied!" : "Copy share link"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="text-xl font-semibold mb-1">{student.name || "Unnamed Student"}</div>
        <div className="text-muted text-sm mb-6">{student.gradeLevel || "Grade level not set"}</div>

        {courses.length === 0 ? (
          <p className="text-muted text-sm">
            No courses yet. Accept translated activities from the Learning Log to build your
            transcript.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-2 pr-4 font-medium">Course Title</th>
                  <th className="py-2 pr-4 font-medium">Subject Area</th>
                  <th className="py-2 pr-4 font-medium">Credits</th>
                  <th className="py-2 pr-4 font-medium">Grade</th>
                  <th className="py-2 no-print" />
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-4">{course.title}</td>
                    <td className="py-2.5 pr-4 text-muted">{course.subjectArea}</td>
                    <td className="py-2.5 pr-4">
                      <input
                        type="number"
                        min={0}
                        step={0.25}
                        value={course.creditHours}
                        onChange={(e) => updateCourse(course.id, { creditHours: Number(e.target.value) })}
                        className="input w-20 no-print"
                      />
                      <span className="hidden print:inline">{course.creditHours.toFixed(2)}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <select
                        value={course.grade}
                        onChange={(e) => updateCourse(course.id, { grade: e.target.value as LetterGrade })}
                        className="input w-20 no-print"
                      >
                        {LETTER_GRADES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                      <span className="hidden print:inline">{course.grade}</span>
                    </td>
                    <td className="py-2.5 no-print">
                      <button onClick={() => removeCourse(course.id)} className="text-xs text-muted hover:text-red-400">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {courses.length > 0 && (
          <div className="flex gap-8 mt-6 pt-4 border-t border-border text-sm">
            <div>
              <span className="text-muted">Cumulative Credit Hours: </span>
              <span className="font-semibold">{credits.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted">Cumulative GPA: </span>
              <span className="font-semibold text-gold">{gpa.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
