import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CONFIRMATION_HTML = `
<div style="background:#0a0d1c;padding:40px 24px;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:480px;margin:0 auto;background:#f7f2e6;border-radius:12px;padding:32px;color:#2c2620;">
    <p style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b6153;margin:0 0 16px;font-family:'Courier New',monospace;">
      Platform coming soon
    </p>
    <h1 style="font-size:24px;margin:0 0 16px;">You&rsquo;re on the FreeLoom waitlist</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
      Thanks for signing up. FreeLoom is a transcript builder and record-keeper for
      unschooling and wildschooling families — we&rsquo;ll email you the moment it&rsquo;s
      ready to open up.
    </p>
    <p style="font-size:15px;line-height:1.6;margin:0;color:#6b6153;">
      Real learning, formally recorded.
    </p>
  </div>
</div>
`;

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
        html: CONFIRMATION_HTML,
      });
    } catch (err) {
      console.error("Failed to send waitlist confirmation email:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
