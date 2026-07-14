"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import { ACTIVITY_TYPES, type ActivityType, type PipelineClass, type PipelineEntry } from "@/lib/types";
import type { ClassifyResult } from "@/lib/pipeline/classify";

type EntryWithClass = PipelineEntry & { classes: Pick<PipelineClass, "subject_area" | "title"> | null };

const EMPTY_FORM = { rawWordDump: "", activityType: "other" as ActivityType, sourcePlatform: "", minutes: "" };
const EMPTY_MANUAL_FORM = { subjectArea: "", courseTitle: "", creditValue: "0.25", description: "" };

export default function LogPage() {
  const { currentStudent } = useStudents();
  const [entries, setEntries] = useState<EntryWithClass[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set only when Stage 4's confidence check comes back empty-handed — the
  // word dump is held here, unsaved, until the parent resolves it via the
  // manual form below (Stage 5).
  const [needsReview, setNeedsReview] = useState<{ result: ClassifyResult; rawWordDump: string } | null>(null);
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL_FORM);
  const [resolving, setResolving] = useState(false);

  const [edits, setEdits] = useState<Record<string, { finalDescription?: string; finalReasoning?: string; creditValue?: number }>>({});

  async function loadEntries() {
    if (!currentStudent) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("entries")
      .select("*, classes(subject_area, title)")
      .eq("student_id", currentStudent.id)
      .order("created_at", { ascending: false });
    setEntries((data as EntryWithClass[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStudent]);

  /** Finds the child's existing class for a subject, or creates one — classes are just a (student, subject) grouping. */
  async function findOrCreateClass(studentId: string, subjectArea: string) {
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("classes")
      .select("*")
      .eq("student_id", studentId)
      .eq("subject_area", subjectArea)
      .maybeSingle();
    if (existing) return existing;
    const { data: created, error: createError } = await supabase
      .from("classes")
      .insert({ student_id: studentId, subject_area: subjectArea, title: subjectArea })
      .select()
      .single();
    if (createError || !created) throw createError;
    return created;
  }

  async function submitWordDump(e: React.FormEvent) {
    e.preventDefault();
    if (!currentStudent || !form.rawWordDump.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pipeline/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_word_dump: form.rawWordDump,
          activity_type: form.activityType,
          source_platform: form.sourcePlatform || null,
          time_spent_minutes: form.minutes ? Number(form.minutes) : null,
        }),
      });
      if (!res.ok) throw new Error("classify failed");
      const result: ClassifyResult = await res.json();

      if (!result.confident) {
        // Stage 4 → 5: hold the word dump here rather than writing anything
        // yet. The entry only gets created once the parent resolves it below.
        setNeedsReview({ result, rawWordDump: form.rawWordDump });
        setManualForm(EMPTY_MANUAL_FORM);
        setForm(EMPTY_FORM);
        return;
      }

      const supabase = createClient();
      const pipelineClass = await findOrCreateClass(currentStudent.id, result.subjectArea);
      const { error: insertError } = await supabase.from("entries").insert({
        class_id: pipelineClass.id,
        student_id: currentStudent.id,
        raw_word_dump: form.rawWordDump,
        extracted_slots: result.extractedSlots,
        subject_tags: [result.subjectArea],
        credit_value: result.creditValue,
        generated_description: result.courseTitle,
        generated_reasoning: result.reasoning,
        final_description: result.courseTitle,
        final_reasoning: result.reasoning,
        status: "draft",
        source_stage: "template",
      });
      if (insertError) throw insertError;

      setForm(EMPTY_FORM);
      await loadEntries();
    } catch {
      setError("Couldn't log that activity — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitManualResolution(e: React.FormEvent) {
    e.preventDefault();
    if (!currentStudent || !needsReview || !manualForm.subjectArea.trim() || !manualForm.description.trim()) return;
    setResolving(true);
    setError(null);
    try {
      const supabase = createClient();
      const pipelineClass = await findOrCreateClass(currentStudent.id, manualForm.subjectArea.trim());
      const { data: entry, error: insertError } = await supabase
        .from("entries")
        .insert({
          class_id: pipelineClass.id,
          student_id: currentStudent.id,
          raw_word_dump: needsReview.rawWordDump,
          extracted_slots: needsReview.result.extractedSlots,
          subject_tags: [manualForm.subjectArea.trim()],
          credit_value: Number(manualForm.creditValue) || 0,
          generated_description: null,
          generated_reasoning: null,
          final_description: manualForm.courseTitle.trim() || manualForm.subjectArea.trim(),
          final_reasoning: manualForm.description.trim(),
          status: "accepted",
          source_stage: "human",
        })
        .select()
        .single();
      if (insertError || !entry) throw insertError;

      // This is exactly what grows Stage 3's coverage over time: every
      // parent-resolved entry is logged for later review as a candidate
      // fragment/composition rule.
      await supabase.from("human_resolutions").insert({
        entry_id: entry.id,
        original_flag_reason: !needsReview.result.confident ? needsReview.result.flagReason : null,
        resolved_at: new Date().toISOString(),
      });

      setNeedsReview(null);
      setManualForm(EMPTY_MANUAL_FORM);
      await loadEntries();
    } catch {
      setError("Couldn't save that entry — try again.");
    } finally {
      setResolving(false);
    }
  }

  function editField(entryId: string, patch: { finalDescription?: string; finalReasoning?: string; creditValue?: number }) {
    setEdits((prev) => ({ ...prev, [entryId]: { ...prev[entryId], ...patch } }));
  }

  async function decide(entry: EntryWithClass, decision: "accept" | "reject") {
    const supabase = createClient();
    if (decision === "reject") {
      await supabase.from("entries").delete().eq("id", entry.id);
    } else {
      const pending = edits[entry.id];
      await supabase
        .from("entries")
        .update({
          final_description: pending?.finalDescription ?? entry.final_description,
          final_reasoning: pending?.finalReasoning ?? entry.final_reasoning,
          credit_value: pending?.creditValue ?? entry.credit_value,
          status: "accepted",
          updated_at: new Date().toISOString(),
        })
        .eq("id", entry.id);
    }
    setEdits((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
    await loadEntries();
  }

  if (!currentStudent) {
    return <p className="text-muted text-sm">Add a child from the dashboard first.</p>;
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Log an Activity</h1>
        <p className="text-muted text-sm">
          Describe it in plain language. FreeLoom matches it against a curated knowledge base and a
          set of keyword rules — no model call, just a lookup — and drafts a class entry with its
          reasoning shown alongside it. If nothing matches, you write it yourself instead.
        </p>
      </div>

      {!needsReview ? (
        <form onSubmit={submitWordDump} className="flex flex-col gap-3 rounded-lg border border-border bg-surface shadow-sm p-4">
          <textarea
            className="input min-h-24"
            placeholder="e.g. Spent the afternoon building automated factories in Factorio, wiring up circuit logic for the first time"
            value={form.rawWordDump}
            onChange={(e) => setForm({ ...form, rawWordDump: e.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted">Activity type</span>
              <select className="input" value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value as ActivityType })}>
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted">Source / platform (optional)</span>
              <input className="input" placeholder="e.g. Factorio, Recess" value={form.sourcePlatform} onChange={(e) => setForm({ ...form, sourcePlatform: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted">Time spent, minutes (optional)</span>
              <input type="number" min={0} className="input" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
            </label>
          </div>
          <button type="submit" className="btn-primary w-fit" disabled={submitting || !form.rawWordDump.trim()}>
            {submitting ? "Classifying…" : "Log activity"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      ) : (
        <form onSubmit={submitManualResolution} className="flex flex-col gap-3 rounded-lg border border-gold/40 bg-surface shadow-sm p-4">
          <p className="text-sm font-medium">Needs your input</p>
          <p className="text-xs text-muted italic">&quot;{needsReview.rawWordDump}&quot;</p>
          <p className="text-xs text-muted">
            Nothing in the knowledge base or keyword rules matched this one — write the class entry yourself. This also
            teaches the system: every entry resolved here becomes a candidate for a new rule down the line.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              placeholder="Subject (e.g. Life Science)"
              value={manualForm.subjectArea}
              onChange={(e) => setManualForm({ ...manualForm, subjectArea: e.target.value })}
              required
            />
            <input
              className="input"
              placeholder="Class/course title"
              value={manualForm.courseTitle}
              onChange={(e) => setManualForm({ ...manualForm, courseTitle: e.target.value })}
            />
          </div>
          <textarea
            className="input min-h-20"
            placeholder="Why this counts toward that subject"
            value={manualForm.description}
            onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
            required
          />
          <label className="flex items-center gap-2 text-sm w-fit">
            <input
              type="number"
              step={0.05}
              min={0}
              className="input w-24"
              value={manualForm.creditValue}
              onChange={(e) => setManualForm({ ...manualForm, creditValue: e.target.value })}
            />
            <span className="text-muted">credit value</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary w-fit" disabled={resolving || !manualForm.subjectArea.trim() || !manualForm.description.trim()}>
              {resolving ? "Saving…" : "Save entry"}
            </button>
            <button type="button" className="btn-secondary w-fit" onClick={() => setNeedsReview(null)}>
              Discard
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      <div className="flex flex-col gap-4">
        {loading && <p className="text-muted text-sm">Loading…</p>}
        {!loading && entries.length === 0 && <p className="text-muted text-sm">No activities logged yet.</p>}
        {entries.map((entry) => {
          const pending = edits[entry.id];
          return (
            <div key={entry.id} className="rounded-lg border border-border bg-surface shadow-sm p-4">
              <div className="text-xs text-muted mb-1">{new Date(entry.created_at).toLocaleDateString()}</div>
              <p className="text-sm">{entry.raw_word_dump}</p>

              <div className="mt-3 rounded-md bg-background border border-border p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <input
                    className="input font-medium text-gold bg-transparent border-none px-0"
                    value={pending?.finalDescription ?? entry.final_description ?? ""}
                    disabled={entry.status !== "draft"}
                    onChange={(e) => editField(entry.id, { finalDescription: e.target.value })}
                  />
                  <span className="text-xs text-muted font-mono uppercase">{entry.status.replace("_", " ")}</span>
                </div>
                <div className="text-sm text-muted">{entry.classes?.subject_area}</div>
                <textarea
                  className="input text-xs bg-transparent border-none px-0 text-muted italic min-h-12"
                  value={pending?.finalReasoning ?? entry.final_reasoning ?? ""}
                  disabled={entry.status !== "draft"}
                  onChange={(e) => editField(entry.id, { finalReasoning: e.target.value })}
                />
                <div className="flex items-center justify-between flex-wrap gap-2 mt-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      className="input w-20"
                      value={pending?.creditValue ?? entry.credit_value}
                      disabled={entry.status !== "draft"}
                      onChange={(e) => editField(entry.id, { creditValue: Number(e.target.value) })}
                    />
                    <span className="text-muted">credit value</span>
                  </label>
                  {entry.status === "draft" ? (
                    <div className="flex gap-2">
                      <button onClick={() => decide(entry, "reject")} className="btn-secondary text-xs">
                        Reject
                      </button>
                      <button onClick={() => decide(entry, "accept")} className="btn-primary text-xs">
                        Accept
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">Accepted</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
