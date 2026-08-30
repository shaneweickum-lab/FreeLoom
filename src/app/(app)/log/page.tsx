"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import type { ActivityType, EntryStatus, EntryTagCitation, PipelineEntry, ResearchCitation, SourceStage, TagConfidence, TagSource } from "@/lib/types";
import type { DraftSource } from "@/lib/pipeline/classify";
import type { ClassifyResultWithDraft } from "@/lib/pipeline/draftValidation";
import { draftEntryClientSide } from "@/lib/pipeline/webllmDraft";
import { recordRetrievalCase } from "@/lib/pipeline/retrieve";
import { findLikelyDuplicate, type LikelyDuplicate } from "@/lib/pipeline/duplicateDetection";
import { sumCredits, creditFromHours, guessIsLabScience } from "@/lib/pipeline/credit-calculation";
import { findCurrentSession, type AcademicSession } from "@/lib/academicSessions";
import CaptureCard, { type CaptureForm } from "@/components/CaptureCard";
import RecordCard, { GroupedRecordCard, type EntryWithTags } from "@/components/RecordCard";
import VoiceInputButton from "@/components/VoiceInputButton";
import PageHeader from "@/components/ui/PageHeader";

type TagInput = {
  subjectArea: string;
  courseTitle: string;
  creditValue: number;
  reasoning: string;
  confidence: TagConfidence;
  quotedPhrase: string | null;
  source: TagSource;
  /** Only ever present on a tag straight out of the classify API response
   * -- absent (not just empty) for manual/quick-add tags, same convention
   * as SubjectTagDraft.citations itself. */
  citations?: ResearchCitation[];
};

/** Slims a full research_citations row down to what entry_subject_tags
 * actually snapshots -- see EntryTagCitation's own doc comment for why
 * this is a copy taken at accept time, not a live join. */
function toEntryTagCitation(citation: ResearchCitation): EntryTagCitation {
  return {
    id: citation.id,
    title: citation.title,
    source: citation.source,
    source_url: citation.source_url,
    evidence_level: citation.evidence_level,
  };
}

const EMPTY_FORM = { rawWordDump: "", activityType: "other" as ActivityType, sourcePlatform: "", minutes: "" };
// creditValue is no longer typed by hand on either form -- it's computed
// from logged minutes via the Carnegie-unit algorithm (creditFromHours(),
// pipeline/credit-calculation.ts) once the target class's is_lab_science
// flag is known, in insertEntryWithTags().
const EMPTY_MANUAL_FORM = { subjectArea: "", courseTitle: "", description: "" };
const EMPTY_QUICK_ADD = { subjectArea: "", courseTitle: "", description: "", rawWordDump: "", minutes: "" };

/** Fallback credit_value used only when no minutes were actually logged --
 * shouldn't happen in practice now that every entry-creation path requires
 * an hours field, but kept as a defensive non-zero default rather than
 * ever storing a bare 0. */
const FALLBACK_CREDIT_VALUE = 0.25;

/** At least one tag drawn from a past accepted entry (Stage 2) makes the
 * whole entry a "retrieval" draft in DB terms; every other automated
 * combination (knowledge base, keyword cluster, fragment composition)
 * still counts as a "template" derivation, matching the original
 * single-tag mapping generalized to a tag list. */
function toSourceStage(tags: { source: DraftSource }[]): SourceStage {
  return tags.some((tag) => tag.source === "retrieval") ? "retrieval" : "template";
}

type FeedItem = { type: "single"; entry: EntryWithTags } | { type: "group"; entries: EntryWithTags[] };

/**
 * Collapses every ACCEPTED entry sharing a class_id into one feed item
 * (rendered as GroupedRecordCard) instead of one card apiece -- once a
 * parent accepts a second matching entry for the same class, the feed
 * shouldn't keep growing a new card per activity; drafts and
 * needs-review entries are left exactly as they were (still individual
 * decisions the parent hasn't made yet, not something to accumulate).
 * `allEntries` arrives most-recent-first (the feed's own query order);
 * each group appears at the position of its most recent member, and a
 * class with only one accepted entry still renders as a plain single
 * card -- grouping only matters once there's something to accumulate.
 */
