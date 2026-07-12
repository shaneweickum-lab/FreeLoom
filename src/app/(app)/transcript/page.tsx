"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import type { TranslatedCourse, Transcript } from "@/lib/types";

export default function TranscriptPage() {
  const { currentStudent } = useStudents();
  const [courses, setCourses] = useState<TranslatedCourse[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    if (!currentStudent) {
      setCourses([]);
      setTranscripts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();

    const { data: logs } = await supabase.from("learning_logs").select("id").eq("student_id", currentStudent.id);
    const logIds = (logs || []).map((l) => l.id);

    const { data: approvedCourses } = logIds.length
      ? await supabase
          .from("translated_courses")
          .select("*")
          .in("learning_log_id", logIds)
          .in("status", ["approved", "edited"])
          .order("created_at", { ascending: true })
      : { data: [] };

    const { data: pastTranscripts } = await supabase
      .from("transcripts")
      .select("*")
      .eq("student_id", currentStudent.id)
      .order("generated_at", { ascending: false });

    setCourses(approvedCourses || []);
    setTranscripts(pastTranscripts || []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStudent]);

  const totalCreditHours = Math.round(courses.reduce((sum, c) => sum + c.credit_hours, 0) * 100) / 100;

  async function generateTranscript() {
    if (!currentStudent || courses.length === 0) return;
    setGenerating(true);
    const supabase = createClient();
    await supabase.from("transcripts").insert({
      student_id: currentStudent.id,
      included_course_ids: courses.map((c) => c.id),
    });
    await load();
    setGenerating(false);
  }

  async function copyShareLink(transcriptId: string) {
    const url = `${window.location.origin}/share/${transcriptId}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(transcriptId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  if (!currentStudent) {
    return <p className="text-muted text-sm">Add a child from the dashboard first.</p>;
  }
  if (loading) return null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">Transcript</h1>
          <p className="text-muted text-sm">Approved courses for {currentStudent.name}, with cumulative credit hours.</p>
        </div>
        <button onClick={generateTranscript} className="btn-primary" disabled={generating || courses.length === 0}>
          {generating ? "Generating…" : "Generate transcript"}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-surface shadow-sm p-6">
        <div className="text-xl font-semibold mb-1">{currentStudent.name}</div>
        <div className="text-muted text-sm mb-6">{currentStudent.grade_level || "Grade level not set"}</div>

        {courses.length === 0 ? (
          <p className="text-muted text-sm">
            No approved courses yet. Approve translated activities from the Learning Log to build your transcript.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-2 pr-4 font-medium">Course Title</th>
                  <th className="py-2 pr-4 font-medium">Subject Area</th>
                  <th className="py-2 font-medium">Credits</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-4">{course.course_title}</td>
                    <td className="py-2.5 pr-4 text-muted">{course.subject_area}</td>
                    <td className="py-2.5">{course.credit_hours.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {courses.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border text-sm">
            <span className="text-muted">Cumulative Credit Hours: </span>
            <span className="font-semibold text-gold">{totalCreditHours.toFixed(2)}</span>
          </div>
        )}
      </div>

      {transcripts.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">Generated transcripts</h2>
          {transcripts.map((t) => (
            <div key={t.id} className="rounded-lg border border-border bg-surface shadow-sm p-4 flex items-center justify-between gap-4">
              <div className="text-sm">
                <div>{new Date(t.generated_at).toLocaleString()}</div>
                <div className="text-muted text-xs">{t.included_course_ids.length} course(s)</div>
              </div>
              <div className="flex gap-2">
                <a href={`/api/transcript-pdf/${t.id}`} className="btn-secondary text-xs">
                  Download PDF
                </a>
                <button onClick={() => copyShareLink(t.id)} className="btn-secondary text-xs">
                  {copiedId === t.id ? "Link copied!" : "Copy share link"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
