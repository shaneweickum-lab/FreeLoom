"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import { sumCredits } from "@/lib/pipeline/credit-calculation";
import type { PipelineClass, PipelineEntry } from "@/lib/types";

type ClassWithEntries = PipelineClass & { entries: PipelineEntry[] };

export default function PortfolioPage() {
  const { currentStudent } = useStudents();
  const [classes, setClasses] = useState<ClassWithEntries[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, { finalDescription?: string; finalReasoning?: string; creditValue?: number }>>({});

  async function load() {
    if (!currentStudent) {
      setClasses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    // Only accepted entries make it into the portfolio -- drafts and
    // needs-your-input entries are still a work in progress over on /log.
    const { data } = await supabase
      .from("classes")
      .select("*, entries(*)")
      .eq("student_id", currentStudent.id)
      .order("subject_area", { ascending: true });

    const withAcceptedOnly = ((data as ClassWithEntries[]) || [])
      .map((c) => ({ ...c, entries: c.entries.filter((e) => e.status === "accepted") }))
      .filter((c) => c.entries.length > 0);

    setClasses(withAcceptedOnly);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStudent]);

  function editField(entryId: string, patch: { finalDescription?: string; finalReasoning?: string; creditValue?: number }) {
    setEdits((prev) => ({ ...prev, [entryId]: { ...prev[entryId], ...patch } }));
  }

  async function saveEntry(entry: PipelineEntry) {
    const pending = edits[entry.id];
    if (!pending) return;
    const supabase = createClient();
    await supabase
      .from("entries")
      .update({
        final_description: pending.finalDescription ?? entry.final_description,
        final_reasoning: pending.finalReasoning ?? entry.final_reasoning,
        credit_value: pending.creditValue ?? entry.credit_value,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entry.id);
    setEdits((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
    await load();
  }

  async function removeEntry(entry: PipelineEntry) {
    const supabase = createClient();
    await supabase.from("entries").delete().eq("id", entry.id);
    await load();
  }

  if (!currentStudent) {
    return <p className="text-muted text-sm">Add a student from the dashboard first.</p>;
  }
  if (loading) return <p className="text-muted text-sm">Loading…</p>;

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Portfolio</h1>
        <p className="text-muted text-sm">
          Every class {currentStudent.name} has built up, and the reasoning behind each entry —
          edit anything that needs a second look. New activities are logged from the Learning Log page.
        </p>
      </div>

      {classes.length === 0 && (
        <p className="text-muted text-sm">
          Nothing accepted into the portfolio yet — log and accept an activity from the Learning Log page first.
        </p>
      )}

      {classes.map((cls) => {
        const classCredits = sumCredits(cls.entries.map((e) => e.credit_value));
        return (
          <div key={cls.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{cls.title}</h2>
              <span className="text-xs text-muted">{classCredits.toFixed(2)} credits</span>
            </div>
            <div className="flex flex-col gap-3">
              {cls.entries.map((entry) => {
                const pending = edits[entry.id];
                const hasPendingEdits = !!pending;
                return (
                  <div key={entry.id} className="rounded-lg border border-border bg-surface shadow-sm p-4 flex flex-col gap-2">
                    <div className="text-xs text-muted">{new Date(entry.created_at).toLocaleDateString()}</div>
                    <p className="text-xs text-muted italic">&quot;{entry.raw_word_dump}&quot;</p>
                    <input
                      className="input font-medium bg-transparent border-none px-0"
                      value={pending?.finalDescription ?? entry.final_description ?? ""}
                      onChange={(e) => editField(entry.id, { finalDescription: e.target.value })}
                    />
                    <textarea
                      className="input text-sm bg-transparent border-none px-0 text-muted min-h-16"
                      value={pending?.finalReasoning ?? entry.final_reasoning ?? ""}
                      onChange={(e) => editField(entry.id, { finalReasoning: e.target.value })}
                    />
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="number"
                          step={0.05}
                          min={0}
                          className="input w-20"
                          value={pending?.creditValue ?? entry.credit_value}
                          onChange={(e) => editField(entry.id, { creditValue: Number(e.target.value) })}
                        />
                        <span className="text-muted">credit value</span>
                      </label>
                      <div className="flex gap-2">
                        {hasPendingEdits && (
                          <button onClick={() => saveEntry(entry)} className="btn-primary text-xs">
                            Save
                          </button>
                        )}
                        <button onClick={() => removeEntry(entry)} className="text-xs text-muted hover:text-red-600">
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
