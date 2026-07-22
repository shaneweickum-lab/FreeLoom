"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStudents } from "@/lib/studentContext";
import { createClient } from "@/lib/supabase/client";
import { getStudentCap } from "@/lib/billing/tier";
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

export default function StudentSwitcher() {
  const { students, currentStudent, stats, loading, selectStudent } = useStudents();
  const [open, setOpen] = useState(false);
  const [cap, setCap] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Self-contained, same pattern as AppRail's BennyTriggerButton -- fetches
  // its own tier-relevant data rather than needing a prop threaded down.
  // Real enforcement is a DB trigger (see the billing-tiers migration);
  // this is purely for a clean upgrade-prompt experience instead of a raw
  // Postgres error if a parent somehow got past this UI.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const [{ data: profile }, { data: adminRow }] = await Promise.all([
        supabase
          .from("school_profiles")
          .select("subscription_tier, subscription_status, grandfathered_until, current_period_end")
          .eq("user_id", data.user.id)
          .maybeSingle(),
        supabase.from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle(),
      ]);
      setCap(
        getStudentCap({
          subscription_tier: profile?.subscription_tier ?? "free",
          subscription_status: profile?.subscription_status ?? null,
          grandfathered_until: profile?.grandfathered_until ?? null,
          current_period_end: profile?.current_period_end ?? null,
          isAdmin: !!adminRow,
        })
      );
    });
  }, []);

  const atCap = cap !== null && students.length >= cap;
  // Oldest-first, so a downgrade doesn't touch which students stay
  // editable -- matches the DB trigger's own ranking (see
  // enforce_student_not_locked), which is the actual enforcement; this is
  // purely to show the same "beyond your plan" note here instead of a
  // parent only discovering it when a save gets rejected.
  const lockedStudentIds =
    cap === null
      ? new Set<string>()
      : new Set(
          [...students]
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            .slice(cap)
            .map((s) => s.id)
        );

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
              const locked = lockedStudentIds.has(s.id);
              return (
                <button
                  key={s.id}
                  role="menuitem"
                  onClick={() => {
                    selectStudent(s.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 border-l-[3px] py-2.5 pr-3 text-left transition-colors hover:bg-surface-hover ${
                    active ? "border-gold bg-gold/5 pl-[9px]" : "border-transparent pl-3"
                  }`}
                >
                  <Avatar student={s} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">
                      {s.name}
                      {locked && (
                        <span className="ml-1.5 rounded-full bg-navy-line px-1.5 py-0.5 text-[10px] font-normal text-muted align-middle">
                          Beyond plan limit
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted truncate">
                      {locked
                        ? "Viewable, but no new courses or entries until you upgrade"
                        : s.grade_level || "Grade level not set"}
                      {!locked && s_stat && (
                        <>
                          {" "}
                          &middot; {s_stat.courseCount} course{s_stat.courseCount === 1 ? "" : "s"}
                        </>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-border py-1">
            {atCap ? (
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-gold hover:underline transition-colors"
              >
                <PlusIcon />
                Upgrade to add more students (Settings &gt; Billing)
              </Link>
            ) : (
              <Link
                href="/dashboard?new=1"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
              >
                <PlusIcon />
                Add a student
              </Link>
            )}
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
