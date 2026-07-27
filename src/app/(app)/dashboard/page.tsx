"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStudents } from "@/lib/studentContext";
import type { Student } from "@/lib/types";
import StudentForm, {
  EMPTY_STUDENT_FORM,
  studentFormToPatch,
  studentToFormValues,
  type StudentFormValues,
} from "@/components/StudentForm";

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPageInner />
    </Suspense>
  );
}

function DashboardPageInner() {
  const searchParams = useSearchParams();
  const {
    students,
    currentStudent,
    stats,
    selectStudent,
    createStudent,
    updateStudent,
    deleteStudent,
    createError,
    loading: studentsLoading,
  } = useStudents();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StudentFormValues>(EMPTY_STUDENT_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Only after the real student list has loaded — students.length is 0 on
    // every mount until the async fetch resolves, so gating on it directly
    // was forcing this form open on every reload, even for existing families.
    // This is also the ONLY place a new student can be created once an
    // account already has at least one profile -- adding another lives in
    // Settings > Academic instead (see AcademicTab.tsx), so this dashboard
    // form only ever opens for the very first student or to edit an
    // existing one.
    if (!studentsLoading && students.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowForm(true);
    }
  }, [studentsLoading, students.length]);

  useEffect(() => {
    // Deep link from the student switcher's "Add your first student" --
    // only reachable when the account has zero students, matching the
    // effect above.
    if (searchParams.get("new") === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowForm(true);
      setEditingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEdit(s: Student) {
    setEditingId(s.id);
    setForm(studentToFormValues(s));
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    const patch = studentFormToPatch(form);
    if (editingId) {
      await updateStudent(editingId, patch);
    } else {
      await createStudent(patch);
    }
    setForm(EMPTY_STUDENT_FORM);
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
        <h1 className="text-2xl font-bold mb-1">Your students</h1>
        <p className="text-muted text-sm">
          One FreeLoom account for your whole family — switch between student profiles any time from the nav bar.
          Every student gets their own discovery notes, learning log, transcript, and portfolio.
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

      {showForm && (
        <StudentForm
          form={form}
          onChange={setForm}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditingId(null);
          }}
          submitting={submitting}
          isEditing={!!editingId}
          showCancel={!!editingId}
        />
      )}

      {students.length > 0 && !showForm && (
        <p className="text-muted text-sm">
          Want to add another student?{" "}
          <a href="/settings?tab=academic" className="text-gold hover:underline">
            Head to Settings &gt; Academic
          </a>
          .
        </p>
      )}
    </div>
  );
}
