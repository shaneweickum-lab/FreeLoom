"use client";

import { useEffect, useState } from "react";
import StitchDivider from "@/components/StitchDivider";
import { sumCredits } from "@/lib/pipeline/credit-calculation";
import type { PipelineClass, PipelineEntry, PipelineEntrySubjectTag, TagConfidence } from "@/lib/types";

export type EntryWithTags = PipelineEntry & {
  classes: Pick<PipelineClass, "subject_area" | "title"> | null;
  entry_subject_tags: PipelineEntrySubjectTag[];
};

export type PendingEdit = { finalDescription?: string; finalReasoning?: string; creditValue?: number };

const CONFIDENCE_DOT: Record<Exclude<TagConfidence, "human">, string> = {
  high: "bg-gold",
  medium: "bg-violet",
  low: "bg-ink-soft",
};

const CONFIDENCE_LABEL: Record<Exclude<TagConfidence, "human">, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

function ConfidenceIndicator({ confidence }: { confidence: TagConfidence }) {
  if (confidence === "human") {
    return <span className="text-xs text-ink-soft italic shrink-0">Added by you</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft shrink-0">
      <span className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT[confidence]}`} />
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}

function TagRow({
  tag,
  canRemove,
  onChangeTag,
  onRemoveTag,
  onChangeHours,
}: {
  tag: PipelineEntrySubjectTag;
  canRemove: boolean;
  onChangeTag: (tagId: string, patch: { subjectArea?: string; courseTitle?: string }) => void;
  onRemoveTag: (tagId: string) => void;
  onChangeHours: (tagId: string, minutes: number) => void;
}) {
  const [subjectArea, setSubjectArea] = useState(tag.subject_area);
  const [courseTitle, setCourseTitle] = useState(tag.course_title);
  const [minutes, setMinutes] = useState(tag.time_spent_minutes != null ? String(Math.round(tag.time_spent_minutes)) : "");

  useEffect(() => {
    // Re-sync local editable-input state when the underlying tag changes
    // out from under it (e.g. loadEntries() refetching after some other
    // edit) -- same pattern used elsewhere in this app for input-mirrors-prop state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubjectArea(tag.subject_area);
    setCourseTitle(tag.course_title);
    setMinutes(tag.time_spent_minutes != null ? String(Math.round(tag.time_spent_minutes)) : "");
  }, [tag.subject_area, tag.course_title, tag.time_spent_minutes]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-parchment-line bg-white/30 p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <input
            className="bg-transparent border-none px-0 py-0 text-sm font-medium text-ink outline-none focus-visible:ring-1 focus-visible:ring-gold rounded"
            value={subjectArea}
            onChange={(e) => setSubjectArea(e.target.value)}
            onBlur={() => subjectArea.trim() && subjectArea !== tag.subject_area && onChangeTag(tag.id, { subjectArea: subjectArea.trim() })}
          />
          <input
            className="bg-transparent border-none px-0 py-0 text-xs text-ink-soft outline-none focus-visible:ring-1 focus-visible:ring-gold rounded"
            value={courseTitle}
            onChange={(e) => setCourseTitle(e.target.value)}
            onBlur={() => courseTitle.trim() && courseTitle !== tag.course_title && onChangeTag(tag.id, { courseTitle: courseTitle.trim() })}
          />
        </div>
        <ConfidenceIndicator confidence={tag.confidence} />
      </div>
      {tag.quoted_phrase ? (
        <p className="text-xs italic text-ink-soft">&ldquo;{tag.quoted_phrase}&rdquo;</p>
      ) : (
        <p className="text-xs text-ink-soft/70">No specific phrase behind this match.</p>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          <input
            type="number"
            step={1}
            min={0}
            className="w-16 rounded border border-ink/20 bg-white/50 px-1.5 py-0.5 text-xs text-ink"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onBlur={() => {
              const parsed = Number(minutes);
              if (minutes.trim() !== "" && !Number.isNaN(parsed) && parsed !== tag.time_spent_minutes) {
                onChangeHours(tag.id, parsed);
              }
            }}
          />
          min &middot; <span className="font-mono">{tag.credit_value.toFixed(2)} credits</span>
        </label>
        {canRemove && (
          <button onClick={() => onRemoveTag(tag.id)} className="text-xs text-ink-soft hover:text-red-700 transition-colors">
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function AddTagForm({ onAdd }: { onAdd: (input: { subjectArea: string; courseTitle: string; creditValue: number }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [subjectArea, setSubjectArea] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [creditValue, setCreditValue] = useState("0.1");
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-fit text-xs text-gold hover:underline">
        + Add a subject
      </button>
    );
  }

  async function handleAdd() {
    if (!subjectArea.trim()) return;
    setSaving(true);
    await onAdd({ subjectArea: subjectArea.trim(), courseTitle: courseTitle.trim() || subjectArea.trim(), creditValue: Number(creditValue) || 0 });
    setSaving(false);
    setOpen(false);
    setSubjectArea("");
    setCourseTitle("");
    setCreditValue("0.1");
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-parchment-line p-3">
      <input
        className="bg-white/40 border border-parchment-line text-ink text-sm rounded px-2 py-1"
        placeholder="Subject the system missed"
        value={subjectArea}
        onChange={(e) => setSubjectArea(e.target.value)}
      />
      <input
        className="bg-white/40 border border-parchment-line text-ink text-sm rounded px-2 py-1"
        placeholder="Class/course title (optional)"
        value={courseTitle}
        onChange={(e) => setCourseTitle(e.target.value)}
      />
      <label className="flex items-center gap-2 text-xs text-ink-soft w-fit">
        <input
          type="number"
          step={0.01}
          min={0}
          className="bg-white/40 border border-parchment-line text-ink text-sm rounded px-2 py-1 w-20"
          value={creditValue}
          onChange={(e) => setCreditValue(e.target.value)}
        />
        credit value
      </label>
      <div className="flex gap-2">
        <button onClick={handleAdd} disabled={saving || !subjectArea.trim()} className="btn-primary text-xs w-fit">
          {saving ? "Adding…" : "Add"}
        </button>
        <button onClick={() => setOpen(false)} className="btn-secondary text-xs w-fit">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function RecordCard({
  entry,
  pending,
  onEditField,
  onDecide,
  onChangeTag,
  onRemoveTag,
  onAddTag,
  onChangeHours,
}: {
  entry: EntryWithTags;
  pending?: PendingEdit;
  onEditField: (patch: PendingEdit) => void;
  onDecide: (decision: "accept" | "reject") => void;
  onChangeTag: (tagId: string, patch: { subjectArea?: string; courseTitle?: string }) => void;
  onRemoveTag: (tagId: string) => void;
  onAddTag: (input: { subjectArea: string; courseTitle: string; creditValue: number }) => Promise<void>;
  onChangeHours: (tagId: string, minutes: number) => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const tags = entry.entry_subject_tags;
  const isDraft = entry.status === "draft";

  return (
    <div className="flex flex-col sm:flex-row rounded-lg border border-navy-line overflow-hidden shadow-sm">
      <div className="p-4 bg-navy-soft sm:w-2/5 flex flex-col gap-1">
        <div className="text-xs text-muted font-mono">{new Date(entry.created_at).toLocaleDateString()}</div>
        <p className="text-sm italic font-serif">{entry.raw_word_dump}</p>
      </div>

      <StitchDivider />

      <div className="p-4 bg-parchment text-ink flex-1 flex flex-col gap-2 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-mono uppercase tracking-wide text-ink-soft">
            {entry.classes?.subject_area ?? "Uncategorized"}
          </span>
          <span className="rounded-full bg-gold/25 text-ink text-xs font-mono px-2 py-0.5 shrink-0">
            {entry.credit_value.toFixed(2)} cr
          </span>
        </div>

        <input
          className="bg-transparent border-none px-0 py-0 font-serif font-semibold text-ink outline-none focus-visible:ring-1 focus-visible:ring-gold rounded disabled:cursor-default"
          value={pending?.finalDescription ?? entry.final_description ?? ""}
          disabled={!isDraft}
          onChange={(e) => onEditField({ finalDescription: e.target.value })}
        />
        <textarea
          className="bg-transparent border-none px-0 py-0 text-xs text-ink-soft italic min-h-12 outline-none focus-visible:ring-1 focus-visible:ring-gold rounded disabled:cursor-default"
          value={pending?.finalReasoning ?? entry.final_reasoning ?? ""}
          disabled={!isDraft}
          onChange={(e) => onEditField({ finalReasoning: e.target.value })}
        />

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span key={t.id} className="text-xs rounded-full bg-ink/10 text-ink px-2 py-0.5">
                {t.subject_area}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-2 mt-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="number"
              step={0.01}
              min={0}
              className="w-20 rounded border border-ink/20 bg-white/50 px-2 py-1 text-sm text-ink disabled:opacity-60"
              value={pending?.creditValue ?? entry.credit_value}
              disabled={!isDraft}
              onChange={(e) => onEditField({ creditValue: Number(e.target.value) })}
            />
            <span className="text-ink-soft text-xs">credit value</span>
          </label>
          <div className="flex items-center gap-2">
            <button onClick={() => setPanelOpen((v) => !v)} className="text-xs text-ink-soft hover:text-ink underline underline-offset-2">
              {panelOpen ? "Hide reasoning" : "Why this mapping"}
            </button>
            {isDraft ? (
              <div className="flex gap-2">
                <button onClick={() => onDecide("reject")} className="btn-secondary text-xs">
                  Reject
                </button>
                <button onClick={() => onDecide("accept")} className="btn-primary text-xs">
                  Accept
                </button>
              </div>
            ) : (
              <span className="text-xs text-ink-soft">Accepted</span>
            )}
          </div>
        </div>

        {panelOpen && (
          <div className="mt-2 flex flex-col gap-2 border-t border-parchment-line pt-3">
            {tags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                canRemove={tags.length > 1}
                onChangeTag={onChangeTag}
                onRemoveTag={onRemoveTag}
                onChangeHours={onChangeHours}
              />
            ))}
            <AddTagForm onAdd={onAddTag} />
          </div>
        )}
      </div>
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * A collapsed summary for every ACCEPTED entry sharing one class_id --
 * once a parent accepts a second (or third, ...) entry for a class that
 * already has one, the feed shouldn't grow a whole new card per entry;
 * this shows a single accumulated total instead, expandable back into the
 * individual entries (each rendered via the same RecordCard used
 * everywhere else, so editing/reasoning/add-remove-tag all keep working
 * per entry). Only ever rendered for groups of 2+ -- a lone accepted entry
 * for a class just renders as a plain RecordCard, no grouping wrapper
 * needed.
 */
export function GroupedRecordCard({
  entries,
  edits,
  onEditField,
  onChangeTag,
  onRemoveTag,
  onAddTag,
  onChangeHours,
}: {
  entries: EntryWithTags[];
  edits: Record<string, PendingEdit>;
  onEditField: (entryId: string, patch: PendingEdit) => void;
  onChangeTag: (tagId: string, patch: { subjectArea?: string; courseTitle?: string }) => void;
  onRemoveTag: (tagId: string) => void;
  onAddTag: (entry: EntryWithTags, input: { subjectArea: string; courseTitle: string; creditValue: number }) => Promise<void>;
  onChangeHours: (tagId: string, minutes: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // entries arrives most-recent-first (the feed's own query order) -- that
  // first entry is what stands in for the group's headline/date when collapsed.
  const [mostRecent] = entries;
  const totalCredit = sumCredits(entries.map((e) => e.credit_value));

  return (
    <div className="rounded-lg border border-navy-line overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 bg-navy-soft text-left hover:bg-navy-soft/80 transition-colors"
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs font-mono uppercase tracking-wide text-muted">
            {mostRecent.classes?.subject_area ?? "Uncategorized"}
          </span>
          <span className="font-serif font-semibold truncate">{mostRecent.final_description}</span>
          <span className="text-xs text-muted">{entries.length} entries accumulated</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="rounded-full bg-gold/25 text-ink text-xs font-mono px-2 py-0.5">{totalCredit.toFixed(2)} cr</span>
          <ChevronIcon className={`h-4 w-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 p-3 bg-background/60">
          {entries.map((entry) => (
            <RecordCard
              key={entry.id}
              entry={entry}
              pending={edits[entry.id]}
              onEditField={(patch) => onEditField(entry.id, patch)}
              onDecide={() => {}}
              onChangeTag={onChangeTag}
              onRemoveTag={onRemoveTag}
              onAddTag={(input) => onAddTag(entry, input)}
              onChangeHours={onChangeHours}
            />
          ))}
        </div>
      )}
    </div>
  );
}
