"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SCHOOLING_STRUCTURE_OPTIONS, type AcademicSession, type SchoolingStructure } from "@/lib/academicSessions";
import type { SchoolProfile } from "@/lib/types";

const EMPTY_SESSION_FORM = { label: "", startDate: "", endDate: "" };

export default function AcademicTab({ userId, initialProfile }: { userId: string; initialProfile: SchoolProfile | null }) {
  const [structure, setStructure] = useState<SchoolingStructure | "">(initialProfile?.schooling_structure ?? "");
  const [structureSaving, setStructureSaving] = useState(false);
  const [structureSaved, setStructureSaved] = useState(false);

  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionForm, setSessionForm] = useState(EMPTY_SESSION_FORM);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function loadSessions() {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from("academic_sessions").select("*").order("start_date", { ascending: true });
    setSessions((data as AcademicSession[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSessions();
  }, []);

  async function saveStructure(next: SchoolingStructure | "") {
    setStructure(next);
    setStructureSaving(true);
    setStructureSaved(false);
    const supabase = createClient();
    await supabase.from("school_profiles").upsert({
      user_id: userId,
      schooling_structure: next || null,
      updated_at: new Date().toISOString(),
    });
    setStructureSaving(false);
    setStructureSaved(true);
  }

  async function addSession(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionForm.label.trim() || !sessionForm.startDate || !sessionForm.endDate) return;
    if (sessionForm.endDate < sessionForm.startDate) {
      setError("End date can't be before the start date.");
      return;
    }
    setAdding(true);
    setError("");
    const supabase = createClient();
    const { error: insertError } = await supabase.from("academic_sessions").insert({
      user_id: userId,
      label: sessionForm.label.trim(),
      start_date: sessionForm.startDate,
      end_date: sessionForm.endDate,
    });
    setAdding(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setSessionForm(EMPTY_SESSION_FORM);
    await loadSessions();
  }

  async function deleteSession(id: string) {
    const supabase = createClient();
    await supabase.from("academic_sessions").delete().eq("id", id);
    await loadSessions();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-navy-line p-3 flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">How do you structure your school year?</span>
          <select
            className="input w-fit"
            value={structure}
            disabled={structureSaving}
            onChange={(e) => saveStructure(e.target.value as SchoolingStructure | "")}
          >
            <option value="">Not set</option>
            {SCHOOLING_STRUCTURE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-muted/70 text-[11px]">
          Just a label for how you plan below -- the actual session dates are what determines when a class starts
          accumulating credit and when it stops.
        </span>
        {structureSaved && !structureSaving && <p className="text-xs text-gold">Saved.</p>}
      </div>

      <div className="rounded-lg border border-navy-line p-3 flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium">Sessions</h2>
          <p className="text-muted/70 text-[11px]">
            Add the date range for each term (a semester, quarter, whatever you picked above). While a session is
            open, activities logged in the same subject cumulate into one class instead of a separate record every
            time -- once its end date passes, the next matching activity starts a fresh class for the next session.
            Activities logged outside any session date range work like they always have (one running class per
            subject, no session attached).
          </p>
        </div>

        {loading ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-muted text-sm">No sessions yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex items-center justify-between gap-2 rounded-md border border-navy-line px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">{session.label}</div>
                  <div className="text-muted text-xs">
                    {session.start_date} – {session.end_date}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteSession(session.id)}
                  className="text-xs text-red-400 hover:underline shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addSession} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">Label</span>
            <input
              className="input"
              placeholder="e.g. Fall Semester 2026"
              value={sessionForm.label}
              onChange={(e) => setSessionForm({ ...sessionForm, label: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">Start</span>
            <input
              type="date"
              className="input"
              value={sessionForm.startDate}
              onChange={(e) => setSessionForm({ ...sessionForm, startDate: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">End</span>
            <input
              type="date"
              className="input"
              value={sessionForm.endDate}
              onChange={(e) => setSessionForm({ ...sessionForm, endDate: e.target.value })}
            />
          </label>
          <button
            type="submit"
            className="btn-secondary text-sm"
            disabled={adding || !sessionForm.label.trim() || !sessionForm.startDate || !sessionForm.endDate}
          >
            {adding ? "Adding…" : "Add session"}
          </button>
        </form>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
