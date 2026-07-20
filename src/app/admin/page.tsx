import { createClient } from "@/lib/supabase/server";
import AdminUsersPanel from "@/components/AdminUsersPanel";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
        <p className="text-sm text-muted">Not authorized.</p>
      </div>
    );
  }

  // Whether this account can even read admin_users is itself the
  // authorization check -- the admin_users_admin_select RLS policy only
  // lets rows through for accounts that are already in the table.
  const { data: callerAdminRow } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!callerAdminRow) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
        <p className="text-sm text-muted">Not authorized.</p>
      </div>
    );
  }

  const [{ data: signups, error: signupsError }, { data: admins }] = await Promise.all([
    supabase.from("waitlist_signups").select("id, email, created_at").order("created_at", { ascending: false }),
    supabase.from("admin_users").select("user_id, email, approved_by, created_at").order("created_at", { ascending: true }),
  ]);

  return (
    <div className="min-h-screen bg-background text-foreground px-4 sm:px-8 py-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="font-serif text-2xl font-bold">Waitlist</h1>
            <p className="text-muted text-sm mt-1">
              {signupsError
                ? "Couldn't load the waitlist."
                : `${signups?.length ?? 0} ${signups?.length === 1 ? "person" : "people"} signed up so far.`}
            </p>
          </div>

          {!signupsError && signups && signups.length > 0 && (
            <div className="rounded-lg border border-navy-line overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-navy-soft text-muted text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Email</th>
                    <th className="text-left px-4 py-2 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {signups.map((s) => (
                    <tr key={s.id} className="border-t border-navy-line">
                      <td className="px-4 py-2 font-mono">{s.email}</td>
                      <td className="px-4 py-2 text-muted">{new Date(s.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!signupsError && signups && signups.length === 0 && (
            <p className="text-sm text-muted">Nobody yet — the waitlist button just shipped.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div>
            <h2 className="font-serif text-xl font-bold">Admins</h2>
            <p className="text-muted text-sm mt-1">Anyone approved here can see the waitlist and manage other admins.</p>
          </div>
          <AdminUsersPanel admins={admins ?? []} currentUserId={user.id} />
        </div>
      </div>
    </div>
  );
}
