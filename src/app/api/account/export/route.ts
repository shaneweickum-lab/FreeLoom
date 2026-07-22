import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Self-serve "download my data" -- fulfills the promise made in
 * /privacy. Uses the normal session-scoped client (not the admin client),
 * so RLS is a second real backstop on top of the explicit user_id/
 * student_id filters below: even if a filter here were ever wrong, RLS
 * still can't return another account's rows through this route.
 *
 * Deliberately excludes retrieval_cases/human_resolutions -- those are
 * internal ML-pipeline artifacts about how an entry was classified, not
 * content the parent authored, so they don't belong in a personal-data
 * export. Deliberately excludes composition_rules/fragments -- shared
 * platform reference data, not scoped to any account at all. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const [{ data: profile }, { data: students }, { data: notifications }, { data: accessRequests }] =
    await Promise.all([
      supabase.from("school_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("students").select("*").eq("user_id", user.id),
      supabase.from("notifications").select("*").eq("user_id", user.id),
      supabase.from("account_access_requests").select("*").eq("target_user_id", user.id),
    ]);

  const studentIds = (students ?? []).map((s) => s.id);
  const [{ data: classes }, { data: entries }, { data: tags }, { data: notes }, { data: transcripts }] =
    studentIds.length > 0
      ? await Promise.all([
          supabase.from("classes").select("*").in("student_id", studentIds),
          supabase.from("entries").select("*").in("student_id", studentIds),
          supabase.from("entry_subject_tags").select("*").in("student_id", studentIds),
          supabase.from("profile_notes").select("*").in("student_id", studentIds),
          supabase.from("transcripts").select("*").in("student_id", studentIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const [{ data: threads }, { data: conversations }] = await Promise.all([
    supabase.from("support_threads").select("*").eq("parent_user_id", user.id),
    supabase.from("benny_conversations").select("*").eq("user_id", user.id),
  ]);

  const threadIds = (threads ?? []).map((t) => t.id);
  const conversationIds = (conversations ?? []).map((c) => c.id);
  const [{ data: messages }, { data: bennyMessages }] = await Promise.all([
    threadIds.length > 0
      ? supabase.from("support_messages").select("*").in("thread_id", threadIds)
      : Promise.resolve({ data: [] }),
    conversationIds.length > 0
      ? supabase.from("benny_messages").select("*").in("conversation_id", conversationIds)
      : Promise.resolve({ data: [] }),
  ]);

  const exportData = {
    exported_at: new Date().toISOString(),
    account: profile ?? null,
    students: (students ?? []).map((s) => ({
      ...s,
      classes: (classes ?? []).filter((c) => c.student_id === s.id),
      entries: (entries ?? []).filter((e) => e.student_id === s.id),
      entry_subject_tags: (tags ?? []).filter((t) => t.student_id === s.id),
      profile_notes: (notes ?? []).filter((n) => n.student_id === s.id),
      transcripts: (transcripts ?? []).filter((t) => t.student_id === s.id),
    })),
    notifications: notifications ?? [],
    support_threads: (threads ?? []).map((t) => ({
      ...t,
      messages: (messages ?? []).filter((m) => m.thread_id === t.id),
    })),
    benny_conversations: (conversations ?? []).map((c) => ({
      ...c,
      messages: (bennyMessages ?? []).filter((m) => m.conversation_id === c.id),
    })),
    account_access_requests: accessRequests ?? [],
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="freeloom-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
