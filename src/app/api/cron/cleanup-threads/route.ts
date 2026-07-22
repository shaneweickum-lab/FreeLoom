import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

/** Best-effort -- a failed alert email must never mask the real 500 this
 * route already returns to Vercel Cron's own failure tracking. Otherwise
 * invisible day-to-day: nobody watches the Cron dashboard on a normal day,
 * so a silent failure here would just mean stale threads pile up forever
 * with no one finding out until a customer notices something's off. */
async function sendCronFailureAlert(reason: string) {
  const to = process.env.OPS_ALERT_EMAIL;
  if (!to || !process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "FreeLoom <onboarding@resend.dev>",
      to,
      subject: "FreeLoom cron job failed: cleanup-threads",
      html: `<p>The daily <code>cleanup-threads</code> cron job failed.</p><p>${reason}</p>`,
    });
  } catch (err) {
    console.error("Failed to send cron-failure alert email:", err);
  }
}

/** Runs daily via Vercel Cron (see vercel.json). No authenticated user in a
 * cron invocation, so this checks the standard Vercel bearer-token
 * convention instead, and uses the service-role client to call
 * cleanup_stale_message_threads() -- a SECURITY DEFINER function granted to
 * service_role only, not authenticated, so it can't be invoked by a regular
 * logged-in user even if they discovered its name. */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.rpc("cleanup_stale_message_threads");

  if (error) {
    console.error("cleanup_stale_message_threads error:", error);
    await sendCronFailureAlert(error.message ?? "Unknown error -- see Vercel logs.");
    return NextResponse.json({ error: "Cleanup failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: data });
}
