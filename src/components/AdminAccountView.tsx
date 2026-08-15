"use client";

import { useState } from "react";
import { computeGpa, GRADE_LEVELS, groupByGradeLevel } from "@/lib/gpa";
import { sumCredits } from "@/lib/pipeline/credit-calculation";
import Tabs from "@/components/Tabs";
import Card from "@/components/ui/Card";
import type {
  ProfileNote,
  PipelineClass,
  PipelineEntry,
  PipelineEntrySubjectTag,
  SchoolProfile,
  Student,
  Transcript,
} from "@/lib/types";

export type AdminAccountSnapshot = {
  students: Student[];
  classes: PipelineClass[];
  entries: PipelineEntry[];
  entry_subject_tags: PipelineEntrySubjectTag[];
  profile_notes: ProfileNote[];
  transcripts: Transcript[];
  school_profile: SchoolProfile | null;
};

const SCHOOLING_TYPE_LABEL: Record<string, string> = {
  homeschooling: "Homeschooling",
  unschooling: "Unschooling",
  wildschooling: "Wildschooling",
  alternative_schooling: "Alternative Schooling",
  private_schooling: "Private Schooling",
};

/** Every field below is populated read-only -- disabled, never wired to
 * onChange -- this view exists purely so an admin can see exactly what a
 * parent sees while troubleshooting, with zero write path back to the
 * account (that's what AccessRequestPanel's approval gate is for). */
function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted text-xs">{label}</span>
      <input className="input opacity-70 cursor-not-allowed" value={value ?? ""} disabled readOnly />
    </label>
  );
}

