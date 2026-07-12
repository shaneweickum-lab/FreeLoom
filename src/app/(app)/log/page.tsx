"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import { ACTIVITY_TYPES, type ActivityType, type LearningLog, type TranslatedCourse } from "@/lib/types";

type LogWithCourse = LearningLog & { translated_courses: TranslatedCourse[] };

export default function LogPage() {
  const { currentStudent } = useStudents();
  const [logs, setLogs] = useState<LogWithCourse[]>([]);
  const [loading, setLoading] = useState(true);

  const [description, setDescription] = useState("");
  const [activityType, setActivityType] = useState<ActivityType>("other");
  const [sourcePlatform, setSourcePlatform] = useState("");
  const [minutes, setMinutes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [edits, setEdits] = useState<Record<string, Partial<TranslatedCourse>>>({});

  async function loadLogs() {
    if (!currentStudent) {
      setLogs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("learning_logs")
      .select("*, translated_courses(*)")
      .eq("student_id", currentStudent.id)
      .order("created_at", { ascending: false });
    setLogs((data as LogWithCourse[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStudent]);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!currentStudent || !description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const time_spent_minutes = minutes ? Number(minutes) : null;
      const res = await fetch("/api/translate-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_description: description,
          activity_type: activityType,
          source_platform: sourcePlatform || null,
          time_spent_minutes,
          grade_level: currentStudent.grade_level,
        }),
      });
      if (!res.ok) throw new Error("translate failed");
      const translation = await res.json();

      const supabase = createClient();
      const { data: log, error: logError } = await supabase
        .from("learning_logs")
        .insert({
          student_id: currentStudent.id,
          raw_description: description,
          activity_type: activityType,
          source_platform: sourcePlatform || null,
          time_spent_minutes,
        })
        .select()
        .single();
      if (logError || !log) throw logError;

      await supabase.from("translated_courses").insert({
        learning_log_id: log.id,
        course_title: translation.course_title,
        subject_area: translation.subject_area,
        credit_hours: translation.credit_hours,
        ai_rationale: translation.rationale,
        status: "suggested",
      });

      setDescription("");
      setSourcePlatform("");
      setMinutes("");
      await loadLogs();
    } catch {
      setError("Couldn't translate that activity — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function editField(courseId: string, patch: Partial<TranslatedCourse>) {
    setEdits((prev) => ({ ...prev, [courseId]: { ...prev[courseId], ...patch } }));
  }

  async function decide(course: TranslatedCourse, decision: "approve" | "reject") {
    const supabase = createClient();
    const pending = edits[course.id];
    const hasEdits = pending && Object.keys(pending).length > 0;
    const status = decision === "reject" ? "rejected" : hasEdits ? "edited" : "approved";
    await supabase
      .from("translated_courses")
      .update({ ...pending, status })
      .eq("id", course.id);
    setEdits((prev) => {
      const next = { ...prev };
      delete next[course.id];
      return next;
    });
    await loadLogs();
  }

  if (!currentStudent) {
    return <p className="text-muted text-sm">Add a child from the dashboard first.</p>;
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Learning Log</h1>
        <p className="text-muted text-sm">
          Describe an activity in plain language. The AI Translation Engine will map it to a
          course title, subject area, and credit estimate for you to approve, edit, or reject.
        </p>
      </div>

      <form onSubmit={addEntry} className="flex flex-col gap-3 rounded-lg border border-border bg-surface shadow-sm p-4">
        <textarea
          className="input min-h-24"
          placeholder="e.g. Spent the afternoon building automated factories in Factorio, wiring up circuit logic for the first time"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Activity type</span>
            <select className="input" value={activityType} onChange={(e) => setActivityType(e.target.value as ActivityType)}>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Source / platform (optional)</span>
            <input className="input" placeholder="e.g. Factorio, Recess" value={sourcePlatform} onChange={(e) => setSourcePlatform(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Time spent, minutes (optional)</span>
            <input type="number" min={0} className="input" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </label>
        </div>
        <button type="submit" className="btn-primary w-fit" disabled={submitting || !description.trim()}>
          {submitting ? "Translating…" : "Translate activity"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <div className="flex flex-col gap-4">
        {loading && <p className="text-muted text-sm">Loading…</p>}
        {!loading && logs.length === 0 && <p className="text-muted text-sm">No activities logged yet.</p>}
        {logs.map((log) => {
          const course = log.translated_courses?.[0];
          const pending = course ? edits[course.id] : undefined;
          return (
            <div key={log.id} className="rounded-lg border border-border bg-surface shadow-sm p-4">
              <div className="text-xs text-muted mb-1">{log.date_logged}</div>
              <p className="text-sm">{log.raw_description}</p>

              {course && (
                <div className="mt-3 rounded-md bg-background border border-border p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <input
                      className="input font-medium text-gold bg-transparent border-none px-0"
                      value={pending?.course_title ?? course.course_title}
                      disabled={course.status !== "suggested"}
                      onChange={(e) => editField(course.id, { course_title: e.target.value })}
                    />
                    <span className="text-xs text-muted font-mono uppercase">{course.status}</span>
                  </div>
                  <input
                    className="input text-sm bg-transparent border-none px-0 text-muted"
                    value={pending?.subject_area ?? course.subject_area}
                    disabled={course.status !== "suggested"}
                    onChange={(e) => editField(course.id, { subject_area: e.target.value })}
                  />
                  <p className="text-xs text-muted italic">{course.ai_rationale}</p>
                  <div className="flex items-center justify-between flex-wrap gap-2 mt-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="number"
                        step={0.05}
                        min={0}
                        className="input w-20"
                        value={pending?.credit_hours ?? course.credit_hours}
                        disabled={course.status !== "suggested"}
                        onChange={(e) => editField(course.id, { credit_hours: Number(e.target.value) })}
                      />
                      <span className="text-muted">credit hours</span>
                    </label>
                    {course.status === "suggested" ? (
                      <div className="flex gap-2">
                        <button onClick={() => decide(course, "reject")} className="btn-secondary text-xs">
                          Reject
                        </button>
                        <button onClick={() => decide(course, "approve")} className="btn-primary text-xs">
                          Approve
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted">
                        {course.status === "approved" && "Approved"}
                        {course.status === "edited" && "Approved (edited)"}
                        {course.status === "rejected" && "Rejected"}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