function groupAcceptedEntries(allEntries: EntryWithTags[]): FeedItem[] {
  const acceptedByClass = new Map<string, EntryWithTags[]>();
  for (const entry of allEntries) {
    if (entry.status !== "accepted") continue;
    if (!acceptedByClass.has(entry.class_id)) acceptedByClass.set(entry.class_id, []);
    acceptedByClass.get(entry.class_id)!.push(entry);
  }

  const renderedClasses = new Set<string>();
  const items: FeedItem[] = [];
  for (const entry of allEntries) {
    if (entry.status !== "accepted") {
      items.push({ type: "single", entry });
      continue;
    }
    if (renderedClasses.has(entry.class_id)) continue;
    renderedClasses.add(entry.class_id);
    const group = acceptedByClass.get(entry.class_id)!;
    items.push(group.length > 1 ? { type: "group", entries: group } : { type: "single", entry: group[0] });
  }
  return items;
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

  // Set when submitWordDump finds a same-day entry with suspiciously
  // similar wording -- held here, unsubmitted, until the parent either
  // confirms via proceedWithSubmit() or dismisses it and edits the form.
  const [duplicateWarning, setDuplicateWarning] = useState<LikelyDuplicate | null>(null);

  // Set only when Stage 4's confidence check comes back empty-handed — the
  // word dump is held here, unsaved, until the parent resolves it via the
  // manual form below (Stage 5).
  const [needsReview, setNeedsReview] = useState<{ result: ClassifyResultWithDraft; rawWordDump: string; hadClientDraft: boolean } | null>(
    null
  );
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL_FORM);
  const [resolving, setResolving] = useState(false);
  // Stage 4 now runs client-side (see webllmDraft.ts) -- a first-ever call
  // on a fresh browser can mean a real, multi-hundred-MB model download
  // before a draft candidate comes back, so this surfaces WebLLM's own
  // loading-progress text instead of leaving the parent staring at an
  // unexplained pause on top of the classify request's own submitting state.
  const [draftStatus, setDraftStatus] = useState<string | null>(null);

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

  /** Which academic_sessions row (if any) covers today, for the parent
   * account `currentStudent` belongs to -- academic_sessions is per-family
   * (school_profiles-level), not per-student, since most homeschool
   * families run one shared calendar for every student in the house.
   * Resolved once per submission (not once per tag/findOrCreateClass call)
   * since every tag in the same submission shares the same "now". */
  async function getCurrentSessionId(parentUserId: string): Promise<string | null> {
    const supabase = createClient();
    const { data } = await supabase.from("academic_sessions").select("*").eq("user_id", parentUserId).order("start_date");
    return findCurrentSession((data as AcademicSession[]) || [])?.id ?? null;
  }

  /**
   * Finds the child's existing class for a subject, or creates one. Scoped
   * to (student, subject, session) rather than just (student, subject) --
   * sessionId is whatever getCurrentSessionId() resolved for "now", or null
   * if the family hasn't set up sessions (or today falls outside every
   * session they have). That null case is exactly the pre-session
   * behavior: one permanent class per subject, accumulating for the
   * student's entire time on the app. Once a session's end_date passes,
   * the next matching activity resolves a different (or no) session id and
   * gets its own fresh class here, instead of piling onto the old one --
   * that's what actually makes entries "start new classes within the new
   * date range and stop at the deadline," not anything at write time on
   * the old class itself.
   */
  async function findOrCreateClass(studentId: string, subjectArea: string, sessionId: string | null) {
    const supabase = createClient();
    function existingQuery() {
      const query = supabase.from("classes").select("*").eq("student_id", studentId).eq("subject_area", subjectArea);
      return sessionId ? query.eq("session_id", sessionId) : query.is("session_id", null);
    }

    const { data: existing } = await existingQuery().maybeSingle();
    if (existing) return existing;
    const { data: created, error: createError } = await supabase
      .from("classes")
      .insert({
        student_id: studentId,
        subject_area: subjectArea,
        title: subjectArea,
        session_id: sessionId,
        is_lab_science: guessIsLabScience(subjectArea),
      })
      .select()
      .single();
    if (!createError) return created;

    // 23505 (unique_violation) here means another concurrent call for this
    // exact (student, subject, session) already won the insert between our
    // SELECT above and this INSERT -- a real, previously-unhandled race
    // this select-then-insert pattern always had, just newly reachable
    // once entries in the same subject/session started arriving close
    // together. Re-select rather than surface a hard error: the row that
    // "lost" the race is exactly the one we want to use anyway.
    if (createError.code === "23505") {
      const { data: raced } = await existingQuery().maybeSingle();
      if (raced) return raced;
    }
    throw createError;
  }

  /**
   * Creates one entries row plus one entry_subject_tags row per tag. The
   * legacy singular columns (subject_tags, credit_value, final_description,
   * final_reasoning, class_id) mirror the *first* tag so pages that haven't
   * been updated to read the full tag list yet (portfolio, transcript
   * credit rollups) keep working against real, consistent data --
   * credit_value specifically is the sum across every tag, not just the
   * first, so those rollups don't silently under-count a multi-tag entry.
   *
   * Each tag's credit_value is RECOMPUTED here from an even split of
   * extractedSlots' time_spent_minutes across however many tags this word
   * dump produced, against that tag's actual class's is_lab_science flag
   * (creditFromHours(), the Carnegie-unit algorithm) -- one entry is one
   * block of time, so a dump resolving to N classes splits that time N
   * ways rather than counting the whole thing toward each. Falls back to
   * whatever the caller passed in (tag.creditValue) only when no minutes
   * were logged at all. This is what makes a parent's is_lab_science
   * correction on an existing class (Portfolio) actually change future
   * credit math, and what keeps every entry path -- pipeline classify,
   * manual resolution, quick-add -- scored the same real way instead of
   * three slightly different guesses. A parent can still rebalance the
   * split afterward per tag in the reasoning panel (changeTagHours()).
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
    const sessionId = currentStudent ? await getCurrentSessionId(currentStudent.user_id) : null;

    const classesByTag = await Promise.all(
      params.tags.map((tag) => findOrCreateClass(params.studentId, tag.subjectArea, sessionId))
    );
    // Split the logged time evenly across however many tags this word dump
    // produced -- one entry describes ONE block of time, so a dump that
    // resolves to 3 classes should split that time three ways, not count
    // it toward each class separately (which would triple-count it).
    const totalMinutes = params.extractedSlots.time_spent_minutes;
    const perTagMinutes = totalMinutes != null && params.tags.length > 0 ? totalMinutes / params.tags.length : totalMinutes;
    const scoredTags = params.tags.map((tag, i) => ({
      ...tag,
      timeSpentMinutes: perTagMinutes,
      creditValue: creditFromHours(perTagMinutes, classesByTag[i].is_lab_science, tag.creditValue),
    }));

    const [primaryTag] = scoredTags;
    const primaryClass = classesByTag[0];
    const totalCredit = sumCredits(scoredTags.map((t) => t.creditValue));

    const { data: entry, error: insertError } = await supabase
      .from("entries")
      .insert({
        class_id: primaryClass.id,
        student_id: params.studentId,
        raw_word_dump: params.rawWordDump,
        extracted_slots: params.extractedSlots,
        subject_tags: scoredTags.map((t) => t.subjectArea),
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

    for (const tag of scoredTags) {
      const { error: tagError } = await supabase.from("entry_subject_tags").insert({
        entry_id: entry.id,
        student_id: params.studentId,
        subject_area: tag.subjectArea,
        course_title: tag.courseTitle,
        credit_value: tag.creditValue,
        time_spent_minutes: tag.timeSpentMinutes,
        confidence: tag.confidence,
        quoted_phrase: tag.quotedPhrase,
        reasoning: tag.reasoning,
        source_stage: tag.source,
        citations: (tag.citations ?? []).map(toEntryTagCitation),
      });
      if (tagError) throw tagError;
    }

    return entry;
  }

  async function submitWordDump(e: React.FormEvent) {
    e.preventDefault();
    if (!currentStudent || !form.rawWordDump.trim() || !form.minutes) return;
    setSubmitting(true);
    setError(null);

    // Checked against only today's entries, not the student's whole
    // history -- see duplicateDetection.ts's header comment for why a
    // recurring activity on a different day must never trigger this.
    const supabase = createClient();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { data: recentEntries } = await supabase
      .from("entries")
      .select("id, raw_word_dump, created_at")
      .eq("student_id", currentStudent.id)
      .gte("created_at", startOfToday.toISOString());

    const duplicate = findLikelyDuplicate(form.rawWordDump, recentEntries ?? []);
    if (duplicate) {
      setDuplicateWarning(duplicate);
      setSubmitting(false);
      return;
    }

    await proceedWithSubmit();
  }

  /** The actual classify+insert flow -- runs immediately when
   * submitWordDump finds nothing suspicious, or directly from the
   * duplicate-warning banner's "Log it anyway" button, which already knows
   * about the match it's confirming past. */
  async function proceedWithSubmit() {
    if (!currentStudent) return;
    setDuplicateWarning(null);
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
      const result: ClassifyResultWithDraft = await res.json();

      if (!result.confident) {
        // Stage 4 → 5: hold the word dump here rather than writing anything
        // yet. The entry only gets created once the parent resolves it
        // below. Stage 4 itself runs client-side now (webllmDraft.ts) --
        // the server route stops at Stage 1-3, since WebGPU has no
        // server-side equivalent to call into. A draft candidate pre-fills
        // the same manual form a parent would otherwise start blank --
        // still fully editable, still requires their own Save click, never
        // auto-submitted.
        setDraftStatus("Getting Benny ready to help draft this…");
        const draft = await draftEntryClientSide(form.rawWordDump, (report) => setDraftStatus(report.text));
        setDraftStatus(null);
        setNeedsReview({ result, rawWordDump: form.rawWordDump, hadClientDraft: !!draft });
        setManualForm(
          draft
            ? { subjectArea: draft.subjectArea, courseTitle: draft.courseTitle, description: draft.rationale }
            : EMPTY_MANUAL_FORM
        );
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
            creditValue: FALLBACK_CREDIT_VALUE,
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
    if (!currentStudent || !quickAdd || !quickAdd.rawWordDump.trim() || !quickAdd.description.trim() || !quickAdd.minutes) return;
    setQuickAdding(true);
    setError(null);
    try {
      const supabase = createClient();
      const entry = await insertEntryWithTags({
        studentId: currentStudent.id,
        rawWordDump: quickAdd.rawWordDump.trim(),
        extractedSlots: { activity_type: null, source_platform: null, time_spent_minutes: Number(quickAdd.minutes) },
        tags: [
          {
            subjectArea: quickAdd.subjectArea.trim(),
            courseTitle: quickAdd.courseTitle.trim() || quickAdd.subjectArea.trim(),
            creditValue: FALLBACK_CREDIT_VALUE,
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

  /** The reasoning panel's "adjust hours" action for one tag -- recomputes
   * that tag's credit_value from the new minutes against its own class's
   * is_lab_science rate (the same Carnegie math insertEntryWithTags() uses
   * at intake), so rebalancing time across a multi-tag entry's classes
   * actually changes credit, not just a cosmetic number. Falls back to the
   * tag's existing credit_value if minutes is cleared, rather than
   * zeroing it out. */
  async function changeTagHours(tagId: string, minutes: number) {
    if (!currentStudent) return;
    const supabase = createClient();
    const { data: tag } = await supabase
      .from("entry_subject_tags")
      .select("entry_id, subject_area, credit_value")
      .eq("id", tagId)
      .single();
    if (!tag) return;
    const sessionId = await getCurrentSessionId(currentStudent.user_id);
    const cls = await findOrCreateClass(currentStudent.id, tag.subject_area, sessionId);
    const creditValue = creditFromHours(minutes, cls.is_lab_science, tag.credit_value);
    await supabase
      .from("entry_subject_tags")
      .update({ time_spent_minutes: minutes, credit_value: creditValue })
      .eq("id", tagId);
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
    const sessionId = await getCurrentSessionId(currentStudent.user_id);
    await findOrCreateClass(currentStudent.id, input.subjectArea, sessionId);
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
      <PageHeader
        title="Log an Activity"
        subtitle="Describe it in plain language. FreeLoom matches it against a curated knowledge base and a set of keyword rules — no model call, just a lookup — and drafts a class entry with its reasoning shown alongside it. If nothing matches, you write it yourself instead."
      />

      {quickAdd && (
        <form onSubmit={submitQuickAdd} className="flex flex-col gap-3 rounded-lg border border-gold/40 bg-surface shadow-sm p-4">
          <p className="text-sm font-medium">New entry for {quickAdd.subjectArea}</p>
          <p className="text-xs text-muted">
            Accepted from the Discovery notes on the Profile page — describe the specific activity below to
            log the first entry for this class.
          </p>
          <div className="relative">
            <textarea
              className="input min-h-20 pr-10"
              placeholder="What did they actually do?"
              value={quickAdd.rawWordDump}
              onChange={(e) => setQuickAdd({ ...quickAdd, rawWordDump: e.target.value })}
              required
            />
            <VoiceInputButton
              className="absolute bottom-2 right-2"
              onTranscript={(text) =>
                setQuickAdd({ ...quickAdd, rawWordDump: quickAdd.rawWordDump ? `${quickAdd.rawWordDump} ${text}` : text })
              }
            />
          </div>
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
              step={1}
              min={1}
              className="input w-24"
              value={quickAdd.minutes}
              onChange={(e) => setQuickAdd({ ...quickAdd, minutes: e.target.value })}
              required
            />
            <span className="text-muted">minutes spent</span>
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn-primary w-fit"
              disabled={quickAdding || !quickAdd.rawWordDump.trim() || !quickAdd.description.trim() || !quickAdd.minutes}
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
        <>
          <CaptureCard form={form} onChange={setForm} onSubmit={submitWordDump} submitting={submitting} error={error} />
          {draftStatus && <p className="text-xs text-muted italic">{draftStatus}</p>}
          {duplicateWarning && (
            <div className="flex flex-col gap-2 rounded-lg border border-gold/40 bg-surface shadow-sm p-4 text-sm">
              <p className="font-medium">Looks like you may have already logged this today</p>
              <p className="text-xs text-muted italic">&quot;{duplicateWarning.entry.raw_word_dump}&quot;</p>
              <div className="flex gap-2">
                <button type="button" className="btn-primary text-xs" onClick={proceedWithSubmit}>
                  Log it anyway
                </button>
                <button type="button" className="btn-secondary text-xs" onClick={() => setDuplicateWarning(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <form onSubmit={submitManualResolution} className="flex flex-col gap-3 rounded-lg border border-gold/40 bg-surface shadow-sm p-4">
          <p className="text-sm font-medium">Needs your input</p>
          <p className="text-xs text-muted italic">&quot;{needsReview.rawWordDump}&quot;</p>
          <p className="text-xs text-muted">
            Nothing in the knowledge base or keyword rules matched this one — write the class entry yourself. This also
            teaches the system: every entry resolved here becomes a candidate for a new rule down the line.
          </p>
          {needsReview.hadClientDraft && (
            <p className="text-xs font-medium text-gold w-fit rounded-full border border-gold/40 px-2 py-0.5">
              AI-drafted — please review carefully before saving
            </p>
          )}
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
          <p className="text-xs text-muted">
            Credit is calculated automatically from the {needsReview.result.extractedSlots.time_spent_minutes ?? 0}{" "}
            minutes you logged, using the Carnegie-unit convention (150 hours/credit, 180 for lab sciences).
          </p>
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
        {groupAcceptedEntries(entries).map((item) =>
          item.type === "group" ? (
            <GroupedRecordCard
              key={item.entries[0].class_id}
              entries={item.entries}
              edits={edits}
              onEditField={editField}
              onChangeTag={changeTag}
              onRemoveTag={removeTag}
              onAddTag={addTag}
              onChangeHours={changeTagHours}
            />
          ) : (
            <RecordCard
              key={item.entry.id}
              entry={item.entry}
              pending={edits[item.entry.id]}
              onEditField={(patch) => editField(item.entry.id, patch)}
              onDecide={(decision) => decide(item.entry, decision)}
              onChangeTag={changeTag}
              onRemoveTag={removeTag}
              onAddTag={(input) => addTag(item.entry, input)}
              onChangeHours={changeTagHours}
            />
          )
        )}
      </div>
    </div>
  );
}
