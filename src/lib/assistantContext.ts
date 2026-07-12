import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearningLog, SuggestedTrack, TranslatedCourse } from "@/lib/types";

export type AssistantContextSnapshot = {
  student: {
    id: string;
    name: string;
    grade_level: string | null;
    state: string | null;
    birth_date: string | null;
    expected_graduation_year: number | null;
  };
  discoveryNotes: string;
  suggestedTracks: SuggestedTrack[];
  logs: {
    id: string;
    date_logged: string;
    raw_description: string;
    course: Pick<TranslatedCourse, "id" | "course_title" | "subject_area" | "credit_hours" | "status"> | null;
  }[];
  approvedCreditHours: number;
};

export async function buildAssistantContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  studentId: string
): Promise<AssistantContextSnapshot> {
  const [{ data: student }, { data: note }, { data: logs }] = await Promise.all([
    supabase.from("students").select("*").eq("id", studentId).single(),
    supabase.from("profile_notes").select("*").eq("student_id", studentId).maybeSingle(),
    supabase
      .from("learning_logs")
      .select("*, translated_courses(*)")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const typedLogs = (logs || []) as (LearningLog & { translated_courses: TranslatedCourse[] })[];

  const approvedCreditHours = typedLogs
    .flatMap((l) => l.translated_courses || [])
    .filter((c) => c.status === "approved" || c.status === "edited")
    .reduce((sum, c) => sum + c.credit_hours, 0);

  return {
    student: {
      id: student.id,
      name: student.name,
      grade_level: student.grade_level,
      state: student.state,
      birth_date: student.birth_date,
      expected_graduation_year: student.expected_graduation_year,
    },
    discoveryNotes: note?.content ?? "",
    suggestedTracks: note?.ai_suggested_tracks ?? [],
    logs: typedLogs.map((l) => ({
      id: l.id,
      date_logged: l.date_logged,
      raw_description: l.raw_description,
      course: l.translated_courses?.[0]
        ? {
            id: l.translated_courses[0].id,
            course_title: l.translated_courses[0].course_title,
            subject_area: l.translated_courses[0].subject_area,
            credit_hours: l.translated_courses[0].credit_hours,
            status: l.translated_courses[0].status,
          }
        : null,
    })),
    approvedCreditHours: Math.round(approvedCreditHours * 100) / 100,
  };
}

export function buildAssistantSystemPrompt(snapshot: AssistantContextSnapshot): string {
  const { student, discoveryNotes, suggestedTracks, logs, approvedCreditHours } = snapshot;

  const logLines = logs.length
    ? logs
        .map((l) => {
          const c = l.course;
          return c
            ? `- [${l.date_logged}] "${l.raw_description}" → ${c.course_title} (${c.subject_area}, ${c.credit_hours.toFixed(
                2
              )} credits, status: ${c.status}, course_id: ${c.id})`
            : `- [${l.date_logged}] "${l.raw_description}" (not yet translated)`;
        })
        .join("\n")
    : "(no learning log entries yet)";

  const trackLines = suggestedTracks.length
    ? suggestedTracks
        .map((t, i) => `- [${i}] ${t.subject} (${t.status}): ${t.rationale}`)
        .join("\n")
    : "(no suggested tracks yet)";

  return `You are the in-app assistant for FreeLoom, a homeschool transcript builder. You are helping a parent manage ${student.name}'s learning documentation through conversation — answering questions, giving guidance, and taking real actions in the app on their behalf using the tools available to you.

Current student: ${student.name} (${student.grade_level || "grade level not set"}${
    student.state ? `, ${student.state}` : ""
  })
Cumulative approved credit hours: ${approvedCreditHours.toFixed(2)}

Discovery notes: ${discoveryNotes || "(none saved yet)"}

Suggested subject/skill tracks:
${trackLines}

Recent learning log entries (most recent first):
${logLines}

Guidelines:
1. You can both advise AND act. When the parent describes an activity, log it with create_learning_log rather than just telling them to do it themselves. When they ask you to approve, reject, edit, or fix something, use the matching tool.
2. Only act on ${student.name}'s data — you have no tools to affect other children on this account, and you cannot create or delete student profiles (that's done from the Dashboard).
3. You cannot upload photos or files — if the parent wants to attach a work sample, tell them to use the Portfolio Builder page for that.
4. Before an action with broad effect (rejecting several courses at once, generating a transcript when a lot looks unapproved), briefly confirm what you're about to do — otherwise just do it and report back.
5. Ground rationale and advice in what's actually in the context above — don't invent facts about the student's history that aren't shown here.
6. Keep replies conversational and concise. After taking actions, summarize what changed in plain language.`;
}
