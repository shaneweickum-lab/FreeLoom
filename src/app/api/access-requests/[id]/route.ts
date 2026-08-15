import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveHouseholdOwnerId } from "@/lib/household";
import { getEffectiveTier } from "@/lib/billing/tier";

const ACTION_TO_STATUS = {
  approve: "approved",
  deny: "denied",
  revoke: "revoked",
} as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";
  const newStatus = ACTION_TO_STATUS[action as keyof typeof ACTION_TO_STATUS];
  if (!newStatus) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  // Belt-and-suspenders against a stale pending row from before this
  // account downgraded to Free -- RLS's access_requests_target_update only
  // lets the target parent themselves call "approve", so the caller here
  // IS the target when this action is "approve"; deny/revoke stay allowed
  // regardless of tier (a parent can always say no / close it out).
  if (action === "approve") {
    // Resolved to the household's owner id -- an accepted guardian has no
    // school_profiles row of their own, so checking tier by their own
    // literal id would always read "free" regardless of the household's
    // real plan (see resolveHouseholdOwnerId()'s own doc comment).
    const ownerId = await resolveHouseholdOwnerId(supabase, user.id);
    const [{ data: callerProfile }, { data: callerAdminRow }] = await Promise.all([
      ownerId
        ? supabase
            .from("school_profiles")
            .select("subscription_tier, subscription_status, grandfathered_until, current_period_end")
            .eq("user_id", ownerId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle(),
    ]);
    const callerTier = getEffectiveTier({
      subscription_tier: callerProfile?.subscription_tier ?? "free",
      subscription_status: callerProfile?.subscription_status ?? null,
      grandfathered_until: callerProfile?.grandfathered_until ?? null,
      current_period_end: callerProfile?.current_period_end ?? null,
      isAdmin: !!callerAdminRow,
    });
    if (callerTier === "free") {
      return NextResponse.json(
        { error: "Your account is on the Free plan and can't approve admin access." },
        { status: 400 }
      );
    }
  }

  // Real enforcement is RLS -- the target parent can approve/deny/revoke
  // their own row (access_requests_target_update), and separately the
  // requesting admin can revoke (only revoke -- never approve/deny) their
  // own already-approved row (access_requests_admin_revoke). Neither policy
  // lets an admin self-approve. The enforce_access_request_transition
  // trigger rejects any transition other than pending->approved/denied or
  // approved->revoked regardless of who's calling, and computes expires_at
  // server-side. No `.eq("target_user_id", ...)` filter here on purpose --
  // that would block the admin-revoke path; RLS is what actually decides
  // who's allowed to touch this row.
  const { data, error } = await supabase
    .from("account_access_requests")
    .update({ status: newStatus })
    .eq("id", id)
    .select("id, requested_by, target_user_id")
    .maybeSingle();

  if (error) {
    console.error("access request update error:", error);
    return NextResponse.json({ error: "Couldn't update that request. It may already be resolved." }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const { error: notifyError } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("related_id", id)
    .eq("type", "access_request");
  if (notifyError) console.error("notification mark-read error:", notifyError);

  // The admin closing out their own access early is a distinct, purely
  // informational event -- type "announcement" rather than
  // "access_request" on purpose, so it behaves like any other one-way
  // notice (clears via "mark all read", no pending action attached) instead
  // of being treated as a still-actionable approval request.
  if (newStatus === "revoked" && data.requested_by === user.id) {
    const { error: closeNotifyError } = await supabase.from("notifications").insert({
      user_id: data.target_user_id,
      type: "announcement",
      title: "Admin closed out profile access",
      body: "The admin ended their read-only access to your account early.",
      link_path: "/dashboard",
    });
    if (closeNotifyError) console.error("close-access notification error:", closeNotifyError);
  }

  return NextResponse.json({ ok: true });
}
