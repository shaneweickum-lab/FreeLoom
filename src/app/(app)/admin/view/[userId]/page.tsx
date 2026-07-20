import { createClient } from "@/lib/supabase/server";
import AdminAccountView, { type AdminAccountSnapshot } from "@/components/AdminAccountView";
import LiveAccessGate from "@/components/LiveAccessGate";

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

  // The RPC above already required a live approved+unexpired row to have
  // succeeded at all -- this just fetches that same row's id/expiry so
  // LiveAccessGate can subscribe to it and close this page out immediately
  // (no refresh) the moment it's revoked or runs out.
  const { data: activeRequest } = await supabase
    .from("account_access_requests")
    .select("id, expires_at")
    .eq("target_user_id", userId)
    .eq("requested_by", user.id)
    .eq("status", "approved")
    .gt("expires_at", new Date().toISOString())
    .order("responded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const snapshot = data as AdminAccountSnapshot;

  const content = (
    <>
      <div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet/40 bg-violet/10 px-3 py-1 text-xs font-medium text-violet-soft font-mono">
          Viewing — read only
        </span>
        <h1 className="font-serif text-2xl font-bold mt-2">{snapshot.school_profile?.parent_name ?? "This account"}</h1>
        <p className="text-muted text-sm mt-1">
          Everything below mirrors exactly what this family sees on their own account — every field is disabled, nothing
          here can be edited.
        </p>
      </div>

      <AdminAccountView snapshot={snapshot} />
    </>
  );

  if (!activeRequest) {
    return <div className="flex flex-col gap-6">{content}</div>;
  }

  return (
    <LiveAccessGate requestId={activeRequest.id} initialExpiresAt={activeRequest.expires_at}>
      {content}
    </LiveAccessGate>
  );
}
