"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { findCurrentSession, type AcademicSession } from "@/lib/academicSessions";
import { creditFromHours, guessIsLabScience } from "@/lib/pipeline/credit-calculation";
import { parseEntriesCsv, type ImportedEntryRow, type ParsedImport } from "@/lib/importEntries";

const CSV_TEMPLATE = [
  "date,subject,course_title,description,hours",
  "2025-09-03,Mathematics,Algebra I,Worked through chapter 3 word problems,1.5",
].join("\n");

/** Lets a parent bring in past records from a spreadsheet instead of
 * retyping every entry -- each row becomes an already-accepted entry
 * (source_stage "human", same as a manually-resolved Stage 5 entry) since
 * the parent has already made every judgment call the classify pipeline
 * would otherwise make. Backdates created_at to the row's own date rather
 * than "now", so imported history lands in the right academic session and
 * sorts correctly alongside everything logged normally. */
export default function ImportEntriesModal({
  studentId,
  userId,
  onClose,
  onImported,
}: {
  studentId: string;
  userId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleTextChange(text: string) {
    setCsvText(text);
    setParsed(text.trim() ? parseEntriesCsv(text) : null);
    setImportedCount(null);
    setImportError(null);
  }

  function handleFile(file: File) {
    file.text().then(handleTextChange);
  }

  /** Same select-then-insert-with-race-tolerance shape as findOrCreateClass
   * in (app)/log/page.tsx, kept as its own copy here rather than shared --
   * that function is a local closure over the log page's own component
   * state, not an exported utility, and this is the only other caller. */
  async function findOrCreateClass(
    supabase: ReturnType<typeof createClient>,
    subjectArea: string,
    sessionId: string | null
  ) {
    function existingQuery() {
      const query = supabase.from("classes").select("*").eq("student_id", studentId).eq("subject_area", subjectArea);
      return sessionId ? query.eq("session_id", sessionId) : query.is("session_id", null);
    }
    const { data: existing } = await existingQuery().maybeSingle();
    if (existing) return existing;

    const { data: created, error } = await supabase
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
    if (!error) return created;

    // Same 23505 race as findOrCreateClass in the log page -- a second
    // import row for the same (student, subject, session) can lose this
    // exact race between the select above and this insert.
    if (error.code === "23505") {
      const { data: retried } = await existingQuery().single();
      if (retried) return retried;
    }
    throw error;
  }

  async function importRow(supabase: ReturnType<typeof createClient>, sessions: AcademicSession[], row: ImportedEntryRow) {
    const sessionId = findCurrentSession(sessions, row.date.slice(0, 10))?.id ?? null;
    const cls = await findOrCreateClass(supabase, row.subjectArea, sessionId);
    const minutes = row.hours * 60;
    const creditValue = creditFromHours(minutes, cls.is_lab_science, 0.25);

    const { data: entry, error: entryError } = await supabase
      .from("entries")
      .insert({
        class_id: cls.id,
        student_id: studentId,
        raw_word_dump: row.description,
        extracted_slots: { activity_type: "other", source_platform: null, time_spent_minutes: minutes },
        subject_tags: [row.subjectArea],
        skill_tags: [],
        credit_value: creditValue,
        final_description: row.courseTitle,
        final_reasoning: row.description,
        status: "accepted",
        source_stage: "human",
        created_at: row.date,
      })
      .select()
      .single();
    if (entryError || !entry) throw entryError ?? new Error("Couldn't save that row.");

    const { error: tagError } = await supabase.from("entry_subject_tags").insert({
      entry_id: entry.id,
      student_id: studentId,
      subject_area: row.subjectArea,
      course_title: row.courseTitle,
      credit_value: creditValue,
      time_spent_minutes: minutes,
      confidence: "human",
      quoted_phrase: null,
      reasoning: "Imported from a historical record.",
      source_stage: "human",
      created_at: row.date,
    });
    if (tagError) throw tagError;
  }

  async function runImport() {
    if (!parsed || parsed.rows.length === 0) return;
    setImporting(true);
    setImportError(null);
    const supabase = createClient();
    try {
      const { data: sessionRows } = await supabase.from("academic_sessions").select("*").eq("user_id", userId);
      const sessions = (sessionRows as AcademicSession[]) ?? [];

      let count = 0;
      for (const row of parsed.rows) {
        await importRow(supabase, sessions, row);
        count++;
      }
      setImportedCount(count);
      onImported();
    } catch (err) {
      setImportError(
        `Only ${importedCount ?? 0} of ${parsed.rows.length} rows saved before something went wrong -- the rest weren't imported. ${
          err instanceof Error ? err.message : ""
        }`
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-deep/70 p-4 pt-16 sm:pt-24">
      <div aria-hidden onClick={onClose} className="fixed inset-0" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import historical records"
        className="relative w-full max-w-lg rounded-lg border border-navy-line bg-navy-soft p-5 shadow-lg flex flex-col gap-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-lg font-bold text-foreground">Import historical records</h2>
            <p className="text-xs text-muted mt-1">
              Bring in past entries from a spreadsheet instead of retyping them. Columns: date, subject, course_title
              (optional), description, hours.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-foreground transition-colors shrink-0">
            ✕
          </button>
        </div>

        {importedCount === null && (
          <>
            <div className="flex flex-col gap-2">
              <label className="btn-secondary text-xs w-fit cursor-pointer">
                Upload a CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </label>
              <textarea
                className="input min-h-32 font-mono text-xs"
                placeholder={CSV_TEMPLATE}
                value={csvText}
                onChange={(e) => handleTextChange(e.target.value)}
              />
            </div>

            {parsed && (
              <div className="flex flex-col gap-1 text-xs max-h-40 overflow-y-auto">
                <p className="text-muted">
                  {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} ready to import
                  {parsed.errors.length > 0 && `, ${parsed.errors.length} skipped`}.
                </p>
                {parsed.errors.map((err, i) => (
                  <p key={i} className="text-red-400">
                    Line {err.line}: {err.message}
                  </p>
                ))}
              </div>
            )}

            {importError && <p className="text-xs text-red-400">{importError}</p>}

            <div className="flex items-center gap-3">
              <button
                onClick={runImport}
                disabled={!parsed || parsed.rows.length === 0 || importing}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {importing ? "Importing…" : `Import ${parsed?.rows.length ?? 0} row${parsed?.rows.length === 1 ? "" : "s"}`}
              </button>
              <button onClick={onClose} className="btn-secondary text-sm" disabled={importing}>
                Cancel
              </button>
            </div>
          </>
        )}

        {importedCount !== null && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Imported {importedCount} row{importedCount === 1 ? "" : "s"} into the portfolio.
            </p>
            <button onClick={onClose} className="btn-primary text-sm w-fit">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
