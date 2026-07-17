"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStudents } from "@/lib/studentContext";
import type { Student } from "@/lib/types";

const EMPTY_FORM = {
  name: "",
  gradeLevel: "",
  state: "",
  birthDate: "",
  gradYear: "",
  gender: "",
  graduationDate: "",
};

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPageInner />
    </Suspense>
  );
}

function DashboardPageInner() {
  const router = useRouter();
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
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

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
    // Deep link from the nav switcher's "+ Add a student" (?new=1) —
    // open the create form immediately instead of landing on a page the
    // parent then has to find the button on themselves.
    if (searchParams.get("new") === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowForm(true);
      setEditingId(null);
      router.replace("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      gender: s.gender || "",
      graduationDate: s.graduation_date || "",
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
      gender: form.gender || null,
      graduation_date: form.graduationDate || null,
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
        <h1 className="text-2xl font-bold mb-1">Your students</h1>
        <p className="text-muted text-sm">
          One FreeLoom account for your whole family — add a profile for each student and switch between them
          any time from the nav bar. Every student gets their own discovery notes, learning log, transcript, and
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
        <button onClick={startCreate} className="btn-secondary w-fit">
          + Add another student
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface shadow-sm p-4 max-w-lg">
          <h2 className="font-semibold">{editingId ? "Edit student profile" : "New student profile"}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              placeholder="Student's name"
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
          <div className="grid gap-3 sm:grid-cols-2">
            <select className="input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="">Gender (optional)</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Graduation date (once known — for the official transcript)
              <input
                type="date"
                className="input"
                value={form.graduationDate}
                onChange={(e) => setForm({ ...form, graduationDate: e.target.value })}
              />
            </label>
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
