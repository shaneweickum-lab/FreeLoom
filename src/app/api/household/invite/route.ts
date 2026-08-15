import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { isRateLimited } from "@/lib/rateLimit";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendInviteEmail(toEmail: string, inviterName: string | null) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromLabel = inviterName ?? "A FreeLoom family";
    await resend.emails.send({
      from: "FreeLoom <onboarding@resend.dev>",
      to: toEmail,
      subject: `${fromLabel} invited you to their FreeLoom household`,
      html: `<p>${fromLabel} has invited you as a second guardian on their FreeLoom household -- you'll get full access to log activities, review entries, and generate transcripts for their students.</p><p>Sign in (or create an account) with this email address at freeloom to accept.</p>`,
    });
  } catch (err) {
    // Best-effort -- the invite row itself is already saved, so this
    // failing shouldn't fail the whole request; the owner can always share
    // the invite verbally if the email never arrives.
    console.error("Failed to send household invite email:", err);
  }
}

/** Owner-only: creates (or re-activates a previously revoked) pending
 * household_members row for `email`, then best-effort emails them. An
 * accepted guardian can't invite further guardians in this first cut --
 * only the literal school_profiles owner can. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (isRateLimited(`household-invite:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many invites -- try again in a minute." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (email === user.email?.toLowerCase()) {
    return NextResponse.json({ error: "You can't invite yourself." }, { status: 400 });
  }

  const { data: ownProfile } = await supabase.from("school_profiles").select("parent_name").eq("user_id", user.id).maybeSingle();
  if (!ownProfile) {
    return NextResponse.json({ error: "Only the account owner can invite a guardian." }, { status: 403 });
  }

  const { data: existing } = await supabase
    .from("household_members")
    .select("id, status")
    .eq("owner_user_id", user.id)
    .eq("invited_email", email)
    .maybeSingle();
  if (existing?.status === "accepted") {
    return NextResponse.json({ error: "That person is already a guardian on this household." }, { status: 400 });
  }

  const { error } = await supabase.from("household_members").upsert(
    {
      owner_user_id: user.id,
      invited_email: email,
      status: "pending",
      invited_at: new Date().toISOString(),
      member_user_id: null,
      accepted_at: null,
    },
    { onConflict: "owner_user_id,invited_email" }
  );
  if (error) {
    console.error("Failed to save household invite:", error);
    return NextResponse.json({ error: "Couldn't send that invite -- try again." }, { status: 500 });
  }

  await sendInviteEmail(email, ownProfile.parent_name);

  return NextResponse.json({ ok: true });
}