function DashboardTab({
  students,
  entries,
  schoolProfile,
}: {
  students: Student[];
  entries: PipelineEntry[];
  schoolProfile: SchoolProfile | null;
}) {
  if (students.length === 0) return <p className="text-sm text-muted">No students on this account yet.</p>;
  return (
    <div className="flex flex-col gap-6">
      {students.map((s) => {
        const accepted = entries.filter((e) => e.student_id === s.id && e.status === "accepted");
        const creditHours = sumCredits(accepted.map((e) => e.credit_value));
        return (
          <div key={s.id} className="rounded-lg border border-navy-line p-4 flex flex-col gap-3">
            <div className="text-xs text-muted">
              {accepted.length} course{accepted.length === 1 ? "" : "s"} &middot; {creditHours.toFixed(2)} credit hours
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Student's name" value={s.name} />
              <Field label="Grade level" value={s.grade_level} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="State" value={s.state} />
              <Field label="Birth date" value={schoolProfile?.hide_student_birthdates ? "**/**/**" : s.birth_date} />
              <Field label="Expected grad year" value={s.expected_graduation_year} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Gender" value={s.gender === "M" ? "Male" : s.gender === "F" ? "Female" : s.gender} />
              <Field label="Graduation date" value={s.graduation_date} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProfileTab({ student, note }: { student: Student | null; note: ProfileNote | null }) {
  if (!student) return <p className="text-sm text-muted">No student selected.</p>;
  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted text-xs">Discovery notes</span>
        <textarea className="input min-h-32 opacity-70 cursor-not-allowed" value={note?.content ?? ""} disabled readOnly />
      </label>

      {!!note?.ai_suggested_tracks?.some((t) => t.status !== "dismissed") && (
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold text-sm">Suggested classes</h2>
          {note.ai_suggested_tracks.map((track, i) => {
            // Dismissed suggestions are removed from the array entirely
            // going forward (see profile/page.tsx's dismissTrack()) -- this
            // guards against any already-dismissed entry from older data.
            if (track.status === "dismissed") return null;
            return (
              <div
                key={i}
                className={`rounded-lg border p-4 flex items-start justify-between gap-4 ${
                  track.status === "accepted" ? "border-gold bg-surface" : "border-navy-line bg-surface"
                }`}
              >
                <div>
                  <div className="font-medium text-sm">{track.subject}</div>
                  <div className="text-sm text-muted">{track.rationale}</div>
                </div>
                <span className="text-xs text-muted shrink-0 capitalize">{track.status}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LogEntryCard({ entry, tags, classSubjectArea }: { entry: PipelineEntry; tags: PipelineEntrySubjectTag[]; classSubjectArea: string | null }) {
  const [panelOpen, setPanelOpen] = useState(false);
  return (
    <div className="flex flex-col sm:flex-row rounded-lg border border-navy-line overflow-hidden">
      <div className="p-4 bg-navy-soft sm:w-2/5 flex flex-col gap-1">
        <div className="text-xs text-muted font-mono">{new Date(entry.created_at).toLocaleDateString()}</div>
        <p className="text-sm italic font-serif">{entry.raw_word_dump}</p>
      </div>
      <div className="p-4 bg-parchment text-ink flex-1 flex flex-col gap-2 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-mono uppercase tracking-wide text-ink-soft">{classSubjectArea ?? "Uncategorized"}</span>
          <span className="rounded-full bg-gold/25 text-ink text-xs font-mono px-2 py-0.5 shrink-0">{entry.credit_value.toFixed(2)} cr</span>
        </div>
        <input
          className="bg-transparent border-none px-0 py-0 font-serif font-semibold text-ink outline-none disabled:cursor-not-allowed"
          value={entry.final_description ?? ""}
          disabled
          readOnly
        />
        <textarea
          className="bg-transparent border-none px-0 py-0 text-xs text-ink-soft italic min-h-12 outline-none disabled:cursor-not-allowed"
          value={entry.final_reasoning ?? ""}
          disabled
          readOnly
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
              className="w-20 rounded border border-ink/20 bg-white/50 px-2 py-1 text-sm text-ink opacity-70 cursor-not-allowed"
              value={entry.credit_value}
              disabled
              readOnly
            />
            <span className="text-ink-soft text-xs">credit value</span>
          </label>
          <div className="flex items-center gap-2">
            <button onClick={() => setPanelOpen((v) => !v)} className="text-xs text-ink-soft hover:text-ink underline underline-offset-2">
              {panelOpen ? "Hide reasoning" : "Why this mapping"}
            </button>
            <span className="text-xs text-ink-soft">Accepted</span>
          </div>
        </div>
        {panelOpen && (
          <div className="mt-2 flex flex-col gap-2 border-t border-parchment-line pt-3">
            {tags.map((tag) => (
              <div key={tag.id} className="flex flex-col gap-2 rounded-md border border-parchment-line bg-white/30 p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
                    <span className="text-sm font-medium text-ink">{tag.subject_area}</span>
                    <span className="text-xs text-ink-soft">{tag.course_title}</span>
                  </div>
                  <span className="text-xs text-ink-soft shrink-0 capitalize">{tag.confidence}</span>
                </div>
                {tag.quoted_phrase ? (
                  <p className="text-xs italic text-ink-soft">&ldquo;{tag.quoted_phrase}&rdquo;</p>
                ) : (
                  <p className="text-xs text-ink-soft/70">No specific phrase behind this match.</p>
                )}
                <span className="text-xs font-mono text-ink-soft">{tag.credit_value.toFixed(2)} credits</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LogTab({
  student,
  entries,
  classes,
  tagsByEntry,
}: {
  student: Student | null;
  entries: PipelineEntry[];
  classes: PipelineClass[];
  tagsByEntry: Map<string, PipelineEntrySubjectTag[]>;
}) {
  if (!student) return <p className="text-sm text-muted">No student selected.</p>;
  const accepted = entries
    .filter((e) => e.student_id === student.id && e.status === "accepted")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const classById = new Map(classes.map((c) => [c.id, c]));

  if (accepted.length === 0) {
    return <p className="text-sm text-muted">No accepted entries yet for {student.name}.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {accepted.map((entry) => (
        <LogEntryCard
          key={entry.id}
          entry={entry}
          tags={tagsByEntry.get(entry.id) ?? []}
          classSubjectArea={classById.get(entry.class_id)?.subject_area ?? null}
        />
      ))}
    </div>
  );
}

function TranscriptTab({
  student,
  entries,
  classes,
  transcripts,
  schoolProfile,
}: {
  student: Student | null;
  entries: PipelineEntry[];
  classes: PipelineClass[];
  transcripts: Transcript[];
  schoolProfile: SchoolProfile | null;
}) {
  if (!student) return <p className="text-sm text-muted">No student selected.</p>;
  const classById = new Map(classes.map((c) => [c.id, c]));
  const courses = entries
    .filter((e) => e.student_id === student.id && e.status === "accepted")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((e) => ({
      id: e.id,
      course_title: e.final_description ?? "Untitled entry",
      subject_area: classById.get(e.class_id)?.subject_area ?? e.subject_tags[0] ?? "Uncategorized",
      credit_hours: e.credit_value,
      letter_grade: e.letter_grade,
      grade_level: e.grade_level,
    }));
  const studentTranscripts = transcripts
    .filter((t) => t.student_id === student.id)
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at));
  const totalCreditHours = Math.round(courses.reduce((sum, c) => sum + c.credit_hours, 0) * 100) / 100;
  const cumulative = computeGpa(courses);
  const grouped = groupByGradeLevel(courses);

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-lg border border-navy-line p-4">
        <p className="text-sm font-medium mb-1">School of Record</p>
        <p className="text-xs text-muted mb-3">Shared across every student on this account.</p>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="School name" value={schoolProfile?.school_name ?? null} />
            <Field label="Parent / guardian name" value={schoolProfile?.parent_name ?? null} />
          </div>
          <Field label="Address" value={schoolProfile?.address ?? null} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone" value={schoolProfile?.phone ?? null} />
            <Field label="Email" value={schoolProfile?.email ?? null} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3 items-end">
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Logo
              {schoolProfile?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={schoolProfile.logo_url} alt="School logo" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="text-xs text-muted">None set</span>
              )}
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Accent color
              <span className="flex items-center gap-2">
                <span
                  className="h-8 w-8 rounded border border-navy-line"
                  style={{ backgroundColor: schoolProfile?.accent_color ?? "#c7a252" }}
                />
                <span className="font-mono">{schoolProfile?.accent_color ?? "#c7a252"}</span>
              </span>
            </label>
            <Field label="Layout style" value={schoolProfile?.layout_style ?? "formal"} />
          </div>
        </div>
      </div>

      <Card padding="lg" className="flex flex-col gap-8">
        <div>
          <div className="text-xl font-semibold mb-1">{student.name}</div>
          <div className="text-muted text-sm">{student.grade_level || "Grade level not set"}</div>
        </div>

        {courses.length === 0 ? (
          <p className="text-muted text-sm">No accepted entries yet.</p>
        ) : (
          grouped.map((bucket) => {
            const blockGpa = computeGpa(bucket.courses);
            return (
              <div key={bucket.level}>
                <h2 className="font-semibold mb-2 text-sm">
                  Course Study {bucket.level === "Other" ? "(no grade level set)" : `— Grade ${bucket.level}`}
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted border-b border-navy-line">
                        <th className="py-2 pr-4 font-medium">Course Title</th>
                        <th className="py-2 pr-4 font-medium">Subject Area</th>
                        <th className="py-2 pr-4 font-medium">Grade</th>
                        <th className="py-2 pr-4 font-medium">HS Grade Level</th>
                        <th className="py-2 font-medium">Credits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bucket.courses.map((course) => (
                        <tr key={course.id} className="border-b border-navy-line/60">
                          <td className="py-2.5 pr-4">{course.course_title}</td>
                          <td className="py-2.5 pr-4 text-muted">{course.subject_area}</td>
                          <td className="py-2.5 pr-4">
                            <input className="input w-20 opacity-70 cursor-not-allowed" value={course.letter_grade ?? ""} disabled readOnly />
                          </td>
                          <td className="py-2.5 pr-4">
                            <select className="input w-24 opacity-70 cursor-not-allowed" value={course.grade_level ?? ""} disabled>
                              <option value="">—</option>
                              {GRADE_LEVELS.map((lvl) => (
                                <option key={lvl} value={lvl}>
                                  {lvl}th
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5">{course.credit_hours.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {blockGpa.gpa !== null && <div className="text-right text-sm font-semibold mt-2">GPA: {blockGpa.gpa.toFixed(2)}</div>}
              </div>
            );
          })
        )}

        {courses.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-4 pt-4 border-t border-navy-line text-sm">
            <div>
              <div className="text-muted text-xs">Total Credits</div>
              <div className="font-semibold text-gold">{totalCreditHours.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted text-xs">GPA Credits</div>
              <div className="font-semibold text-gold">{cumulative.gpaCredits.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted text-xs">GPA Points</div>
              <div className="font-semibold text-gold">{cumulative.gpaPoints.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted text-xs">Cumulative GPA</div>
              <div className="font-semibold text-gold">{cumulative.gpa !== null ? cumulative.gpa.toFixed(2) : "—"}</div>
            </div>
          </div>
        )}
      </Card>

      {studentTranscripts.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold text-sm">Generated transcripts</h2>
          {studentTranscripts.map((t) => (
            <div key={t.id} className="rounded-lg border border-navy-line p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm">
                <div>{new Date(t.generated_at).toLocaleString()}</div>
                <div className="text-muted text-xs">{t.included_entry_ids.length} course(s)</div>
              </div>
              <div className="flex gap-2">
                <span className="btn-secondary text-xs opacity-40 cursor-not-allowed">Download PDF</span>
                <span className="btn-secondary text-xs opacity-40 cursor-not-allowed">Copy share link</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PortfolioTab({
  student,
  classes,
  entries,
}: {
  student: Student | null;
  classes: PipelineClass[];
  entries: PipelineEntry[];
}) {
  if (!student) return <p className="text-sm text-muted">No student selected.</p>;
  const studentClasses = classes
    .filter((c) => c.student_id === student.id)
    .map((c) => ({ ...c, entries: entries.filter((e) => e.class_id === c.id && e.status === "accepted") }))
    .filter((c) => c.entries.length > 0)
    .sort((a, b) => a.subject_area.localeCompare(b.subject_area));

  if (studentClasses.length === 0) {
    return <p className="text-sm text-muted">Nothing accepted into the portfolio yet.</p>;
  }

  return (
    <div className="flex flex-col gap-10">
      {studentClasses.map((cls) => {
        const classCredits = sumCredits(cls.entries.map((e) => e.credit_value));
        return (
          <div key={cls.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-sm">{cls.title}</h2>
              <span className="text-xs text-muted">{classCredits.toFixed(2)} credits</span>
            </div>
            <div className="flex flex-col gap-3">
              {cls.entries.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-navy-line p-4 flex flex-col gap-2">
                  <div className="text-xs text-muted">{new Date(entry.created_at).toLocaleDateString()}</div>
                  <p className="text-xs text-muted italic">&quot;{entry.raw_word_dump}&quot;</p>
                  <input
                    className="input font-medium bg-transparent border-none px-0 opacity-70 cursor-not-allowed"
                    value={entry.final_description ?? ""}
                    disabled
                    readOnly
                  />
                  <textarea
                    className="input text-sm bg-transparent border-none px-0 text-muted min-h-16 opacity-70 cursor-not-allowed"
                    value={entry.final_reasoning ?? ""}
                    disabled
                    readOnly
                  />
                  <label className="flex items-center gap-2 text-sm w-fit">
                    <input type="number" className="input w-20 opacity-70 cursor-not-allowed" value={entry.credit_value} disabled readOnly />
                    <span className="text-muted">credit value</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SettingsTab({ schoolProfile }: { schoolProfile: SchoolProfile | null }) {
  const schoolingLabel = schoolProfile?.schooling_type ? SCHOOLING_TYPE_LABEL[schoolProfile.schooling_type] : "Not set";
  return (
    <div className="flex flex-col gap-3 max-w-lg">
      <Field label="Parent name" value={schoolProfile?.parent_name ?? null} />
      <Field label="State" value={schoolProfile?.state ?? null} />
      <Field label="How this family learns" value={schoolingLabel} />
      <Field label="Address" value={schoolProfile?.address ?? null} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone" value={schoolProfile?.phone ?? null} />
        <Field label="Email" value={schoolProfile?.email ?? null} />
      </div>
    </div>
  );
}

export default function AdminAccountView({ snapshot }: { snapshot: AdminAccountSnapshot }) {
  const { students, classes, entries, entry_subject_tags, profile_notes, transcripts, school_profile } = snapshot;
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(students[0]?.id ?? null);
  const currentStudent = students.find((s) => s.id === selectedStudentId) ?? null;
  const noteForCurrent = profile_notes.find((n) => n.student_id === selectedStudentId) ?? null;

  const tagsByEntry = new Map<string, PipelineEntrySubjectTag[]>();
  for (const tag of entry_subject_tags) {
    const list = tagsByEntry.get(tag.entry_id) ?? [];
    list.push(tag);
    tagsByEntry.set(tag.entry_id, list);
  }

  return (
    <div className="flex flex-col gap-6">
      {students.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-navy-line pb-3">
          {students.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedStudentId(s.id)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                selectedStudentId === s.id ? "bg-surface-hover text-gold" : "text-muted hover:text-foreground hover:bg-surface-hover"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <Tabs
        tabs={[
          {
            id: "dashboard",
            label: "Dashboard",
            content: <DashboardTab students={students} entries={entries} schoolProfile={school_profile} />,
          },
          { id: "profile", label: "Profile", content: <ProfileTab student={currentStudent} note={noteForCurrent} /> },
          {
            id: "log",
            label: "Learning Log",
            content: <LogTab student={currentStudent} entries={entries} classes={classes} tagsByEntry={tagsByEntry} />,
          },
          {
            id: "transcript",
            label: "Transcript",
            content: (
              <TranscriptTab
                student={currentStudent}
                entries={entries}
                classes={classes}
                transcripts={transcripts}
                schoolProfile={school_profile}
              />
            ),
          },
          { id: "portfolio", label: "Portfolio", content: <PortfolioTab student={currentStudent} classes={classes} entries={entries} /> },
          { id: "settings", label: "Settings", content: <SettingsTab schoolProfile={school_profile} /> },
        ]}
      />
    </div>
  );
}
