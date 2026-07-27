"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import StudentForm, { EMPTY_STUDENT_FORM, studentFormToPatch, type StudentFormValues } from "@/components/StudentForm";
import {
  SCHOOLING_STRUCTURE_OPTIONS,
  generateProposedSessions,
  type AcademicSession,
  type ProposedSession,
  type SchoolingStructure,
} from "@/lib/academicSessions";
import type { SchoolProfile } from "@/lib/types";

const EMPTY_SESSION_FORM = { label: "", startDate: "", endDate: "" };

function AddStudentSection({ autoOpen }: { autoOpen: boolean }) {
  const { students, createStudent, createError } = useStudents();
  // Reads `autoOpen` only at mount -- correct here because the caller
  // strips the ?new=1 query param a tick after mount (see AcademicTab's own
  // effect below), and this form should stay open from then on regardless,
  // not snap shut when the prop flips back to false.
  const [open, setOpen] = useState(autoOpen);
  const [form, setForm] = useState<StudentFormValues>(EMPTY_STUDENT_FORM);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    await createStudent(studentFormToPatch(form));
    setForm(EMPTY_STUDENT_FORM);
    setSubmitting(false);
    setOpen(false);
  }

  return (
    <div className="rounded-lg border border-navy-line p-3 flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium">Students</h2>
        <p className="text-muted/70 text-[11px]">
          {students.length > 0
            ? "Add another student to this account. To edit or remove an existing profile, use the Dashboard."
            : "Add your first student profile to get started."}
        </p>
      </div>
      {createError && <p className="text-xs text-red-400">{createError}</p>}
      {open ? (
        <StudentForm
          form={form}
          onChange={setForm}
          onSubmit={handleSubmit}
          onCancel={() => setOpen(false)}
          submitting={submitting}
          isEditing={false}
          showCancel={students.length > 0}
        />
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary w-fit text-sm">
          + Add a student
        </button>
      )}
    </div>
  );
}

