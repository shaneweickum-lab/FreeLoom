import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const messageBody = typeof body?.body === "string" ? body.body.trim() : "";
  if (!messageBody) {
    return NextResponse.json({ error: "Message can't be empty." }, { status: 400 });
  }

  // A parent can only ever write into their own thread; only an admin can
  // target someone else's (client-supplied parentUserId is ignored otherwise).
  let parentUserId = user.id;
  if (isAdmin) {
    const requested = typeof body?.parentUserId === "string" ? body.parentUserId : "";
    if (!requested) {
      return NextResponse.json({ error: "Missing parentUserId." }, { status: 400 });
    }
    parentUserId = requested;
  }

  const senderRole = isAdmin ? "admin" : "parent";

  const { error: insertError } = await supabase.from("support_messages").insert({
    parent_user_id: parentUserId,
    sender_user_id: user.id,
    sender_role: senderRole,
    body: messageBody,
  });

  if (insertError) {
    console.error("support message insert error:", insertError);
    return NextResponse.json({ error: "Couldn't send that message. Please try again." }, { status: 500 });
  }

  if (senderRole === "admin") {
    // Admin replying -- admin-initiated, satisfies the notifications RLS
    // policy directly through the normal session client.
    const { error: notifyError } = await supabase.from("notifications").insert({
      user_id: parentUserId,
      type: "message",
      title: "New message from FreeLoom support",
      body: messageBody.slice(0, 140),
      link_path: "/messages",
    });
    if (notifyError) console.error("notification insert error:", notifyError);
  } else {
    // Parent messaging -- needs to notify every admin, but a non-admin
    // session client can't read admin_users or insert notifications (both
    // are admin-gated by RLS). Service-role is the one place that's allowed
    // to do this fan-out, mirroring src/lib/supabase/admin.ts's existing
    // narrow-escape-hatch convention -- used only for this, never for
    // reading or writing anything else on behalf of a non-admin caller.
    const adminClient = createAdminClient();
    const { data: admins, error: adminsError } = await adminClient.from("admin_users").select("user_id");
    if (adminsError) {
      console.error("admin roster lookup error:", adminsError);
    } else if (admins && admins.length > 0) {
      // Include the sender's email so the notification itself is
      // identifiable, and link straight to their per-account admin page --
      // no lookup step needed since parentUserId (== the sender here) is
      // already known.
      const senderEmail = user.email ?? "";
      const rows = admins.map((a) => ({
        user_id: a.user_id,
        type: "message" as const,
        title: senderEmail ? `New message from ${senderEmail}` : "New message from a parent",
        body: messageBody.slice(0, 140),
        link_path: `/admin/users/${parentUserId}`,
      }));
      const { error: fanoutError } = await adminClient.from("notifications").insert(rows);
      if (fanoutError) console.error("notification fanout error:", fanoutError);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  let parentUserId = user.id;
  if (isAdmin) {
    const requested = typeof body?.parentUserId === "string" ? body.parentUserId : "";
    if (!requested) {
      return NextResponse.json({ error: "Missing parentUserId." }, { status: 400 });
    }
    parentUserId = requested;
  }

  // A parent marks the admin team's messages read; an admin marks that
  // parent's own messages read.
  const counterpartRole = isAdmin ? "parent" : "admin";
  const { error } = await supabase
    .from("support_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("parent_user_id", parentUserId)
    .eq("sender_role", counterpartRole)
    .is("read_at", null);

  if (error) {
    console.error("mark messages read error:", error);
    return NextResponse.json({ error: "Couldn't update messages." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
