"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import { computeGpa, GRADE_LEVELS, groupByGradeLevel } from "@/lib/gpa";
import type { PipelineClass, PipelineEntry, SchoolProfile, Transcript } from "@/lib/types";

type EntryWithClass = PipelineEntry & { classes: Pick<PipelineClass, "subject_area"> | null };

/** The shape gpa.ts and TranscriptDocument already expect — mapped from an accepted entry. */
type TranscriptCourse = {
  id: string;
  course_title: string;
  subject_area: string;
  credit_hours: number;
  letter_grade: string | null;
  grade_level: string | null;
};

function toTranscriptCourse(entry: EntryWithClass): TranscriptCourse {
  return {
    id: entry.id,
    course_title: entry.final_description ?? "Untitled entry",
    subject_area: entry.classes?.subject_area ?? entry.subject_tags[0] ?? "Uncategorized",
    credit_hours: entry.credit_value,
    letter_grade: entry.letter_grade,
    grade_level: entry.grade_level,
  };
}

const EMPTY_SCHOOL_FORM = {
  schoolName: "",
  parentName: "",
  address: "",
  phone: "",
  email: "",
  accentColor: "#b45309",
  layoutStyle: "formal" as "formal" | "casual",
};

export default function TranscriptPage() {
  const { currentStudent } = useStudents();
  const [courses, setCourses] = useState<TranscriptCourse[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [schoolProfile, setSchoolProfile] = useState<SchoolProfile | null>(null);
  const [schoolForm, setSchoolForm] = useState(EMPTY_SCHOOL_FORM);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [savingSchool, setSavingSchool] = useState(false);
  const [schoolOpen, setSchoolOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const schoolOpenInitialized = useRef(false);

  async function load() {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: school } = await supabase.from("school_profiles").select("*").eq("user_id", user.id).maybeSingle();
      setSchoolProfile(school);
      setSchoolForm({
        schoolName: school?.school_name || "",
        parentName: school?.parent_name || "",
        address: school?.address || "",
        phone: school?.phone || "",
        email: school?.email || "",
        accentColor: school?.accent_color || "#b45309",
        layoutStyle: school?.layout_style || "formal",
      });
      // Default collapsed once a school profile already exists, but only on first
      // load — don't fight the user's own toggle on later re-renders/saves.
      if (!schoolOpenInitialized.current) {
        setSchoolOpen(!school);
        schoolOpenInitialized.current = true;
      }
    }

    if (!currentStudent) {
      setCourses([]);
      setTranscripts([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data: acceptedEntries } = await supabase
      .from("entries")
      .select("*, classes(subject_area)")
      .eq("student_id", currentStudent.id)
      .eq("status", "accepted")
      .order("created_at", { ascending: true });

    const { data: pastTranscripts } = await supabase
      .from("transcripts")
      .select("*")
      .eq("student_id", currentStudent.id)
      .order("generated_at", { ascending: false });

    setCourses(((acceptedEntries as EntryWithClass[]) || []).map(toTranscriptCourse));
    setTranscripts(pastTranscripts || []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStudent]);

  const totalCreditHours = Math.round(courses.reduce((sum, c) => sum + c.credit_hours, 0) * 100) / 100;
  const cumulative = computeGpa(courses);
  const grouped = groupByGradeLevel(courses);

  async function updateCourseField(entryId: string, patch: { letter_grade?: string | null; grade_level?: string | null }) {
    const supabase = createClient();
    setCourses((prev) => prev.map((c) => (c.id === entryId ? { ...c, ...patch } : c)));
    await supabase.from("entries").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", entryId);
  }

  async function saveSchoolProfile(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setSavingSchool(true);

    let logoUrl = schoolProfile?.logo_url ?? null;
    if (logoFile) {
      const ext = logoFile.name.split(".").pop() || "png";
      const path = `${user.id}/logo.${ext}`;
      const { error: uploadError } = await supabase.storage.from("branding").upload(path, logoFile, { upsert: true });
      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage.from("branding").getPublicUrl(path);
        logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;
      } else {
        console.error("Logo upload failed", uploadError);
      }
    }

    const { data } = await supabase
      .from("school_profiles")
      .upsert({
        user_id: user.id,
        school_name: schoolForm.schoolName || null,
        parent_name: schoolForm.parentName || null,
        address: schoolForm.address || null,
        phone: schoolForm.phone || null,
        email: schoolForm.email || null,
        logo_url: logoUrl,
        accent_color: schoolForm.accentColor || null,
        layout_style: schoolForm.layoutStyle,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (data) setSchoolProfile(data);
    setLogoFile(null);
    setSavingSchool(false);
  }

  async function generateTranscript() {
    if (!currentStudent || courses.length === 0) return;
    setGenerating(true);
    const supabase = createClient();
    await supabase.from("transcripts").insert({
      student_id: currentStudent.id,
      included_entry_ids: courses.map((c) => c.id),
    });
    await load();
    setGenerating(false);
  }

  async function copyShareLink(transcriptId: string) {
    const url = `${window.location.origin}/share/${transcriptId}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(transcriptId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  if (!currentStudent) {
    return <p className="text-muted text-sm">Add a child from the dashboard first.</p>;
  }
  if (loading) return null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">Transcript</h1>
          <p className="text-muted text-sm">Accepted entries for {currentStudent.name}, with cumulative GPA and credit hours.</p>
        </div>
        <button onClick={generateTranscript} className="btn-primary" disabled={generating || courses.length === 0}>
          {generating ? "Generating…" : "Generate transcript"}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-surface shadow-sm p-4">
        <button
          type="button"
          onClick={() => setSchoolOpen((v) => !v)}
          className="w-full text-left font-semibold text-sm flex items-center justify-between"
        >
          <span>School of Record {!schoolProfile && "— add this before generating an official transcript"}</span>
          <span className="text-muted text-xs">{schoolOpen ? "Hide" : "Edit"}</span>
        </button>
        {schoolOpen && (
        <form onSubmit={saveSchoolProfile} className="flex flex-col gap-3 mt-4">
          <p className="text-xs text-muted">
            Shared across every child on this account — appears on every transcript.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              placeholder="School name"
              value={schoolForm.schoolName}
              onChange={(e) => setSchoolForm({ ...schoolForm, schoolName: e.target.value })}
            />
            <input
              className="input"
              placeholder="Parent / guardian name"
              value={schoolForm.parentName}
              onChange={(e) => setSchoolForm({ ...schoolForm, parentName: e.target.value })}
            />
          </div>
          <input
            className="input"
            placeholder="Address"
            value={schoolForm.address}
            onChange={(e) => setSchoolForm({ ...schoolForm, address: e.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              placeholder="Phone"
              value={schoolForm.phone}
              onChange={(e) => setSchoolForm({ ...schoolForm, phone: e.target.value })}
            />
            <input
              className="input"
              placeholder="Email"
              value={schoolForm.email}
              onChange={(e) => setSchoolForm({ ...schoolForm, email: e.target.value })}
            />
          </div>

          <p className="text-xs text-muted -mb-1">Make the transcript your own — logo, color, and overall look.</p>
          <div className="grid gap-3 sm:grid-cols-3 items-center">
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Logo (optional)
              {schoolProfile?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={schoolProfile.logo_url} alt="Current logo" className="h-10 w-10 rounded-full object-cover mb-1" />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                className="text-sm text-muted"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Accent color
              <input
                type="color"
                className="input h-10 p-1"
                value={schoolForm.accentColor}
                onChange={(e) => setSchoolForm({ ...schoolForm, accentColor: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Layout style
              <select
                className="input"
                value={schoolForm.layoutStyle}
                onChange={(e) => setSchoolForm({ ...schoolForm, layoutStyle: e.target.value as "formal" | "casual" })}
              >
                <option value="formal">Formal</option>
                <option value="casual">Casual</option>
              </select>
            </label>
          </div>

          <button type="submit" className="btn-primary w-fit text-sm" disabled={savingSchool}>
            {savingSchool ? "Saving…" : "Save school info"}
          </button>
        </form>
        )}
      </div>

      <div className="rounded-lg border border-border bg-surface shadow-sm p-6 flex flex-col gap-8">
        <div>
          <div className="text-xl font-semibold mb-1">{currentStudent.name}</div>
          <div className="text-muted text-sm">{currentStudent.grade_level || "Grade level not set"}</div>
        </div>

        {courses.length === 0 ? (
          <p className="text-muted text-sm">
            No accepted entries yet. Accept a logged activity from the Learning Log page to build your transcript.
          </p>
        ) : (
          grouped.map((bucket) => {
            const blockGpa = computeGpa(bucket.courses);
            return (
              <div key={bucket.level}>
                <h2 className="font-semibold mb-2">
                  Course Study {bucket.level === "Other" ? "(no grade level set)" : `— Grade ${bucket.level}`}
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted border-b border-border">
                        <th className="py-2 pr-4 font-medium">Course Title</th>
                        <th className="py-2 pr-4 font-medium">Subject Area</th>
                        <th className="py-2 pr-4 font-medium">Grade</th>
                        <th className="py-2 pr-4 font-medium">HS Grade Level</th>
                        <th className="py-2 font-medium">Credits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bucket.courses.map((course) => (
                        <tr key={course.id} className="border-b border-border/60">
                          <td className="py-2.5 pr-4">{course.course_title}</td>
                          <td className="py-2.5 pr-4 text-muted">{course.subject_area}</td>
                          <td className="py-2.5 pr-4">
                            <input
                              className="input w-20"
                              placeholder="A, B+…"
                              defaultValue={course.letter_grade ?? ""}
                              onBlur={(e) => {
                                const value = e.target.value.trim() || null;
                                if (value !== course.letter_grade) updateCourseField(course.id, { letter_grade: value });
                              }}
                            />
                          </td>
                          <td className="py-2.5 pr-4">
                            <select
                              className="input w-24"
                              value={course.grade_level ?? ""}
                              onChange={(e) => updateCourseField(course.id, { grade_level: e.target.value || null })}
                            >
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
                {blockGpa.gpa !== null && (
                  <div className="text-right text-sm font-semibold mt-2">GPA: {blockGpa.gpa.toFixed(2)}</div>
                )}
              </div>
            );
          })
        )}

        {courses.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-4 pt-4 border-t border-border text-sm">
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
      </div>

      {transcripts.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">Generated transcripts</h2>
          {transcripts.map((t) => (
            <div key={t.id} className="rounded-lg border border-border bg-surface shadow-sm p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm">
                <div>{new Date(t.generated_at).toLocaleString()}</div>
                <div className="text-muted text-xs">{t.included_entry_ids.length} course(s)</div>
              </div>
              <div className="flex gap-2">
                <a href={`/api/transcript-pdf/${t.id}`} className="btn-secondary text-xs">
                  Download PDF
                </a>
                <button onClick={() => copyShareLink(t.id)} className="btn-secondary text-xs">
                  {copiedId === t.id ? "Link copied!" : "Copy share link"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