export default function AcademicTab({ userId, initialProfile }: { userId: string; initialProfile: SchoolProfile | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const autoOpenAddStudent = searchParams.get("new") === "1";

  useEffect(() => {
    if (autoOpenAddStudent) router.replace("/settings?tab=academic");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [structure, setStructure] = useState<SchoolingStructure | "">(initialProfile?.schooling_structure ?? "");
  const [structureSaving, setStructureSaving] = useState(false);
  const [structureSaved, setStructureSaved] = useState(false);

  const [yearStart, setYearStart] = useState(initialProfile?.year_start_date ?? "");
  const [yearEnd, setYearEnd] = useState(initialProfile?.year_end_date ?? "");
  const [yearDatesSaving, setYearDatesSaving] = useState(false);
  const [yearDatesError, setYearDatesError] = useState("");

  const [proposedSessions, setProposedSessions] = useState<ProposedSession[] | null>(null);
  const [acceptingProposal, setAcceptingProposal] = useState(false);

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

  // Auto-propose a breakdown the first time structure + both year dates are
  // all set -- once a proposal exists, later date/structure tweaks only
  // regenerate it if the parent explicitly asks (the Regenerate button),
  // so this never clobbers edits the parent has already made to the preview.
  useEffect(() => {
    if (proposedSessions !== null) return;
    if (!structure || !yearStart || !yearEnd || yearEnd < yearStart) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProposedSessions(generateProposedSessions(structure, yearStart, yearEnd));
  }, [structure, yearStart, yearEnd, proposedSessions]);

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

  async function saveYearDates(nextStart: string, nextEnd: string) {
    setYearStart(nextStart);
    setYearEnd(nextEnd);
    setYearDatesError("");
    if (nextStart && nextEnd && nextEnd < nextStart) {
      setYearDatesError("School year end can't be before the start.");
      return;
    }
    setYearDatesSaving(true);
    const supabase = createClient();
    await supabase.from("school_profiles").upsert({
      user_id: userId,
      year_start_date: nextStart || null,
      year_end_date: nextEnd || null,
      updated_at: new Date().toISOString(),
    });
    setYearDatesSaving(false);
  }

  function regenerateProposal() {
    if (!structure || !yearStart || !yearEnd || yearEnd < yearStart) return;
    setProposedSessions(generateProposedSessions(structure, yearStart, yearEnd));
  }

  function updateProposedSession(index: number, patch: Partial<ProposedSession>) {
    setProposedSessions((prev) => (prev ? prev.map((s, i) => (i === index ? { ...s, ...patch } : s)) : prev));
  }

  function removeProposedSession(index: number) {
    setProposedSessions((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  async function acceptProposal() {
    if (!proposedSessions || proposedSessions.length === 0) return;
    setAcceptingProposal(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("academic_sessions").insert(
      proposedSessions.map((s) => ({
        user_id: userId,
        label: s.label,
        start_date: s.start_date,
        end_date: s.end_date,
      }))
    );
    setAcceptingProposal(false);
    if (insertError) {
      setYearDatesError(insertError.message);
      return;
    }
    setProposedSessions(null);
    await loadSessions();
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
      <AddStudentSection autoOpen={autoOpenAddStudent} />

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

      <div className="rounded-lg border border-navy-line p-3 flex flex-col gap-2">
        <div>
          <span className="font-medium text-sm">School year dates</span>
          <p className="text-muted/70 text-[11px]">
            Set the start and end of the whole school year and, once you&apos;ve picked a structure above, FreeLoom will
            split it into that many sessions for you below -- adjust anything before accepting, or regenerate from
            scratch.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">Year start</span>
            <input
              type="date"
              className="input"
              value={yearStart}
              disabled={yearDatesSaving}
              onChange={(e) => saveYearDates(e.target.value, yearEnd)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">Year end</span>
            <input
              type="date"
              className="input"
              value={yearEnd}
              disabled={yearDatesSaving}
              onChange={(e) => saveYearDates(yearStart, e.target.value)}
            />
          </label>
        </div>
        {yearDatesError && <p className="text-xs text-red-400">{yearDatesError}</p>}
        {!structure && yearStart && yearEnd && (
          <p className="text-muted/70 text-[11px]">Pick a school-year structure above to get a proposed breakdown.</p>
        )}
      </div>

      {proposedSessions && proposedSessions.length > 0 && (
        <div className="rounded-lg border border-gold/40 bg-gold/5 p-3 flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-medium">Proposed sessions</h2>
            <p className="text-muted/70 text-[11px]">
              FreeLoom split your school year into {proposedSessions.length} session
              {proposedSessions.length === 1 ? "" : "s"}. Rename or adjust any dates below, drop
              ones you don&apos;t want, then accept to create them -- or discard and start over.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {proposedSessions.map((s, i) => (
              <li key={i} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] items-end rounded-md border border-navy-line bg-surface px-3 py-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted text-xs">Label</span>
                  <input
                    className="input"
                    value={s.label}
                    onChange={(e) => updateProposedSession(i, { label: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted text-xs">Start</span>
                  <input
                    type="date"
                    className="input"
                    value={s.start_date}
                    onChange={(e) => updateProposedSession(i, { start_date: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted text-xs">End</span>
                  <input
                    type="date"
                    className="input"
                    value={s.end_date}
                    onChange={(e) => updateProposedSession(i, { end_date: e.target.value })}
                  />
                </label>
                <button type="button" onClick={() => removeProposedSession(i)} className="text-xs text-red-400 hover:underline shrink-0">
                  Drop
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" onClick={acceptProposal} disabled={acceptingProposal} className="btn-primary text-sm w-fit">
              {acceptingProposal ? "Adding…" : `Accept & create ${proposedSessions.length} session${proposedSessions.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" onClick={regenerateProposal} className="btn-secondary text-sm w-fit">
              Regenerate
            </button>
            <button type="button" onClick={() => setProposedSessions(null)} className="text-xs text-muted hover:text-foreground">
              Discard
            </button>
          </div>
        </div>
      )}

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
