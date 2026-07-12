import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { ACTIVITY_TYPES } from "@/lib/types";
import { suggestTracks, translateLearningLog } from "@/lib/translate";

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_learning_log",
    description:
      "Log a new learning activity for the student and get an AI-translated course suggestion (subject area, course title, and credit hours). Use this whenever the parent describes something their child did, played, read, or built.",
    input_schema: {
      type: "object",
      properties: {
        raw_description: {
          type: "string",
          description: "Plain-language description of the activity, in the parent's own words",
        },
        activity_type: { type: "string", enum: ACTIVITY_TYPES, description: "Best-fit category for the activity" },
        source_platform: { type: "string", description: "Name of a specific game/platform/curriculum, if mentioned" },
        time_spent_minutes: { type: "number", description: "Minutes spent, if the parent mentioned a duration" },
      },
      required: ["raw_description", "activity_type"],
    },
  },
  {
    name: "approve_course",
    description:
      "Approve a suggested course so it counts toward the transcript. Optionally correct the title, subject area, or credit hours at the same time.",
    input_schema: {
      type: "object",
      properties: {
        course_id: { type: "string" },
        course_title: { type: "string" },
        subject_area: { type: "string" },
        credit_hours: { type: "number" },
      },
      required: ["course_id"],
    },
  },
  {
    name: "reject_course",
    description: "Reject a suggested course so it never counts toward the transcript.",
    input_schema: {
      type: "object",
      properties: { course_id: { type: "string" } },
      required: ["course_id"],
    },
  },
  {
    name: "update_student_profile",
    description: "Update one or more of the student's profile fields.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        grade_level: { type: "string" },
        state: { type: "string" },
        birth_date: { type: "string", description: "YYYY-MM-DD" },
        expected_graduation_year: { type: "number" },
      },
    },
  },
  {
    name: "save_discovery_notes",
    description: "Save or replace the student's discovery notes (hobbies, personality, learning style).",
    input_schema: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    },
  },
  {
    name: "suggest_tracks_from_notes",
    description: "Generate new subject/skill track suggestions from the student's current discovery notes.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_track_status",
    description: "Accept or dismiss one of the student's suggested discovery tracks by its index.",
    input_schema: {
      type: "object",
      properties: {
        track_index: { type: "number", description: "0-based index of the track in the suggested tracks list" },
        status: { type: "string", enum: ["accepted", "dismissed"] },
      },
      required: ["track_index", "status"],
    },
  },
  {
    name: "generate_transcript",
    description: "Snapshot all currently approved courses into a new transcript and get a shareable link.",
    input_schema: { type: "object", properties: {} },
  },
];

