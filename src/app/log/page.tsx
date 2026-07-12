"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import type { Course, LearningLogEntry } from "@/lib/types";

const SOURCE_LABEL: Record<NonNullable<LearningLogEntry["translation"]>["source"], string> = {
  "knowledge-base": "Matched to known activity",
  "ai-refined": "AI-refined",
  heuristic: "Heuristic match",
};

export default function LogPage() {
  const { data, setData, hydrated } = useStore();
  const [description, setDescription] = useState("");
  const [hoursSpent, setHoursSpent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hydrated) return null;

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const hours = hoursSpent ? Number(hoursSpent) : undefined;
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, hoursSpent: hours }),
      });
      if (!res.ok) throw new Error("Translation request failed");
      const translation = await res.json();

      const entry: LearningLogEntry = {
        id: crypto.randomUUID(),
        date: new Date().toISOString().slice(0, 10),
        description,
        hoursSpent: hours,
        translation,
        acceptedIntoTranscript: false,
        courseId: null,
      };
      setData((prev) => ({ ...prev, logEntries: [entry, ...prev.logEntries] }));
      setDescription("");
      setHoursSpent("");
    } catch {
      setError("Couldn't translate that activity — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function acceptToTranscript(entry: LearningLogEntry) {
    if (!entry.translation) return;
    const course: Course = {
      id: crypto.randomUUID(),
      title: entry.translation.courseTitle,
      subjectArea: entry.translation.subjectArea,
      creditHours: entry.translation.creditHours,
      grade: "B+",
      logEntryIds: [entry.id],
    };
    setData((prev) => ({
      ...prev,
      courses: [...prev.courses, course],
      logEntries: prev.logEntries.map((e) =>
        e.id === entry.id ? { ...e, acceptedIntoTranscript: true, courseId: course.id } : e
      ),
    }));
  }

  function removeFromTranscript(entry: LearningLogEntry) {
    setData((prev) => ({
      ...prev,
      courses: prev.courses.filter((c) => c.id !== entry.courseId),
      logEntries: prev.logEntries.map((e) =>
        e.id === entry.id ? { ...e, acceptedIntoTranscript: false, courseId: null } : e
      ),
    }));
  }

  function deleteEntry(entry: LearningLogEntry) {
    setData((prev) => ({
      ...prev,
      logEntries: prev.logEntries.filter((e) => e.id !== entry.id),
      courses: entry.courseId ? prev.courses.filter((c) => c.id !== entry.courseId) : prev.courses,
    }));
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Learning Log</h1>
        <p className="text-muted text-sm">
          Describe an activity in plain language. The AI Translation Engine will map it to a
          course title, subject area, and credit estimate.
        </p>
      </div>

      <form onSubmit={addEntry} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <textarea
          className="input min-h-24"
          placeholder="e.g. Spent the afternoon building automated factories in Factorio, wiring up circuit logic for the first time"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm w-40">
            <span className="text-muted">Hours spent (optional)</span>
            <input
              type="number"
              min={0}
              step={0.5}
              className="input"
              value={hoursSpent}
              onChange={(e) => setHoursSpent(e.target.value)}
            />
          </label>
          <button type="submit" className="btn-primary" disabled={submitting || !description.trim()}>
            {submitting ? "Translating…" : "Translate activity"}
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>

      <div className="flex flex-col gap-4">
        {data.logEntries.length === 0 && (
          <p className="text-muted text-sm">No activities logged yet.</p>
        )}
        {data.logEntries.map((entry) => (
          <div key={entry.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex justify-between items-start gap-4">
              <div>
                <div className="text-xs text-muted mb-1">{entry.date}</div>
                <p className="text-sm">{entry.description}</p>
              </div>
              <button
                onClick={() => deleteEntry(entry)}
                className="text-xs text-muted hover:text-red-400 shrink-0"
              >
                Delete
              </button>
            </div>

            {entry.translation && (
              <div className="mt-3 rounded-md bg-black/20 border border-border p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="font-medium text-gold">{entry.translation.courseTitle}</div>
                  <span className="text-xs text-muted font-mono">
                    {SOURCE_LABEL[entry.translation.source]}
                  </span>
                </div>
                <div className="text-sm text-muted">{entry.translation.subjectArea}</div>
                <div className="flex flex-wrap gap-1.5">
                  {entry.translation.skills.map((skill) => (
                    <span
                      key={skill}
                      className="text-xs rounded-full border border-border px-2 py-0.5 text-muted"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted italic">{entry.translation.rationale}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm">{entry.translation.creditHours.toFixed(2)} credit hours</span>
                  {entry.acceptedIntoTranscript ? (
                    <button
                      onClick={() => removeFromTranscript(entry)}
                      className="text-xs px-3 py-1.5 rounded-md border border-gold text-gold"
                    >
                      In transcript — remove
                    </button>
                  ) : (
                    <button onClick={() => acceptToTranscript(entry)} className="btn-primary text-xs">
                      Add to transcript
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
