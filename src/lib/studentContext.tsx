"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Student } from "@/lib/types";

const CURRENT_STUDENT_KEY = "freeloom-current-student-id";

type StudentContextValue = {
  students: Student[];
  currentStudent: Student | null;
  loading: boolean;
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
      setCreateError(
        error?.message?.includes("child_limit_reached")
          ? "You've reached your plan's child limit. Upgrade to add more."
          : "Couldn't create that profile."
      );
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
