"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import type { ActivityType, EntryStatus, PipelineEntry, SourceStage, TagConfidence, TagSource } from "@/lib/types";
import type { ClassifyResult, DraftSource } from "@/lib/pipeline/classify";
import { recordRetrievalCase } from "@/lib/pipeline/retrieve";
import { sumCredits } from "@/lib/pipeline/credit-calculation";
import CaptureCard, { type CaptureForm } from "@/components/CaptureCard";
import RecordCard, { type EntryWithTags } from "@/components/RecordCard";

type TagInput = {
  subjectArea: string;
  courseTitle: string;
  creditValue: number;
  reasoning: string;
  confidence: TagConfidence;
  quotedPhrase: string | null;
  source: TagSource;
};

const EMPTY_FORM = { rawWordDump: "", activityType: "other" as ActivityType, sourcePlatform: "", minutes: "" };
const EMPTY_MANUAL_FORM = { subjectArea: "", courseTitle: "", creditValue: "0.25", description: "" };
const EMPTY_QUICK_ADD = { subjectArea: "", courseTitle: "", creditValue: "0.25", description: "", rawWordDump: "" };

/** At least one tag drawn from a past accepted entry (Stage 2) makes the
 * whole entry a "retrieval" draft in DB terms; every other automated
 * combination (knowledge base, keyword cluster, fragment composition)
 * still counts as a "template" derivation, matching the original
 * single-tag mapping generalized to a tag list. */
function toSourceStage(tags: { source: DraftSource }[]): SourceStage {
  return tags.some((tag) => tag.source === "retrieval") ? "retrieval" : "template";
}

export default function LogPage() {
  return (
    <Suspense fallback={null}>
      <LogPageInner />
    </Suspense>
  );
}

function LogPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentStudent, refreshSubjectLedger } = useStudents();
  const [entries, setEntries] = useState<EntryWithTags[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<CaptureForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set only when Stage 4's confidence check comes back empty-handed — the
  // word dump is held here, unsaved, until the parent resolves it via the
  // manual form below (Stage 5).
  const [needsReview, setNeedsReview] = useState<{ result: ClassifyResult; rawWordDump: string } | null>(null);
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL_FORM);
  const [resolving, setResolving] = useState(false);

  // Set when arriving from an accepted suggested class on the Profile page
  // (?subject=...&rationale=...) -- a fresh entry for an already-decided
  // class, not a Stage 4 fallback, so it skips classify() entirely and
  // skips the human_resolutions logging that's specifically for pipeline
  // misses.
  const [quickAdd, setQuickAdd] = useState<typeof EMPTY_QUICK_ADD | null>(null);
  const [quickAdding, setQuickAdding] = useState(false);

  const [edits, setEdits] = useState<Record<string, { finalDescription?: string; finalReasoning?: string; creditValue?: number }>>({});

  useEffect(() => {
    const subject = searchParams.get("subject");
    if (!subject) return;
    const rationale = searchParams.get("rationale") ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuickAdd({ ...EMPTY_QUICK_ADD, subjectArea: subject, description: rationale });
    router.replace("/log");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      .select("*, classes(subject_area, title), entry_subject_tags(*)")
      .eq("student_id", currentStudent.id)
      .order("created_at", { ascending: false })
      .order("created_at", { foreignTable: "entry_subject_tags", ascending: true });
    setEntries((data as EntryWithTags[]) || []);
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

  /**
   * Creates one entries row plus one entry_subject_tags row per tag. The
   * legacy singular columns (subject_tags, credit_value, final_description,
   * final_reasoning, class_id) mirror the *first* tag so pages that haven't
   * been updated to read the full tag list yet (portfolio, transcript
   * credit rollups) keep working against real, consistent data --
   * credit_value specifically is the sum across every tag, not just the
   * first, so those rollups don't silently under-count a multi-tag entry.
   */
  async function insertEntryWithTags(params: {
    studentId: string;
    rawWordDump: string;
    extractedSlots: PipelineEntry["extracted_slots"];
    tags: TagInput[];
    status: EntryStatus;
    sourceStage: SourceStage;
    generatedFromPipeline: boolean;
  }) {
    const supabase = createClient();
    const [primaryTag] = params.tags;
    const primaryClass = await findOrCreateClass(params.studentId, primaryTag.subjectArea);
    const totalCredit = sumCredits(params.tags.map((t) => t.creditValue));

    const { data: entry, error: insertError } = await supabase
      .from("entries")
      .insert({
        class_id: primaryClass.id,
        student_id: params.studentId,
        raw_word_dump: params.rawWordDump,
        extracted_slots: params.extractedSlots,
        subject_tags: params.tags.map((t) => t.subjectArea),
        credit_value: totalCredit,
        generated_description: params.generatedFromPipeline ? primaryTag.courseTitle : null,
        generated_reasoning: params.generatedFromPipeline ? primaryTag.reasoning : null,
        final_description: primaryTag.courseTitle,
        final_reasoning: primaryTag.reasoning,
        status: params.status,
        source_stage: params.sourceStage,
      })
      .select()
      .single();
    if (insertError || !entry) throw insertError;

    for (const tag of params.tags) {
      // The primary tag's class was already created/found above; every
      // other tag can belong to a different subject/class entirely.
      if (tag !== primaryTag) await findOrCreateClass(params.studentId, tag.subjectArea);

      const { error: tagError } = await supabase.from("entry_subject_tags").insert({
        entry_id: entry.id,
        student_id: params.studentId,
        subject_area: tag.subjectArea,
        course_title: tag.courseTitle,
        credit_value: tag.creditValue,
        confidence: tag.confidence,
        quoted_phrase: tag.quotedPhrase,
        reasoning: tag.reasoning,
        source_stage: tag.source,
      });
      if (tagError) throw tagError;
    }

    return entry;
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
          student_id: currentStudent.id,
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

      await insertEntryWithTags({
        studentId: currentStudent.id,
        rawWordDump: form.rawWordDump,
        extractedSlots: result.extractedSlots,
        tags: result.tags,
        status: "draft",
        sourceStage: toSourceStage(result.tags),
        generatedFromPipeline: true,
      });

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
      const entry = await insertEntryWithTags({
        studentId: currentStudent.id,
        rawWordDump: needsReview.rawWordDump,
        extractedSlots: needsReview.result.extractedSlots,
        tags: [
          {
            subjectArea: manualForm.subjectArea.trim(),
            courseTitle: manualForm.courseTitle.trim() || manualForm.subjectArea.trim(),
            creditValue: Number(manualForm.creditValue) || 0,
            reasoning: manualForm.description.trim(),
            confidence: "human",
            quotedPhrase: null,
            source: "human",
          },
        ],
        status: "accepted",
        sourceStage: "human",
        generatedFromPipeline: false,
      });

      // This is exactly what grows Stage 3's coverage over time: every
      // parent-resolved entry is logged for later review as a candidate
      // fragment/composition rule.
      await supabase.from("human_resolutions").insert({
        entry_id: entry.id,
        original_flag_reason: !needsReview.result.confident ? needsReview.result.flagReason : null,
        resolved_at: new Date().toISOString(),
      });

      await recordRetrievalCase(supabase, entry.id, needsReview.rawWordDump, {
        tags: [
          {
            subjectArea: manualForm.subjectArea.trim(),
            courseTitle: entry.final_description,
            creditValue: entry.credit_value,
            reasoning: entry.final_reasoning,
          },
        ],
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

  async function submitQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!currentStudent || !quickAdd || !quickAdd.rawWordDump.trim() || !quickAdd.description.trim()) return;
    setQuickAdding(true);
    setError(null);
    try {
      const supabase = createClient();
      const entry = await insertEntryWithTags({
        studentId: currentStudent.id,
        rawWordDump: quickAdd.rawWordDump.trim(),
        extractedSlots: { activity_type: null, source_platform: null, time_spent_minutes: null },
        tags: [
          {
            subjectArea: quickAdd.subjectArea.trim(),
            courseTitle: quickAdd.courseTitle.trim() || quickAdd.subjectArea.trim(),
            creditValue: Number(quickAdd.creditValue) || 0,
            reasoning: quickAdd.description.trim(),
            confidence: "human",
            quotedPhrase: null,
            source: "human",
          },
        ],
        status: "accepted",
        sourceStage: "human",
        generatedFromPipeline: false,
      });

      await recordRetrievalCase(supabase, entry.id, quickAdd.rawWordDump.trim(), {
        tags: [
          {
            subjectArea: quickAdd.subjectArea.trim(),
            courseTitle: entry.final_description,
            creditValue: entry.credit_value,
            reasoning: entry.final_reasoning,
          },
        ],
      });

      setQuickAdd(null);
      await loadEntries();
    } catch {
      setError("Couldn't save that entry — try again.");
    } finally {
      setQuickAdding(false);
    }
  }

  function editField(entryId: string, patch: { finalDescription?: string; finalReasoning?: string; creditValue?: number }) {
    setEdits((prev) => ({ ...prev, [entryId]: { ...prev[entryId], ...patch } }));
  }

  /**
   * Keeps entries' legacy singular columns mirroring the *first*
   * entry_subject_tags row after any tag-level mutation (the reasoning
   * panel's change-subject/remove/add actions) -- same principle as
   * insertEntryWithTags, applied on the update side.
   */
  async function syncEntryLegacyFields(entryId: string) {
    const supabase = createClient();
    const { data: tags } = await supabase
      .from("entry_subject_tags")
      .select("*")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: true });
    const [primary] = tags ?? [];
    await supabase
      .from("entries")
      .update({
        subject_tags: (tags ?? []).map((t) => t.subject_area),
        credit_value: sumCredits((tags ?? []).map((t) => t.credit_value)),
        final_description: primary?.course_title ?? null,
        final_reasoning: primary?.reasoning ?? null,
      })
      .eq("id", entryId);
  }

  /** The reasoning panel's "change subject" action -- writes back
   * immediately, no separate save step, per the brief. */
  async function changeTag(tagId: string, patch: { subjectArea?: string; courseTitle?: string }) {
    const supabase = createClient();
    const updates: { subject_area?: string; course_title?: string } = {};
    if (patch.subjectArea !== undefined) updates.subject_area = patch.subjectArea;
    if (patch.courseTitle !== undefined) updates.course_title = patch.courseTitle;
    const { data: tag } = await supabase.from("entry_subject_tags").update(updates).eq("id", tagId).select("entry_id").single();
    if (!tag) return;
    await syncEntryLegacyFields(tag.entry_id);
    await refreshSubjectLedger();
    await loadEntries();
  }

  /** The reasoning panel's "remove" action -- also revokes that tag's
   * credit from its subject's ledger immediately. */
  async function removeTag(tagId: string) {
    const supabase = createClient();
    const { data: tag } = await supabase.from("entry_subject_tags").select("entry_id").eq("id", tagId).single();
    if (!tag) return;
    await supabase.from("entry_subject_tags").delete().eq("id", tagId);
    await syncEntryLegacyFields(tag.entry_id);
    await refreshSubjectLedger();
    await loadEntries();
  }

  /** The reasoning panel's "add a subject" action, for a tag the system
   * missed. Confidence is always "human" here -- a parent-added tag isn't
   * a system estimate at all. */
  async function addTag(entry: EntryWithTags, input: { subjectArea: string; courseTitle: string; creditValue: number }) {
    if (!currentStudent) return;
    const supabase = createClient();
    await findOrCreateClass(currentStudent.id, input.subjectArea);
    await supabase.from("entry_subject_tags").insert({
      entry_id: entry.id,
      student_id: currentStudent.id,
      subject_area: input.subjectArea,
      course_title: input.courseTitle,
      credit_value: input.creditValue,
      confidence: "human",
      quoted_phrase: null,
      reasoning: "Added by a parent — not drafted by the pipeline.",
      source_stage: "human",
    });
    await syncEntryLegacyFields(entry.id);
    await refreshSubjectLedger();
    await loadEntries();
  }

  async function decide(entry: EntryWithTags, decision: "accept" | "reject") {
    const supabase = createClient();
    if (decision === "reject") {
      await supabase.from("entries").delete().eq("id", entry.id);
    } else {
      const pending = edits[entry.id];
      const finalDescription = pending?.finalDescription ?? entry.final_description;
      const finalReasoning = pending?.finalReasoning ?? entry.final_reasoning;
      const creditValue = pending?.creditValue ?? entry.credit_value;
      await supabase
        .from("entries")
        .update({
          final_description: finalDescription,
          final_reasoning: finalReasoning,
          credit_value: creditValue,
          status: "accepted",
          updated_at: new Date().toISOString(),
        })
        .eq("id", entry.id);

      // This card only exposes one description/reasoning/credit field each,
      // pre-dating multi-tag support -- edits here apply to the primary
      // (first) tag only. Editing other tags on a multi-tag entry is the
      // reasoning panel's job (Part 4), not this form.
      const [primaryTag] = entry.entry_subject_tags;
      if (primaryTag && pending) {
        await supabase
          .from("entry_subject_tags")
          .update({
            course_title: finalDescription ?? primaryTag.course_title,
            reasoning: finalReasoning ?? primaryTag.reasoning,
            credit_value: pending.creditValue ?? primaryTag.credit_value,
          })
          .eq("id", primaryTag.id);
      }

      const tags =
        entry.entry_subject_tags.length > 0
          ? entry.entry_subject_tags.map((tag, i) => ({
              subjectArea: tag.subject_area,
              courseTitle: i === 0 ? finalDescription ?? tag.course_title : tag.course_title,
              creditValue: i === 0 ? pending?.creditValue ?? tag.credit_value : tag.credit_value,
              reasoning: i === 0 ? finalReasoning ?? tag.reasoning : tag.reasoning,
            }))
          : [
              {
                subjectArea: entry.classes?.subject_area ?? entry.subject_tags[0] ?? "",
                courseTitle: finalDescription ?? "",
                creditValue,
                reasoning: finalReasoning ?? "",
              },
            ];

      await recordRetrievalCase(supabase, entry.id, entry.raw_word_dump, { tags });
      await refreshSubjectLedger();
    }
    setEdits((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
    await loadEntries();
  }

  if (!currentStudent) {
    return <p className="text-muted text-sm">Add a student from the dashboard first.</p>;
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

      {quickAdd && (
        <form onSubmit={submitQuickAdd} className="flex flex-col gap-3 rounded-lg border border-gold/40 bg-surface shadow-sm p-4">
          <p className="text-sm font-medium">New entry for {quickAdd.subjectArea}</p>
          <p className="text-xs text-muted">
            Accepted from the Discovery notes on the Profile page — describe the specific activity below to
            log the first entry for this class.
          </p>
          <textarea
            className="input min-h-20"
            placeholder="What did they actually do?"
            value={quickAdd.rawWordDump}
            onChange={(e) => setQuickAdd({ ...quickAdd, rawWordDump: e.target.value })}
            required
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              placeholder="Subject"
              value={quickAdd.subjectArea}
              onChange={(e) => setQuickAdd({ ...quickAdd, subjectArea: e.target.value })}
              required
            />
            <input
              className="input"
              placeholder="Class/course title"
              value={quickAdd.courseTitle}
              onChange={(e) => setQuickAdd({ ...quickAdd, courseTitle: e.target.value })}
            />
          </div>
          <textarea
            className="input min-h-20"
            placeholder="Why this counts toward that subject"
            value={quickAdd.description}
            onChange={(e) => setQuickAdd({ ...quickAdd, description: e.target.value })}
            required
          />
          <label className="flex items-center gap-2 text-sm w-fit">
            <input
              type="number"
              step={0.05}
              min={0}
              className="input w-24"
              value={quickAdd.creditValue}
              onChange={(e) => setQuickAdd({ ...quickAdd, creditValue: e.target.value })}
            />
            <span className="text-muted">credit value</span>
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn-primary w-fit"
              disabled={quickAdding || !quickAdd.rawWordDump.trim() || !quickAdd.description.trim()}
            >
              {quickAdding ? "Saving…" : "Save entry"}
            </button>
            <button type="button" className="btn-secondary w-fit" onClick={() => setQuickAdd(null)}>
              Discard
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      {!needsReview ? (
        <CaptureCard form={form} onChange={setForm} onSubmit={submitWordDump} submitting={submitting} error={error} />
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
        {!loading && entries.length === 0 && (
          <p className="text-muted text-sm">
            Nothing woven yet — describe today&apos;s first activity above and FreeLoom will draft the record.
          </p>
        )}
        {entries.map((entry) => (
          <RecordCard
            key={entry.id}
            entry={entry}
            pending={edits[entry.id]}
            onEditField={(patch) => editField(entry.id, patch)}
            onDecide={(decision) => decide(entry, decision)}
            onChangeTag={changeTag}
            onRemoveTag={removeTag}
            onAddTag={(input) => addTag(entry, input)}
          />
        ))}
      </div>
    </div>
  );
}
