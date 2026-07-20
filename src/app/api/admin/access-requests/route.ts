import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user || !isAdmin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "Enter an email address." }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "Describe why you need access." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: usersPage, error: listError } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    console.error("admin lookup error:", listError);
    return NextResponse.json({ error: "Couldn't look up that account. Please try again." }, { status: 500 });
  }

  const target = usersPage.users.find((u) => u.email?.toLowerCase() === email);
  if (!target) {
    return NextResponse.json({ error: "No account found with that email." }, { status: 404 });
  }
  if (target.id === user.id) {
    return NextResponse.json({ error: "You can't request access to your own account." }, { status: 400 });
  }

  const { data: accessRequest, error: insertError } = await supabase
    .from("account_access_requests")
    .insert({ target_user_id: target.id, requested_by: user.id, reason })
    .select("id")
    .single();

  if (insertError || !accessRequest) {
    console.error("access request insert error:", insertError);
    return NextResponse.json({ error: "Couldn't create that request. Please try again." }, { status: 500 });
  }

  const { error: notifyError } = await supabase.from("notifications").insert({
    user_id: target.id,
    type: "access_request",
    title: "An admin is requesting access to help with an issue",
    body: reason,
    link_path: "/dashboard",
    related_id: accessRequest.id,
  });
  if (notifyError) console.error("notification insert error:", notifyError);

  return NextResponse.json({ ok: true });
}
