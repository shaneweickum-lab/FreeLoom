import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { stripMarkdown } from "@/lib/markdown";

const SCHOOLING_TYPES = ["homeschooling", "unschooling", "wildschooling"];
const TARGET_TYPES = ["everyone", "user", "schooling_type"];

export async function POST(req: NextRequest) {
  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user || !isAdmin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const announcementBody = typeof body?.body === "string" ? body.body.trim() : "";
  if (!title || !announcementBody) {
    return NextResponse.json({ error: "Title and body are required." }, { status: 400 });
  }

  const targetType = typeof body?.targetType === "string" ? body.targetType : "everyone";
  const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId : null;
  const targetSchoolingType = typeof body?.targetSchoolingType === "string" ? body.targetSchoolingType : null;

  if (!TARGET_TYPES.includes(targetType)) {
    return NextResponse.json({ error: "Invalid audience." }, { status: 400 });
  }
  if (targetType === "user" && !targetUserId) {
    return NextResponse.json({ error: "Missing target account." }, { status: 400 });
  }
  if (targetType === "schooling_type" && !SCHOOLING_TYPES.includes(targetSchoolingType ?? "")) {
    return NextResponse.json({ error: "Missing or invalid schooling type." }, { status: 400 });
  }

  const { data: announcement, error: insertError } = await supabase
    .from("announcements")
    .insert({
      title,
      body: announcementBody,
      created_by: user.id,
      target_type: targetType,
      target_user_id: targetType === "user" ? targetUserId : null,
      target_schooling_type: targetType === "schooling_type" ? targetSchoolingType : null,
    })
    .select("id")
    .single();

  if (insertError || !announcement) {
    console.error("announcement insert error:", insertError);
    return NextResponse.json({ error: "Couldn't post that announcement. Please try again." }, { status: 500 });
  }

  let recipientIds: string[] = [];
  if (targetType === "user") {
    recipientIds = [targetUserId as string];
  } else if (targetType === "schooling_type") {
    // Admin-initiated read of every account's schooling_type -- satisfies
    // the school_profiles_admin_select RLS policy directly, no service
    // role needed here.
    const { data: profiles, error: profilesError } = await supabase
      .from("school_profiles")
      .select("user_id")
      .eq("schooling_type", targetSchoolingType);
    if (profilesError) {
      console.error("schooling_type lookup error for announcement fanout:", profilesError);
    } else {
      recipientIds = (profiles ?? []).map((p) => p.user_id);
    }
  } else {
    // Everyone -- enumerating every account is the one thing only the
    // service-role Auth admin API can do.
    const adminClient = createAdminClient();
    const { data: usersPage, error: listError } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    if (listError) {
      console.error("user enumeration error for announcement fanout:", listError);
    } else {
      recipientIds = usersPage.users.map((u) => u.id);
    }
  }

  if (recipientIds.length > 0) {
    // The announcement itself is already posted; notification fanout is
    // best-effort, same resilience pattern as the waitlist confirmation email.
    const rows = recipientIds.map((id) => ({
      user_id: id,
      type: "announcement" as const,
      title,
      body: stripMarkdown(announcementBody).slice(0, 140),
      link_path: "/dashboard",
      related_id: announcement.id,
    }));
    const { error: fanoutError } = await supabase.from("notifications").insert(rows);
    if (fanoutError) console.error("announcement notification fanout error:", fanoutError);
  }

  return NextResponse.json({ ok: true });
}
