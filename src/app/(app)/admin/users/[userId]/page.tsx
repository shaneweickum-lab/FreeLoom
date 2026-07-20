import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import MessageThread from "@/components/MessageThread";
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
  const [{ data: targetUserData }, { data: profile }, { data: existingRequest }] = await Promise.all([
    adminClient.auth.admin.getUserById(userId),
    supabase.from("school_profiles").select("parent_name, schooling_type").eq("user_id", userId).maybeSingle(),
    supabase
      .from("account_access_requests")
      .select("id, status, expires_at, requested_at")
      .eq("requested_by", user.id)
      .eq("target_user_id", userId)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const targetEmail = targetUserData?.user?.email ?? "Unknown account";
  const schoolingLabel = profile?.schooling_type ? SCHOOLING_TYPE_LABEL[profile.schooling_type] : null;

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
        <AccessRequestPanel targetUserId={userId} initialRequest={existingRequest ?? null} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-serif text-xl font-bold">Messages</h2>
        <MessageThread parentUserId={userId} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-serif text-xl font-bold">Send a personal announcement</h2>
        <UserAnnouncementForm targetUserId={userId} targetLabel={profile?.parent_name || targetEmail} />
      </div>
    </div>
  );
}
