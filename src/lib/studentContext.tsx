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
};

const StudentContext = createContext<StudentContextValue | null>(null);

export function StudentProvider({ children }: { children: ReactNode }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    const { data, error } = await supabase
      .from("students")
      .insert({ ...input, user_id: user.id })
      .select()
      .single();
    if (error || !data) return null;
    setStudents((prev) => [...prev, data]);
    setCurrentId(data.id);
    return data;
  }, []);

  const currentStudent = students.find((s) => s.id === currentId) ?? null;

  return (
    <StudentContext.Provider value={{ students, currentStudent, loading, selectStudent, refresh, createStudent }}>
      {children}
    </StudentContext.Provider>
  );
}

export function useStudents() {
  const ctx = useContext(StudentContext);
  if (!ctx) throw new Error("useStudents must be used within a StudentProvider");
  return ctx;
}
