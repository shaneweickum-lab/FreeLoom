import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { buildMessageNotificationEmail } from "@/lib/email/messageNotification";
import { APP_URL } from "@/lib/appUrl";

async function sendMessageEmail(to: string, title: string, excerpt: string, linkPath: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "FreeLoom <onboarding@resend.dev>",
      to,
      subject: title,
      html: buildMessageNotificationEmail({ title, excerpt, appUrl: `${APP_URL}${linkPath}` }),
    });
  } catch (err) {
    console.error("Failed to send message notification email:", err);
  }
}

export async function POST(req: NextRequest) {
  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const threadId = typeof body?.threadId === "string" ? body.threadId : "";
  const messageBody = typeof body?.body === "string" ? body.body.trim() : "";
  if (!threadId) {
    return NextResponse.json({ error: "Missing threadId." }, { status: 400 });
  }
  if (!messageBody) {
    return NextResponse.json({ error: "Message can't be empty." }, { status: 400 });
  }

  // The thread row is the one source of truth for who it belongs to -- RLS
  // already means a parent can't even see a thread that isn't theirs, but
  // this is checked explicitly too rather than trusting any client input.
  const { data: thread, error: threadError } = await supabase
    .from("support_threads")
    .select("id, parent_user_id")
    .eq("id", threadId)
    .maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }
  if (!isAdmin && thread.parent_user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const senderRole = isAdmin ? "admin" : "parent";
  const parentUserId = thread.parent_user_id;

  const { error: insertError } = await supabase.from("support_messages").insert({
    thread_id: threadId,
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
    // Look up the parent's own notification preferences before notifying
    // them -- a missing row (shouldn't normally happen for a parent, but
    // treat it the same as everywhere else in this feature) falls back to
    // "not muted, no email on file."
    const { data: recipientProfile } = await supabase
      .from("school_profiles")
      .select("email, email_notify_messages, mute_in_app_messages")
      .eq("user_id", parentUserId)
      .maybeSingle();

    const linkPath = `/messages?thread=${threadId}`;
    const notificationTitle = "New message from FreeLoom support";
    const excerpt = messageBody.slice(0, 140);

    // Admin replying -- admin-initiated, satisfies the notifications RLS
    // policy directly through the normal session client.
    const { error: notifyError } = recipientProfile?.mute_in_app_messages
      ? { error: null }
      : await supabase.from("notifications").insert({
          user_id: parentUserId,
          type: "message",
          title: notificationTitle,
          body: excerpt,
          link_path: linkPath,
          related_id: threadId,
        });

    if (recipientProfile?.email && (recipientProfile.email_notify_messages ?? true)) {
      await sendMessageEmail(recipientProfile.email, notificationTitle, excerpt, linkPath);
    }
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
      // Identify the sender by the name they set in their profile, not their
      // email -- falls back to email, then a generic label, if they haven't
      // set one. Link straight to their per-account admin page and the
      // specific thread -- no lookup step needed since parentUserId (== the
      // sender here) is already known.
      const { data: senderProfile } = await supabase
        .from("school_profiles")
        .select("parent_name")
        .eq("user_id", user.id)
        .maybeSingle();
      const senderLabel = senderProfile?.parent_name || user.email || "";
      const rows = admins.map((a) => ({
        user_id: a.user_id,
        type: "message" as const,
        title: senderLabel ? `New message from ${senderLabel}` : "New message from a parent",
        body: messageBody.slice(0, 140),
        link_path: `/admin/users/${parentUserId}?thread=${threadId}`,
        related_id: threadId,
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
  const threadId = typeof body?.threadId === "string" ? body.threadId : "";
  if (!threadId) {
    return NextResponse.json({ error: "Missing threadId." }, { status: 400 });
  }

  const { data: thread, error: threadError } = await supabase
    .from("support_threads")
    .select("id, parent_user_id")
    .eq("id", threadId)
    .maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }
  if (!isAdmin && thread.parent_user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  // A parent marks the admin team's messages read; an admin marks that
  // parent's own messages read.
  const counterpartRole = isAdmin ? "parent" : "admin";
  const { error } = await supabase
    .from("support_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("sender_role", counterpartRole)
    .is("read_at", null);

  if (error) {
    console.error("mark messages read error:", error);
    return NextResponse.json({ error: "Couldn't update messages." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
