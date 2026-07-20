import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AdminUsersPanel from "@/components/AdminUsersPanel";
import AdminMessagesPanel from "@/components/AdminMessagesPanel";
import AnnouncementComposer from "@/components/AnnouncementComposer";
import AccessRequestForm from "@/components/AccessRequestForm";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <p className="text-sm text-muted">Not authorized.</p>;
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
    return <p className="text-sm text-muted">Not authorized.</p>;
  }

  const [{ data: signups, error: signupsError }, { data: admins }, { data: myAccessRequests }] = await Promise.all([
    supabase.from("waitlist_signups").select("id, email, created_at").order("created_at", { ascending: false }),
    supabase.from("admin_users").select("user_id, email, approved_by, created_at").order("created_at", { ascending: true }),
    supabase
      .from("account_access_requests")
      .select("id, target_user_id, status, reason, requested_at, expires_at")
      .eq("requested_by", user.id)
      .order("requested_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <div className="flex flex-col gap-10">
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

      <div className="flex flex-col gap-2">
        <div>
          <h2 className="font-serif text-xl font-bold">Messages</h2>
          <p className="text-muted text-sm mt-1">Look up a parent by email to open their support thread.</p>
        </div>
        <AdminMessagesPanel />
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <h2 className="font-serif text-xl font-bold">Announcements</h2>
          <p className="text-muted text-sm mt-1">Posts here go into every account&apos;s notification dropdown.</p>
        </div>
        <AnnouncementComposer />
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <h2 className="font-serif text-xl font-bold">Request account access</h2>
          <p className="text-muted text-sm mt-1">
            Ask a parent to approve a read-only, 1-hour look at their account to help with an issue.
          </p>
        </div>
        <AccessRequestForm />

        {myAccessRequests && myAccessRequests.length > 0 && (
          <div className="flex flex-col gap-2 mt-2">
            <span className="text-xs font-mono uppercase tracking-wide text-muted">Your requests</span>
            {myAccessRequests.map((r) => {
              const isActive = r.status === "approved" && r.expires_at && new Date(r.expires_at) > new Date();
              return (
                <div
                  key={r.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-md border border-navy-line p-3 text-sm"
                >
                  <div>
                    <span className="font-mono text-xs text-muted">{r.target_user_id}</span>
                    <p className="text-xs text-muted">{r.reason}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted capitalize">{r.status}</span>
                    {isActive && (
                      <Link href={`/admin/view/${r.target_user_id}`} className="text-xs text-gold hover:underline">
                        View account
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
