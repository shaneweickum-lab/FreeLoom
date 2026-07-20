import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user || !isAdmin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!targetUserId) {
    return NextResponse.json({ error: "Missing target account." }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "Describe why you need access." }, { status: 400 });
  }
  if (targetUserId === user.id) {
    return NextResponse.json({ error: "You can't request access to your own account." }, { status: 400 });
  }

  const { data: accessRequest, error: insertError } = await supabase
    .from("account_access_requests")
    .insert({ target_user_id: targetUserId, requested_by: user.id, reason })
    .select("id")
    .single();

  if (insertError || !accessRequest) {
    console.error("access request insert error:", insertError);
    return NextResponse.json({ error: "Couldn't create that request. Please try again." }, { status: 500 });
  }

  const { error: notifyError } = await supabase.from("notifications").insert({
    user_id: targetUserId,
    type: "access_request",
    title: "An admin is requesting access to help with an issue",
    body: reason,
    link_path: "/dashboard",
    related_id: accessRequest.id,
  });
  if (notifyError) console.error("notification insert error:", notifyError);

  return NextResponse.json({ ok: true });
}
