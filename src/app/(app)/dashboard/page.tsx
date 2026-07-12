"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import { usePlan } from "@/lib/planContext";
import type { Student } from "@/lib/types";

const EMPTY_FORM = { name: "", gradeLevel: "", state: "", birthDate: "", gradYear: "" };

type StudentStats = { courseCount: number; creditHours: number };

export default function DashboardPage() {
  const {
    students,
    currentStudent,
    selectStudent,
    createStudent,
    updateStudent,
    deleteStudent,
    createError,
    loading: studentsLoading,
  } = useStudents();
  const { summary } = usePlan();
  const atChildLimit = summary?.maxChildren != null && students.length >= summary.maxChildren;
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [stats, setStats] = useState<Record<string, StudentStats>>({});

  useEffect(() => {
    // Only after the real student list has loaded — students.length is 0 on
    // every mount until the async fetch resolves, so gating on it directly
    // was forcing this form open on every reload, even for existing families.
    if (!studentsLoading && students.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowForm(true);
    }
  }, [studentsLoading, students.length]);

  useEffect(() => {
    if (students.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStats({});
      return;
    }
    const supabase = createClient();
    const studentIds = students.map((s) => s.id);
    (async () => {
      const { data: logs } = await supabase.from("learning_logs").select("id, student_id").in("student_id", studentIds);
      const logIdToStudent = new Map((logs || []).map((l) => [l.id, l.student_id]));
      const logIds = (logs || []).map((l) => l.id);
      if (logIds.length === 0) {
        setStats({});
        return;
      }
      const { data: courses } = await supabase
        .from("translated_courses")
        .select("learning_log_id, credit_hours")
        .in("learning_log_id", logIds)
        .in("status", ["approved", "edited"]);
      const next: Record<string, StudentStats> = {};
      for (const course of courses || []) {
        const studentId = logIdToStudent.get(course.learning_log_id);
        if (!studentId) continue;
        const entry = next[studentId] || { courseCount: 0, creditHours: 0 };
        entry.courseCount += 1;
        entry.creditHours += course.credit_hours;
        next[studentId] = entry;
      }
      setStats(next);
    })();
  }, [students]);

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function startEdit(s: Student) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      gradeLevel: s.grade_level || "",
      state: s.state || "",
      birthDate: s.birth_date || "",
      gradYear: s.expected_graduation_year ? String(s.expected_graduation_year) : "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    const patch = {
      name: form.name,
      grade_level: form.gradeLevel || null,
      state: form.state || null,
      birth_date: form.birthDate || null,
      expected_graduation_year: form.gradYear ? Number(form.gradYear) : null,
    };
    if (editingId) {
      await updateStudent(editingId, patch);
    } else {
      await createStudent(patch);
    }
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSubmitting(false);
    setShowForm(false);
  }

  async function handleDelete(s: Student) {
    const confirmed = window.confirm(
      `Remove ${s.name}'s profile? This permanently deletes their learning log, transcripts, and portfolio.`
    );
    if (!confirmed) return;
    await deleteStudent(s.id);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Your children</h1>
        <p className="text-muted text-sm">
          One FreeLoom account for your whole family — add a profile for each child and switch between them
          any time from the nav bar. Every child gets their own discovery notes, learning log, transcript, and
          portfolio.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {students.map((s) => {
          const stat = stats[s.id];
          return (
            <div
              key={s.id}
              className={`rounded-lg border p-4 shadow-sm transition-colors ${
                currentStudent?.id === s.id ? "border-gold bg-surface" : "border-border bg-surface"
              }`}
            >
              <button onClick={() => selectStudent(s.id)} className="text-left w-full">
                <div className="font-medium">{s.name}</div>
                <div className="text-sm text-muted">{s.grade_level || "Grade level not set"}</div>
                {s.state && <div className="text-xs text-muted mt-1">{s.state}</div>}
                {stat && (
                  <div className="text-xs text-muted mt-2">
                    {stat.courseCount} course{stat.courseCount === 1 ? "" : "s"} &middot; {stat.creditHours.toFixed(2)}{" "}
                    credit hours
                  </div>
                )}
                {currentStudent?.id === s.id && <div className="text-xs text-gold mt-2">Active</div>}
              </button>
              <div className="flex gap-3 mt-3 pt-3 border-t border-border/60">
                <button onClick={() => startEdit(s)} className="text-xs text-muted hover:text-foreground">
                  Edit
                </button>
                <button onClick={() => handleDelete(s)} className="text-xs text-muted hover:text-red-600">
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {createError && <p className="text-sm text-red-600">{createError}</p>}

      {!showForm ? (
        atChildLimit ? (
          <div className="rounded-lg border border-gold/40 bg-surface shadow-sm p-4 max-w-lg flex flex-col gap-2">
            <p className="text-sm font-medium">You&apos;ve reached your plan&apos;s child limit</p>
            <p className="text-sm text-muted">
              Your {summary?.plan} plan allows {summary?.maxChildren} child
              {summary?.maxChildren === 1 ? "" : "ren"}. Upgrade to add more.
            </p>
            <Link href="/billing" className="btn-primary text-xs px-3 py-2 w-fit">
              View plans
            </Link>
          </div>
        ) : (
          <button onClick={startCreate} className="btn-secondary w-fit">
            + Add another child
          </button>
        )
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface shadow-sm p-4 max-w-lg">
          <h2 className="font-semibold">{editingId ? "Edit child profile" : "New child profile"}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              placeholder="Child's name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              className="input"
              placeholder="Grade level (e.g. 9th grade)"
              value={form.gradeLevel}
              onChange={(e) => setForm({ ...form, gradeLevel: e.target.value })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              className="input"
              placeholder="State (e.g. CA, TX, NY)"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
            <input
              type="date"
              className="input"
              value={form.birthDate}
              onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
            />
            <input
              type="number"
              className="input"
              placeholder="Expected grad year"
              value={form.gradYear}
              onChange={(e) => setForm({ ...form, gradYear: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={submitting || !form.name.trim()}>
              {editingId ? "Save changes" : "Create profile"}
            </button>
            {(students.length > 0 || editingId) && (
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
