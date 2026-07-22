import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectiveTier } from "@/lib/billing/tier";
import MessageThreads from "@/components/MessageThreads";
import UserAnnouncementForm from "@/components/UserAnnouncementForm";
import AccessRequestPanel from "@/components/AccessRequestPanel";

const SCHOOLING_TYPE_LABEL: Record<string, string> = {
  homeschooling: "Homeschooling",
  unschooling: "Unschooling",
  wildschooling: "Wildschooling",
};

export default async function AdminUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <p className="text-sm text-muted">Not authorized.</p>;

  const { data: callerAdminRow } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!callerAdminRow) return <p className="text-sm text-muted">Not authorized.</p>;

  const adminClient = createAdminClient();
  const [{ data: targetUserData }, { data: profile }, { data: existingRequests }, { data: targetAdminRow }] =
    await Promise.all([
      adminClient.auth.admin.getUserById(userId),
      supabase
        .from("school_profiles")
        .select(
          "parent_name, schooling_type, subscription_tier, subscription_status, grandfathered_until, current_period_end"
        )
        .eq("user_id", userId)
        .maybeSingle(),
      // Plural, and not filtered to this admin -- AccessRequestPanel narrows
      // to "mine" itself once it knows its own user id, and needs every
      // admin's requests visible in its realtime feed to stay accurate if
      // more than one admin is working this account.
      supabase
        .from("account_access_requests")
        .select("id, status, expires_at, requested_at, requested_by")
        .eq("target_user_id", userId)
        .order("requested_at", { ascending: false })
        .limit(10),
      // Is the *target* account itself an admin? Billing tiers never apply
      // to admins, so viewing another admin's account should never show
      // them as gated to Free.
      supabase.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle(),
    ]);

  const targetEmail = targetUserData?.user?.email ?? "Unknown account";
  const schoolingLabel = profile?.schooling_type ? SCHOOLING_TYPE_LABEL[profile.schooling_type] : null;
  const targetTier = getEffectiveTier({
    subscription_tier: profile?.subscription_tier ?? "free",
    subscription_status: profile?.subscription_status ?? null,
    grandfathered_until: profile?.grandfathered_until ?? null,
    current_period_end: profile?.current_period_end ?? null,
    isAdmin: !!targetAdminRow,
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/admin" className="text-xs text-muted hover:text-foreground">
          ← Back to admin
        </Link>
        <h1 className="font-serif text-2xl font-bold mt-2">{profile?.parent_name || targetEmail}</h1>
        <p className="text-muted text-sm mt-1 font-mono">{targetEmail}</p>
        {schoolingLabel && (
          <span className="inline-flex mt-2 items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold font-mono">
            {schoolingLabel}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-serif text-xl font-bold">Account access</h2>
        <AccessRequestPanel targetUserId={userId} initialRequests={existingRequests ?? []} targetIsFreeTier={targetTier === "free"} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-serif text-xl font-bold">Messages</h2>
        <Suspense fallback={null}>
          <MessageThreads parentUserId={userId} />
        </Suspense>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-serif text-xl font-bold">Send a personal announcement</h2>
        <UserAnnouncementForm targetUserId={userId} targetLabel={profile?.parent_name || targetEmail} />
      </div>
    </div>
  );
}
