import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";

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

  const { data: announcement, error: insertError } = await supabase
    .from("announcements")
    .insert({ title, body: announcementBody, created_by: user.id })
    .select("id")
    .single();

  if (insertError || !announcement) {
    console.error("announcement insert error:", insertError);
    return NextResponse.json({ error: "Couldn't post that announcement. Please try again." }, { status: 500 });
  }

  // Fan out a notification to every existing account. Admin-initiated, so it
  // satisfies the notifications RLS policy directly through the session
  // client -- the service-role client here is only for enumerating every
  // user id, the one thing the session client genuinely can't do (same
  // reason it's used for the admin-approval email lookup).
  const adminClient = createAdminClient();
  const { data: usersPage, error: listError } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    console.error("user enumeration error for announcement fanout:", listError);
    // The announcement itself is already posted; notification fanout is
    // best-effort, same resilience pattern as the waitlist confirmation email.
    return NextResponse.json({ ok: true });
  }

  const rows = usersPage.users.map((u) => ({
    user_id: u.id,
    type: "announcement" as const,
    title,
    body: announcementBody.slice(0, 140),
    link_path: "/dashboard",
    related_id: announcement.id,
  }));

  if (rows.length > 0) {
    const { error: fanoutError } = await supabase.from("notifications").insert(rows);
    if (fanoutError) console.error("announcement notification fanout error:", fanoutError);
  }

  return NextResponse.json({ ok: true });
}
