import { createClient } from "@/lib/supabase/server";

type AdminViewSnapshot = {
  students: { id: string; name: string; grade_level: string | null }[];
  classes: { id: string; student_id: string; subject_area: string; title: string }[];
  entries: {
    id: string;
    student_id: string;
    raw_word_dump: string;
    final_description: string | null;
    final_reasoning: string | null;
    credit_value: number;
    status: string;
  }[];
  entry_subject_tags: {
    id: string;
    entry_id: string;
    subject_area: string;
    confidence: string;
  }[];
  profile_notes: { id: string; student_id: string; content: string }[];
  school_profile: { school_name: string | null; parent_name: string | null } | null;
};

export default async function AdminViewAccountPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <p className="text-sm text-muted">Not authorized.</p>;
  }

  const { data: callerAdminRow } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!callerAdminRow) {
    return <p className="text-sm text-muted">Not authorized.</p>;
  }

  // admin_view_account() itself re-checks is_admin() and a live, unexpired
  // approval before returning anything -- this route never bypasses that
  // via a service-role client, so a stale/expired approval fails closed here
  // exactly the same way it would for any other caller.
  const { data, error } = await supabase.rpc("admin_view_account", { p_target_user_id: userId });

  if (error || !data) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-bold">Viewing — read only</h1>
        <p className="text-sm text-muted">
          No active approved access for this account. Request access from the Admins page and wait for the parent to
          approve — access expires automatically an hour after approval.
        </p>
      </div>
    );
  }

  const snapshot = data as AdminViewSnapshot;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet/40 bg-violet/10 px-3 py-1 text-xs font-medium text-violet-soft font-mono">
          Viewing — read only
        </span>
        <h1 className="font-serif text-2xl font-bold mt-2">
          {snapshot.school_profile?.parent_name ?? "This account"}
        </h1>
      </div>

      {snapshot.students.length === 0 && <p className="text-sm text-muted">No students on this account yet.</p>}

      {snapshot.students.map((student) => {
        const studentClasses = snapshot.classes.filter((c) => c.student_id === student.id);
        const studentEntries = snapshot.entries.filter((e) => e.student_id === student.id);
        const studentNotes = snapshot.profile_notes.filter((n) => n.student_id === student.id);

        return (
          <div key={student.id} className="flex flex-col gap-4 rounded-lg border border-navy-line p-4">
            <h2 className="font-serif text-xl font-bold">
              {student.name}
              {student.grade_level && <span className="text-muted text-sm font-normal"> — {student.grade_level}</span>}
            </h2>

            {studentClasses.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-mono uppercase tracking-wide text-muted">Classes</span>
                {studentClasses.map((c) => (
                  <p key={c.id} className="text-sm">
                    <span className="font-medium">{c.title}</span>
                    <span className="text-muted"> — {c.subject_area}</span>
                  </p>
                ))}
              </div>
            )}

            {studentEntries.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-mono uppercase tracking-wide text-muted">Entries</span>
                {studentEntries.map((e) => {
                  const tags = snapshot.entry_subject_tags.filter((t) => t.entry_id === e.id);
                  return (
                    <div key={e.id} className="rounded-md border border-navy-line p-3 flex flex-col gap-1">
                      <p className="text-sm italic text-muted">{e.raw_word_dump}</p>
                      {e.final_description && <p className="text-sm font-medium">{e.final_description}</p>}
                      {e.final_reasoning && <p className="text-xs text-muted">{e.final_reasoning}</p>}
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {tags.map((t) => (
                            <span key={t.id} className="text-xs rounded-full bg-gold/15 text-gold px-2 py-0.5">
                              {t.subject_area} ({t.confidence})
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {studentNotes.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-mono uppercase tracking-wide text-muted">Profile notes</span>
                {studentNotes.map((n) => (
                  <p key={n.id} className="text-sm text-muted">
                    {n.content}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
