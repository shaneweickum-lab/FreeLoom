import { createClient } from "@/lib/supabase/server";

// Kept in sync with the waitlist_signups_admin_select RLS policy -- the
// database enforces this too, this check just gives a clearer message than
// a silently-empty table for anyone else who's logged in.
const ADMIN_EMAIL = "shane@sowedandrooted.com";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email !== ADMIN_EMAIL) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
        <p className="text-sm text-muted">Not authorized.</p>
      </div>
    );
  }

  const { data: signups, error } = await supabase
    .from("waitlist_signups")
    .select("id, email, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen bg-background text-foreground px-4 sm:px-8 py-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <div>
          <h1 className="font-serif text-2xl font-bold">Waitlist</h1>
          <p className="text-muted text-sm mt-1">
            {error
              ? "Couldn't load the waitlist."
              : `${signups?.length ?? 0} ${signups?.length === 1 ? "person" : "people"} signed up so far.`}
          </p>
        </div>

        {!error && signups && signups.length > 0 && (
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

        {!error && signups && signups.length === 0 && (
          <p className="text-sm text-muted">Nobody yet — the waitlist button just shipped.</p>
        )}
      </div>
    </div>
  );
}
