"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStudents } from "@/lib/studentContext";
import type { Student } from "@/lib/types";

// Darker avatar-safe variants of the brand gold/violet -- the brand tokens
// themselves (--gold #c7a252, --violet #8968c9) are too light for reliable
// white-text contrast in a small avatar circle; these hit >=5:1 against
// white while staying in the same gold/violet family.
const AVATAR_COLORS = ["#8a6a2f", "#5b3d99", "#3b6e8f", "#4d7c5f", "#9a3412"];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function Avatar({ student, size = 32 }: { student: Student; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ backgroundColor: avatarColor(student.id), width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(student.name)}
    </span>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-gold">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export default function StudentSwitcher() {
  const { students, currentStudent, stats, loading, selectStudent } = useStudents();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (loading) return null;

  if (students.length === 0) {
    return (
      <div className="rounded-lg border border-gold/50 bg-surface shadow-sm p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gold/10 text-gold">
            <PlusIcon />
          </span>
          <p className="text-sm text-muted">No students added to your account yet.</p>
        </div>
        <Link href="/dashboard?new=1" className="btn-primary text-sm">
          Add your first student
        </Link>
      </div>
    );
  }

  const stat = currentStudent ? stats[currentStudent.id] : undefined;

  return (
    <div ref={rootRef} className="relative w-fit">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-3 rounded-lg border border-border bg-surface shadow-sm pl-2 pr-3 py-2 hover:bg-surface-hover transition-colors"
      >
        {currentStudent && <Avatar student={currentStudent} />}
        <span className="flex flex-col items-start leading-tight">
          <span className="text-sm font-medium">{currentStudent?.name ?? "Select a student"}</span>
          <span className="text-xs text-muted">
            {currentStudent?.grade_level || "Grade level not set"}
            {stat && <> &middot; {stat.creditHours.toFixed(2)} credits</>}
          </span>
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-2 w-72 rounded-lg border border-border bg-surface shadow-lg overflow-hidden z-20"
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {students.map((s) => {
              const s_stat = stats[s.id];
              const active = currentStudent?.id === s.id;
              return (
                <button
                  key={s.id}
                  role="menuitem"
                  onClick={() => {
                    selectStudent(s.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover ${
                    active ? "bg-gold/5" : ""
                  }`}
                >
                  <Avatar student={s} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{s.name}</span>
                    <span className="block text-xs text-muted truncate">
                      {s.grade_level || "Grade level not set"}
                      {s_stat && (
                        <>
                          {" "}
                          &middot; {s_stat.courseCount} course{s_stat.courseCount === 1 ? "" : "s"}
                        </>
                      )}
                    </span>
                  </span>
                  {active && <CheckIcon />}
                </button>
              );
            })}
          </div>
          <div className="border-t border-border py-1">
            <Link
              href="/dashboard?new=1"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
            >
              <PlusIcon />
              Add a student
            </Link>
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
            >
              Manage all students
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
