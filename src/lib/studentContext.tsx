"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Student } from "@/lib/types";
import { computeSubjectLedger } from "@/lib/pipeline/ledger";

const CURRENT_STUDENT_KEY = "freeloom-current-student-id";

export type StudentStats = { courseCount: number; creditHours: number };
export type SubjectLedgerRow = { subjectArea: string; creditHours: number; targetCredits: number | null };

type StudentContextValue = {
  students: Student[];
  currentStudent: Student | null;
  loading: boolean;
  stats: Record<string, StudentStats>;
  /** Per-subject credit ledger for the *current* student only (unlike
   * `stats`, which covers every student for the dashboard's list view) --
   * the left rail only ever needs to show the active student's own
   * breakdown. */
  subjectLedger: SubjectLedgerRow[];
  /** Re-fetches subjectLedger for the current student -- call after any
   * entry_subject_tags mutation (the reasoning panel's edit/remove/add
   * actions), since those don't otherwise change `currentId` and so
   * wouldn't trigger the ledger effect below on their own. */
  refreshSubjectLedger: () => Promise<void>;
  selectStudent: (id: string) => void;
  refresh: () => Promise<void>;
  createStudent: (input: Partial<Student> & { name: string }) => Promise<Student | null>;
  updateStudent: (id: string, patch: Partial<Student>) => Promise<Student | null>;
  deleteStudent: (id: string) => Promise<boolean>;
  createError: string | null;
};

const StudentContext = createContext<StudentContextValue | null>(null);

export function StudentProvider({ children }: { children: ReactNode }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, StudentStats>>({});
  const [subjectLedger, setSubjectLedger] = useState<SubjectLedgerRow[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.from("students").select("*").order("created_at", { ascending: true });
    if (!error && data) {
      setStudents(data);
      setCurrentId((prev) => {
        if (prev && data.some((s) => s.id === prev)) return prev;
        const stored = window.localStorage.getItem(CURRENT_STUDENT_KEY);
        if (stored && data.some((s) => s.id === stored)) return stored;
        return data[0]?.id ?? null;
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial fetch from Supabase on mount; refresh() is the external-system sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (currentId) window.localStorage.setItem(CURRENT_STUDENT_KEY, currentId);
  }, [currentId]);

  // Lives here rather than in individual pages so every consumer (dashboard,
  // the nav switcher, anywhere else) shares one query instead of each
  // re-fetching the same per-student aggregates.
  useEffect(() => {
    if (students.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStats({});
      return;
    }
    const supabase = createClient();
    const studentIds = students.map((s) => s.id);
    (async () => {
      const { data: entries } = await supabase
        .from("entries")
        .select("student_id, credit_value")
        .in("student_id", studentIds)
        .eq("status", "accepted");
      const next: Record<string, StudentStats> = {};
      for (const entry of entries || []) {
        const stat = next[entry.student_id] || { courseCount: 0, creditHours: 0 };
        stat.courseCount += 1;
        stat.creditHours += entry.credit_value;
        next[entry.student_id] = stat;
      }
      setStats(next);
    })();
  }, [students]);

  // Per-subject ledger for the left rail: sums entry_subject_tags (not
  // entries.credit_value directly) grouped by subject, since one entry can
  // now contribute credit to more than one subject. Only accepted entries
  // count toward earned credit, matching the stats effect above.
  const fetchSubjectLedger = useCallback(async (studentId: string) => {
    const supabase = createClient();
    const [{ data: tagRows }, { data: classRows }] = await Promise.all([
      supabase
        .from("entry_subject_tags")
        .select("subject_area, credit_value, entries!inner(status)")
        .eq("student_id", studentId)
        .eq("entries.status", "accepted"),
      supabase.from("classes").select("subject_area, target_credits").eq("student_id", studentId),
    ]);
    const ledgerRows = computeSubjectLedger(
      (tagRows ?? []).map((row) => ({ subjectArea: row.subject_area, creditValue: row.credit_value }))
    );
    const targetBySubject = new Map((classRows ?? []).map((c) => [c.subject_area, c.target_credits]));
    setSubjectLedger(ledgerRows.map((row) => ({ ...row, targetCredits: targetBySubject.get(row.subjectArea) ?? null })));
  }, []);

  useEffect(() => {
    if (!currentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubjectLedger([]);
      return;
    }
    fetchSubjectLedger(currentId);
  }, [currentId, fetchSubjectLedger]);

  const refreshSubjectLedger = useCallback(async () => {
    if (currentId) await fetchSubjectLedger(currentId);
  }, [currentId, fetchSubjectLedger]);

  const selectStudent = useCallback((id: string) => setCurrentId(id), []);

  const createStudent = useCallback(async (input: Partial<Student> & { name: string }) => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    setCreateError(null);
    const { data, error } = await supabase
      .from("students")
      .insert({ ...input, user_id: user.id })
      .select()
      .single();
    if (error || !data) {
      setCreateError(error?.message ? `Couldn't create that profile: ${error.message}` : "Couldn't create that profile.");
      return null;
    }
    setStudents((prev) => [...prev, data]);
    setCurrentId(data.id);
    return data;
  }, []);

  const updateStudent = useCallback(async (id: string, patch: Partial<Student>) => {
    const supabase = createClient();
    const { data, error } = await supabase.from("students").update(patch).eq("id", id).select().single();
    if (error || !data) return null;
    setStudents((prev) => prev.map((s) => (s.id === id ? data : s)));
    return data;
  }, []);

  const deleteStudent = useCallback(async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase.from("students").delete().eq("id", id);
    if (error) return false;
    setStudents((prev) => {
      const next = prev.filter((s) => s.id !== id);
      setCurrentId((prevId) => (prevId === id ? next[0]?.id ?? null : prevId));
      return next;
    });
    return true;
  }, []);

  const currentStudent = students.find((s) => s.id === currentId) ?? null;

  return (
    <StudentContext.Provider
      value={{
        students,
        currentStudent,
        loading,
        stats,
        subjectLedger,
        refreshSubjectLedger,
        selectStudent,
        refresh,
        createStudent,
        updateStudent,
        deleteStudent,
        createError,
      }}
    >
      {children}
    </StudentContext.Provider>
  );
}

export function useStudents() {
  const ctx = useContext(StudentContext);
  if (!ctx) throw new Error("useStudents must be used within a StudentProvider");
  return ctx;
}