type ToolExecutionResult = { data: Record<string, unknown>; summary: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any>;

async function courseBelongsToStudent(supabase: Supa, courseId: string, studentId: string): Promise<boolean> {
  const { data } = await supabase
    .from("translated_courses")
    .select("id, learning_logs(student_id)")
    .eq("id", courseId)
    .maybeSingle();
  const logRow = data?.learning_logs as { student_id?: string } | null | undefined;
  return !!data && logRow?.student_id === studentId;
}

async function toolCreateLearningLog(
  supabase: Supa,
  studentId: string,
  gradeLevel: string | null,
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const raw_description = String(input.raw_description ?? "").trim();
  if (!raw_description) return { data: { error: "raw_description is required" }, summary: "Missing activity description." };

  const activity_type = ACTIVITY_TYPES.includes(input.activity_type as never)
    ? (input.activity_type as (typeof ACTIVITY_TYPES)[number])
    : "other";
  const time_spent_minutes = typeof input.time_spent_minutes === "number" ? input.time_spent_minutes : null;
  const source_platform = typeof input.source_platform === "string" ? input.source_platform : null;

  const translation = await translateLearningLog({
    raw_description,
    activity_type,
    source_platform,
    time_spent_minutes,
    grade_level: gradeLevel,
  });

  const { data: log, error: logError } = await supabase
    .from("learning_logs")
    .insert({ student_id: studentId, raw_description, activity_type, source_platform, time_spent_minutes })
    .select()
    .single();
  if (logError || !log) return { data: { error: "Failed to create learning log" }, summary: "Couldn't log that activity." };

  const { data: course } = await supabase
    .from("translated_courses")
    .insert({
      learning_log_id: log.id,
      course_title: translation.course_title,
      subject_area: translation.subject_area,
      credit_hours: translation.credit_hours,
      ai_rationale: translation.rationale,
      status: "suggested",
    })
    .select()
    .single();

  return {
    data: {
      log_id: log.id,
      course_id: course?.id,
      course_title: translation.course_title,
      subject_area: translation.subject_area,
      credit_hours: translation.credit_hours,
      status: "suggested",
    },
    summary: `Logged "${raw_description.slice(0, 60)}${raw_description.length > 60 ? "…" : ""}" → ${
      translation.course_title
    } (suggested, ${translation.credit_hours.toFixed(2)} credits)`,
  };
}

async function toolApproveCourse(
  supabase: Supa,
  studentId: string,
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const courseId = String(input.course_id ?? "");
  if (!courseId || !(await courseBelongsToStudent(supabase, courseId, studentId))) {
    return { data: { error: "Course not found for this student" }, summary: "Couldn't find that course." };
  }
  const patch: Record<string, unknown> = {};
  if (typeof input.course_title === "string") patch.course_title = input.course_title;
  if (typeof input.subject_area === "string") patch.subject_area = input.subject_area;
  if (typeof input.credit_hours === "number") patch.credit_hours = input.credit_hours;
  patch.status = Object.keys(patch).length > 0 ? "edited" : "approved";

  const { data } = await supabase.from("translated_courses").update(patch).eq("id", courseId).select().single();
  if (!data) return { data: { error: "Update failed" }, summary: "Couldn't approve that course." };
  return {
    data,
    summary: `Approved: ${data.course_title} (${Number(data.credit_hours).toFixed(2)} credits)`,
  };
}

async function toolRejectCourse(
  supabase: Supa,
  studentId: string,
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const courseId = String(input.course_id ?? "");
  if (!courseId || !(await courseBelongsToStudent(supabase, courseId, studentId))) {
    return { data: { error: "Course not found for this student" }, summary: "Couldn't find that course." };
  }
  const { data } = await supabase
    .from("translated_courses")
    .update({ status: "rejected" })
    .eq("id", courseId)
    .select()
    .single();
  if (!data) return { data: { error: "Update failed" }, summary: "Couldn't reject that course." };
  return { data, summary: `Rejected: ${data.course_title}` };
}

async function toolUpdateStudentProfile(
  supabase: Supa,
  studentId: string,
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const patch: Record<string, unknown> = {};
  for (const key of ["name", "grade_level", "state", "birth_date", "expected_graduation_year"]) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (Object.keys(patch).length === 0) {
    return { data: { error: "No fields provided" }, summary: "No profile fields to update." };
  }
  const { data } = await supabase.from("students").update(patch).eq("id", studentId).select().single();
  if (!data) return { data: { error: "Update failed" }, summary: "Couldn't update the profile." };
  return { data, summary: `Updated ${data.name}'s profile.` };
}

async function toolSaveDiscoveryNotes(
  supabase: Supa,
  studentId: string,
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const content = String(input.content ?? "");
  const { data: existing } = await supabase.from("profile_notes").select("id").eq("student_id", studentId).maybeSingle();
  const { data } = existing
    ? await supabase
        .from("profile_notes")
        .update({ content, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select()
        .single()
    : await supabase.from("profile_notes").insert({ student_id: studentId, content }).select().single();
  if (!data) return { data: { error: "Save failed" }, summary: "Couldn't save discovery notes." };
  return { data, summary: "Saved discovery notes." };
}

async function toolSuggestTracksFromNotes(
  supabase: Supa,
  studentId: string,
  gradeLevel: string | null
): Promise<ToolExecutionResult> {
  const { data: note } = await supabase.from("profile_notes").select("*").eq("student_id", studentId).maybeSingle();
  const content = note?.content ?? "";
  if (!content.trim()) {
    return { data: { tracks: [] }, summary: "No discovery notes yet to suggest tracks from." };
  }
  const tracks = await suggestTracks(content, gradeLevel);
  const merged = [...(note?.ai_suggested_tracks ?? []), ...tracks];
  if (note) {
    await supabase.from("profile_notes").update({ ai_suggested_tracks: merged }).eq("id", note.id);
  } else {
    await supabase.from("profile_notes").insert({ student_id: studentId, content: "", ai_suggested_tracks: merged });
  }
  return {
    data: { tracks },
    summary: tracks.length
      ? `Suggested ${tracks.length} track(s): ${tracks.map((t) => t.subject).join(", ")}`
      : "No new tracks suggested.",
  };
}

async function toolUpdateTrackStatus(
  supabase: Supa,
  studentId: string,
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const trackIndex = Number(input.track_index);
  const status = input.status === "accepted" || input.status === "dismissed" ? input.status : null;
  const { data: note } = await supabase.from("profile_notes").select("*").eq("student_id", studentId).maybeSingle();
  const tracks = note?.ai_suggested_tracks ?? [];
  if (!note || !status || !tracks[trackIndex]) {
    return { data: { error: "Track not found" }, summary: "Couldn't find that track." };
  }
  const subject = tracks[trackIndex].subject;
  const updated = tracks.map((t: { status: string }, i: number) => (i === trackIndex ? { ...t, status } : t));
  await supabase.from("profile_notes").update({ ai_suggested_tracks: updated }).eq("id", note.id);
  return { data: { track_index: trackIndex, status }, summary: `Marked "${subject}" as ${status}.` };
}

async function toolGenerateTranscript(supabase: Supa, studentId: string): Promise<ToolExecutionResult> {
  const { data: logs } = await supabase.from("learning_logs").select("id").eq("student_id", studentId);
  const logIds = (logs || []).map((l: { id: string }) => l.id);

  const { data: courses } = logIds.length
    ? await supabase
        .from("translated_courses")
        .select("*")
        .in("learning_log_id", logIds)
        .in("status", ["approved", "edited"])
    : { data: [] };

  if (!courses || courses.length === 0) {
    return { data: { error: "No approved courses yet" }, summary: "No approved courses yet — approve some first." };
  }

  const { data: transcript } = await supabase
    .from("transcripts")
    .insert({ student_id: studentId, included_course_ids: courses.map((c: { id: string }) => c.id) })
    .select()
    .single();

  const totalCreditHours =
    Math.round(courses.reduce((sum: number, c: { credit_hours: number }) => sum + c.credit_hours, 0) * 100) / 100;

  return {
    data: {
      transcript_id: transcript.id,
      share_path: `/share/${transcript.id}`,
      total_credit_hours: totalCreditHours,
      course_count: courses.length,
    },
    summary: `Generated a transcript with ${courses.length} course(s), ${totalCreditHours.toFixed(
      2
    )} total credits. Share link: /share/${transcript.id}`,
  };
}

export async function executeAssistantTool(
  supabase: Supa,
  studentId: string,
  gradeLevel: string | null,
  name: string,
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  switch (name) {
    case "create_learning_log":
      return toolCreateLearningLog(supabase, studentId, gradeLevel, input);
    case "approve_course":
      return toolApproveCourse(supabase, studentId, input);
    case "reject_course":
      return toolRejectCourse(supabase, studentId, input);
    case "update_student_profile":
      return toolUpdateStudentProfile(supabase, studentId, input);
    case "save_discovery_notes":
      return toolSaveDiscoveryNotes(supabase, studentId, input);
    case "suggest_tracks_from_notes":
      return toolSuggestTracksFromNotes(supabase, studentId, gradeLevel);
    case "update_track_status":
      return toolUpdateTrackStatus(supabase, studentId, input);
    case "generate_transcript":
      return toolGenerateTranscript(supabase, studentId);
    default:
      return { data: { error: `Unknown tool: ${name}` }, summary: `Unknown action: ${name}` };
  }
}
