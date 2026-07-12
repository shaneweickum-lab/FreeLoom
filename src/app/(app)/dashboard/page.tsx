"use client";

import { useState } from "react";
import { useStudents } from "@/lib/studentContext";

const US_STATES_HINT = "e.g. CA, TX, NY";

export default function DashboardPage() {
  const { students, currentStudent, selectStudent, createStudent } = useStudents();
  const [showForm, setShowForm] = useState(students.length === 0);
  const [name, setName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [state, setState] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gradYear, setGradYear] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    await createStudent({
      name,
      grade_level: gradeLevel || null,
      state: state || null,
      birth_date: birthDate || null,
      expected_graduation_year: gradYear ? Number(gradYear) : null,
    });
    setName("");
    setGradeLevel("");
    setState("");
    setBirthDate("");
    setGradYear("");
    setSubmitting(false);
    setShowForm(false);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Students</h1>
        <p className="text-muted text-sm">Manage the student profiles on your account.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {students.map((s) => (
          <button
            key={s.id}
            onClick={() => selectStudent(s.id)}
            className={`text-left rounded-lg border p-4 transition-colors ${
              currentStudent?.id === s.id ? "border-gold bg-surface" : "border-border bg-surface hover:bg-surface-hover"
            }`}
          >
            <div className="font-medium">{s.name}</div>
            <div className="text-sm text-muted">{s.grade_level || "Grade level not set"}</div>
            {s.state && <div className="text-xs text-muted mt-1">{s.state}</div>}
            {currentStudent?.id === s.id && <div className="text-xs text-gold mt-2">Active</div>}
          </button>
        ))}
      </div>

      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="btn-secondary w-fit">
          + Add another student
        </button>
      ) : (
        <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 max-w-lg">
          <h2 className="font-semibold">New student profile</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              placeholder="Student name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="input"
              placeholder="Grade level (e.g. 9th grade)"
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              className="input"
              placeholder={`State (${US_STATES_HINT})`}
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
            <input
              type="date"
              className="input"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
            <input
              type="number"
              className="input"
              placeholder="Expected grad year"
              value={gradYear}
              onChange={(e) => setGradYear(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={submitting || !name.trim()}>
              Create student
            </button>
            {students.length > 0 && (
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
