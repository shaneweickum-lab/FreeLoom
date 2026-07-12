"use client";

import Link from "next/link";
import { useStudents } from "@/lib/studentContext";

export default function StudentSwitcher() {
  const { students, currentStudent, loading, selectStudent } = useStudents();

  if (loading) return null;

  if (students.length === 0) {
    return (
      <div className="rounded-lg border border-gold/50 bg-surface shadow-sm p-4 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted">No children added to your account yet.</p>
        <Link href="/dashboard" className="btn-primary text-sm">
          Add your first child
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted">Viewing:</span>
      <select
        className="input w-auto min-w-0"
        value={currentStudent?.id ?? ""}
        onChange={(e) => selectStudent(e.target.value)}
      >
        {students.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <Link href="/dashboard" className="text-muted hover:text-foreground">
        Manage children
      </Link>
    </div>
  );
}
