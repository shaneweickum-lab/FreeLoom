import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { WAITLIST_CONFIRMATION_HTML } from "@/lib/email/waitlistConfirmation";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("waitlist_signups").insert({ email });

  // A unique-violation just means this email already joined -- treat it as
  // success rather than leaking whether a given address is already on the
  // list to whoever is submitting the form.
  if (error && error.code !== "23505") {
    console.error("waitlist insert error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // Best-effort: the signup row is already the source of truth, so a failed
  // confirmation email shouldn't fail the request. Resend's shared
  // onboarding@resend.dev domain only actually delivers to the email on the
  // Resend account itself until a real domain is verified.
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "FreeLoom <onboarding@resend.dev>",
        to: email,
        subject: "You're on the FreeLoom waitlist",
        html: WAITLIST_CONFIRMATION_HTML,
      });
    } catch (err) {
      console.error("Failed to send waitlist confirmation email:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
