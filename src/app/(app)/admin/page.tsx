import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminUsersPanel from "@/components/AdminUsersPanel";
import AnnouncementComposer from "@/components/AnnouncementComposer";
import FamiliesList, { type FamilyRow } from "@/components/FamiliesList";
import Tabs from "@/components/Tabs";
import UsageDashboard from "@/components/UsageDashboard";
import type { SchoolingType } from "@/lib/types";

// Supabase's free-tier caps -- bump these once the project's plan changes
// (e.g. Pro's 8GB base compute allowance and its autoscaling disk, or a
// larger storage add-on). Kept as env vars rather than hardcoded so a plan
// upgrade doesn't need a code change.
const GB = 1024 ** 3;
const DB_LIMIT_BYTES = Number(process.env.SUPABASE_DB_LIMIT_GB ?? 0.5) * GB;
const STORAGE_LIMIT_BYTES = Number(process.env.SUPABASE_STORAGE_LIMIT_GB ?? 1) * GB;

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

  const [{ data: signups, error: signupsError }, { data: admins }, { data: profiles }, usageResult] = await Promise.all([
    supabase.from("waitlist_signups").select("id, email, created_at").order("created_at", { ascending: false }),
    supabase.from("admin_users").select("user_id, email, approved_by, created_at").order("created_at", { ascending: true }),
    supabase.from("school_profiles").select("user_id, parent_name, schooling_type"),
    supabase.rpc("admin_db_usage"),
  ]);

  const usage = usageResult.data as
    | { db_size_bytes: number; storage_size_bytes: number; computed_at: string }
    | null;
  const usageError = usageResult.error?.message ?? null;

  // Enumerating every account is the one thing only the service-role Auth
  // admin API can do -- everything else here (school_profiles) goes
  // through the normal RLS-scoped session client via the new
  // school_profiles_admin_select policy.
  const adminClient = createAdminClient();
  const { data: usersPage } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  const profileByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  const families: FamilyRow[] = (usersPage?.users ?? [])
    .map((u) => ({
      userId: u.id,
      email: u.email ?? "",
      parentName: profileByUserId.get(u.id)?.parent_name ?? null,
      schoolingType: (profileByUserId.get(u.id)?.schooling_type ?? null) as SchoolingType | null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl font-bold">Admin</h1>
        <p className="text-muted text-sm mt-1">Manage the waitlist, admins, families, and announcements.</p>
      </div>

      <Tabs
        tabs={[
          {
            id: "waitlist",
            label: "Waitlist",
            badge: signups?.length ?? 0,
            content: (
              <div className="flex flex-col gap-4">
                <p className="text-muted text-sm">
                  {signupsError
                    ? "Couldn't load the waitlist."
                    : `${signups?.length ?? 0} ${signups?.length === 1 ? "person" : "people"} signed up so far.`}
                </p>

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
            ),
          },
          {
            id: "admins",
            label: "Admins",
            badge: admins?.length ?? 0,
            content: (
              <div className="flex flex-col gap-2">
                <p className="text-muted text-sm">Anyone approved here can see the waitlist and manage other admins.</p>
                <AdminUsersPanel admins={admins ?? []} currentUserId={user.id} />
              </div>
            ),
          },
          {
            id: "families",
            label: "Families",
            badge: families.length,
            content: (
              <div className="flex flex-col gap-2">
                <p className="text-muted text-sm">
                  Click a family to message them, request read-only access, or send them a personal announcement.
                </p>
                <FamiliesList families={families} />
              </div>
            ),
          },
          {
            id: "announcements",
            label: "Announcements",
            content: (
              <div className="flex flex-col gap-2">
                <p className="text-muted text-sm">Send to everyone, or just families of a specific schooling type.</p>
                <AnnouncementComposer />
              </div>
            ),
          },
          {
            id: "usage",
            label: "Usage",
            content: (
              <UsageDashboard
                error={usageError ?? undefined}
                dbSizeBytes={usage?.db_size_bytes ?? 0}
                storageSizeBytes={usage?.storage_size_bytes ?? 0}
                dbLimitBytes={DB_LIMIT_BYTES}
                storageLimitBytes={STORAGE_LIMIT_BYTES}
                computedAt={usage?.computed_at ?? null}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
